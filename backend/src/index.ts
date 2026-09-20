import "./env.ts";
import { serve } from "@hono/node-server";
import { app } from "./api/routes.ts";
import { migratePg, pgConfigured } from "./db/pg.ts";
import { migrate } from "./db/client.ts";
import { ingestAll, seedTaxonomy, addTarget } from "./ingest/load.ts";
import { generateOutreachDrafts } from "./outreach/drafts.ts";
import { scrapePending } from "./scrape/run.ts";
import { refreshAllScores, refreshRecentScores } from "./lib/completeness.ts";
import { loadProfileOverlays, syncCatalogToApp, syncContactsToApp } from "./sync/contacts.ts";
import { writeClaimIndex } from "./lib/claimIndex.ts";
import { discoverAll, metroCoverage } from "./discover/osm.ts";
import { budgetUsd, collectAll, collectBatch, dryRun, enrichPending, rate, spentUsd, submitBatch } from "./enrich/run.ts";
import { discoverSearch, isCached, planSearch, providerOf, PRICE_PER_1K_USD, PRICING_DATE } from "./discover/searchapi.ts";
import { discoverWeb } from "./discover/websearch.ts";
import { discoverAi } from "./discover/aisearch.ts";
import { placesCommand } from "./discover/places.ts";
import { sendOutreach } from "./outreach/send.ts";
import { recordUnsub } from "./lib/unsub.ts";
import { ownersCsv, ownersPending } from "./enrich/owners.ts";
import { readPendingStructures, readSiteStructure } from "./enrich/structure.ts";
import { socialPending } from "./enrich/social.ts";
import { importThumbnails } from "./enrich/thumbs.ts";
import { pruneNoise } from "./enrich/prune.ts";
import { collectPhotos, photosPending } from "./enrich/images.ts";
import { widgetsPending, widgetForOperator } from "./enrich/widgets.ts";
import { loadOsmLocations, locationsPending } from "./enrich/locations.ts";
import { reviewsForOperator, reviewsPending } from "./enrich/reviews.ts";
import { installChromeGuard, reapOrphanChrome } from "./scrape/render.ts";
import { guardLaptopJob } from "./scrape/guard.ts";
import { measureIdle, MIN_IDLE } from "./scrape/cpu.ts";
import { capture } from "./eval/availCapture.ts";
import type { CaseVendor } from "./eval/availCases.ts";

import { db } from "./db/client.ts";
import { CATEGORIES, METROS } from "./taxonomy/catalog.ts";

migrate();
seedTaxonomy();
installChromeGuard();

const cmd = process.argv[2] || "serve";

if (cmd === "chrome-reap") {
  console.log("reaped " + reapOrphanChrome() + " leftover chrome process(es)");
  process.exit(0);
}

if (cmd === "cpu") {
  const idle = await measureIdle();
  console.log(JSON.stringify({ idle: Math.round(idle * 10) / 10, floor: MIN_IDLE, ok: idle >= MIN_IDLE }));
  process.exit(idle >= MIN_IDLE ? 0 : 2);
}

if (cmd === "add") {
  const website = process.argv[3];
  const metroId = process.argv[4];
  const categoryId = process.argv[5];
  const name = process.argv[6];
  if (!website || !metroId) {
    console.error("Usage: tsx src/index.ts add <website> <metroId> [categoryId] [name]");
    process.exit(1);
  }
  const id = addTarget({ website, metroId, categoryId, name });
  console.log(id);
  process.exit(0);
}

if (cmd === "ingest") {
  const n = ingestAll();
  console.log("Ingested " + n.tampa + " Tampa and " + n.national + " US/Canada operators.");
  process.exit(0);
}

if (cmd === "scrape") {
  ingestAll();
  const limit = Number(process.argv[3] || 40);
  guardLaptopJob({ name: "scrape", limit, concurrency: 1 });
  const results = await scrapePending(limit);
  refreshAllScores();
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}

if (cmd === "discover") {
  const only = process.argv.slice(3).filter((a) => !a.startsWith("--"));
  const force = process.argv.includes("--force");
  const cArg = process.argv.find((a) => a.startsWith("--concurrency="));
  const concurrency = cArg ? Number(cArg.split("=")[1]) : 3;
  const wArg = process.argv.find((a) => a.startsWith("--wave="));
  const wave = wArg ? Number(wArg.split("=")[1]) : 1;
  guardLaptopJob({ name: "discover", concurrency, bulk: only.length === 0 });
  const stats = await discoverAll({ only, force, concurrency, wave });
  refreshAllScores();
  const total = stats.reduce((n, s) => n + s.inserted + s.updated, 0);
  console.log("Discovered " + total + " operators across " + stats.length + " areas. " + JSON.stringify(metroCoverage()));
  process.exit(0);
}

if (cmd === "aisearch") {
  const only = process.argv.slice(3).filter((a) => !a.startsWith("--"));
  const mArg = process.argv.find((a) => a.startsWith("--max="));
  const r = await discoverAi({ cities: only, maxCalls: mArg ? Number(mArg.split("=")[1]) : 700 });
  refreshRecentScores();
  console.log("AI discovery: " + JSON.stringify(r));
  process.exit(0);
}

if (cmd === "places") {
  process.exit(await placesCommand(process.argv.slice(3)));
}

if (cmd === "websearch") {
  // npm run websearch -- Toronto --terms=cooking,pottery,tour   (a category id or a WEB_TERMS phrase; default: every term)
  const only = process.argv.slice(3).filter((a) => !a.startsWith("--"));
  const terms = process.argv.find((a) => a.startsWith("--terms="))?.slice(8).split(",").map((t) => t.trim()).filter(Boolean);
  const dArg = process.argv.find((a) => a.startsWith("--delay="));
  const r = await discoverWeb({ cities: only, terms, delayMs: dArg ? Number(dArg.split("=")[1]) : undefined });
  refreshRecentScores();
  console.log("Web discovery: " + JSON.stringify(r));
  process.exit(0);
}

if (cmd === "osm-facts") {
  // Opening hours, phones, emails and descriptions out of the Overpass answers already on disk. No network.
  const { importOsmFacts } = await import("./discover/osmfacts.ts");
  const st = importOsmFacts({
    onProgress: (done, total, s) =>
      process.stdout.write(`  ${done}/${total} files, ${s.matched.toLocaleString()} matched, ${s.hours.toLocaleString()} hours, ${s.phone.toLocaleString()} phones\r`),
  });
  process.stdout.write("\n");
  console.log(
    `${st.files} files, ${st.elements.toLocaleString()} elements, ${st.matched.toLocaleString()} matched a listing.\n` +
      `  hours ${st.hours.toLocaleString()}, phones ${st.phone.toLocaleString()}, emails ${st.email.toLocaleString()}, websites ${st.website.toLocaleString()}, descriptions ${st.description.toLocaleString()}`,
  );
  console.log('Run "npm run sync" to publish.');
  process.exit(0);
}

if (cmd === "overture") {
  // Free discovery from the Overture Maps open place dataset. No key, no credits.
  //   overture                 every box, US and Canada
  //   overture ca-east us-west only these
  //   --refresh                ignore the on-disk cache and read S3 again
  const { BOXES, importBox, OVERTURE_RELEASE } = await import("./discover/overture.ts");
  const picked = process.argv.slice(3).filter((a) => !a.startsWith("--"));
  const boxes = picked.length ? picked : Object.keys(BOXES);
  const refresh = process.argv.includes("--refresh");
  console.log(`Overture ${OVERTURE_RELEASE}: ${boxes.length} box(es) [${boxes.join(", ")}]`);
  const total = { read: 0, inserted: 0, merged: 0 };
  const skipped: Record<string, number> = {};
  for (const b of boxes) {
    const t0 = Date.now();

    const st = await importBox(b, {
      refresh,
      onProgress: (done, total, s) => process.stdout.write(`  ${b}: ${done.toLocaleString()}/${total.toLocaleString()} read, ${s.inserted.toLocaleString()} new, ${s.merged.toLocaleString()} filled in\n`),
    });
    total.read += st.read;
    total.inserted += st.inserted;
    total.merged += st.merged;
    for (const [k, v] of Object.entries(st.skipped)) skipped[k] = (skipped[k] || 0) + v;
    console.log(`  ${b.padEnd(11)} ${st.read.toLocaleString().padStart(8)} read  ${st.inserted.toLocaleString().padStart(7)} new  ${st.merged.toLocaleString().padStart(7)} filled in  ${Math.round((Date.now() - t0) / 1000)}s`);
  }
  console.log(`\n${total.read.toLocaleString()} places read, ${total.inserted.toLocaleString()} new operators, ${total.merged.toLocaleString()} existing ones filled in.`);
  for (const [why, n] of Object.entries(skipped).sort((a, b) => b[1] - a[1])) console.log(`  skipped, ${why}: ${n.toLocaleString()}`);
  console.log('Run "npm run sync" to publish.');
  process.exit(0);
}

if (cmd === "search") {
  // Google Maps discovery over the whole taxonomy (src/discover/searchterms.ts) x the coverage grid.
  //   --categories=cooking,pottery   --cities=Toronto,ON   --metro=toronto (or a comma list, or "all" for every metro)
  //   --pages=1   --concurrency=4   --budget=N (paid requests for the whole run; cache hits are free)
  //   --dry-run   prints the query list, cache hits, paid requests and the cost at each provider. Sends nothing, needs no key.
  const arg = (k: string) => process.argv.find((a) => a.startsWith("--" + k + "="))?.split("=")[1];
  const categories = arg("categories")?.split(",").filter(Boolean);
  const cities = arg("cities")?.split(",").filter(Boolean);
  const metros = arg("metro")?.split(",").filter(Boolean);
  const concurrency = Number(arg("concurrency") || 4);
  const maxPages = Number(arg("pages") || 1);
  const budget = arg("budget") ? Number(arg("budget")) : undefined;
  // --one-per: the broadest phrasing per category only. A page answers with twenty businesses whatever it was
  // asked, so on a fixed number of credits this reaches every city instead of a handful of them three ways.
  const onePer = process.argv.includes("--one-per");
  const plan = planSearch({ categories, cities, metros, budget, onePer });
  const usd = (n: number) => "$" + n.toFixed(2);
  const scope = `${plan.cities.length} cities x ${plan.terms.length} terms (${plan.categories} categories), ${maxPages} page(s) each`;
  if (process.argv.includes("--dry-run")) {
    console.log(`Dry run: ${scope}.`);
    if (plan.cities.length <= 3) {
      for (const city of plan.cities) {
        console.log(`\n${city.name}, ${city.region} (${city.country}) @${city.lat},${city.lon}`);
        for (const term of plan.terms) console.log(`  ${isCached(term.q, city) ? "cached" : "paid  "}  ${term.q.padEnd(28)} -> ${term.categoryId}`);
      }
    } else {
      console.log("Cities: " + plan.cities.map((c) => c.name + " " + c.region).join(", "));
      console.log("Terms: " + plan.terms.map((t) => `${t.q} -> ${t.categoryId}`).join("; "));
    }
    console.log(`\n${plan.jobs.length} page-1 queries, ${plan.cached} already cached, ${plan.paid} paid requests${budget ? " (budget " + budget + ")" : ""}${maxPages > 1 ? "; pages after the first are only fetched when a page is full, so they are not counted" : ""}.`);
    console.log(`Estimated cost (pricing read ${PRICING_DATE}, 1 request per page): Serper ${usd(plan.costUsd.serper)} at $${PRICE_PER_1K_USD.serper}/1k, SearchApi ${usd(plan.costUsd.searchapi)} at $${PRICE_PER_1K_USD.searchapi}/1k, SerpApi ${usd(plan.costUsd.serpapi)} at $${PRICE_PER_1K_USD.serpapi}/1k.`);
    console.log("Nothing was sent.");
    process.exit(0);
  }
  const keys = (process.env.SEARCHAPI_KEYS || process.env.SEARCHAPI_KEY || "").split(",").map((k) => k.trim()).filter(Boolean);
  if (!keys.length) {
    console.error("SEARCHAPI_KEY or SEARCHAPI_KEYS is not set. Put it in backend/.env, or add --dry-run to see the plan without one.");
    process.exit(1);
  }
  const prov = providerOf(keys[0]);
  console.log(`Google Maps discovery via ${prov}: ${scope}, ${keys.length} key(s). ${plan.cached} cached, ${plan.paid} paid requests, about ${usd(plan.costUsd[prov])}${budget ? ", budget " + budget + " requests" : ""}.`);
  const stats = await discoverSearch({ keys, categories, cities, metros, concurrency, maxPages, budget, onePer });
  refreshAllScores();
  const total = (db.prepare("SELECT COUNT(*) AS n FROM operators WHERE origin != 'demo'").get() as { n: number }).n;
  console.log(`Done${stats.stoppedEarly ? " (stopped early: credits or budget)" : ""}. ${stats.queries} queries, ${stats.results} results, ${stats.inserted} new, ${stats.merged} merged into known operators, ${stats.skipped} skipped. Catalog now ${total} operators.`);
  process.exit(0);
}

if (cmd === "photos") {
  const limit = Number(process.argv[3] || 200);
  const concurrency = Number(process.argv[4] || 8);
  const only = process.argv.slice(5).find((a) => !a.startsWith("--"));
  if (!only) guardLaptopJob({ name: "photos", limit, concurrency });
  if (only) {
    const op = db.prepare("SELECT id, domain, website FROM operators WHERE domain = ?").get(only) as { id: string; domain: string; website: string } | undefined;
    if (!op) { console.error("unknown domain"); process.exit(1); }
    const photos = await collectPhotos(op.website);
    console.log(JSON.stringify(photos, null, 1));
    process.exit(0);
  }
  const out = await photosPending(limit, concurrency, process.argv.includes("--empty") ? "empty" : "photos");
  console.log(`Photos: ${out.withPhotos}/${out.sites} sites, ${out.photos} images linked. Run "npm run sync" to push to the app.`);
  process.exit(0);
}

// Booking widgets (FareHarbor, Xola) publish the operator's live menu as JSON. Exact prices, no key, no model.
if (cmd === "widgets") {
  const limit = Number(process.argv[3] || 2000);
  const concurrency = Number(process.argv[4] || 6);
  const only = process.argv.slice(5).find((a) => !a.startsWith("--"));
  if (!only) guardLaptopJob({ name: "widgets", limit, concurrency });
  if (only) {
    const op = db.prepare("SELECT o.id, o.domain, o.website, f.fact_value AS booking_url FROM operators o JOIN facts f ON f.operator_id = o.id AND f.fact_key = 'booking_url' WHERE o.domain = ? LIMIT 1").get(only) as { id: string; domain: string; website: string | null; booking_url: string } | undefined;
    if (!op) { console.error("no booking url for that domain"); process.exit(1); }
    console.log(JSON.stringify(await widgetForOperator(op)));
    console.log(JSON.stringify(db.prepare("SELECT name, detail, duration, price_cents, price_unit FROM offerings WHERE operator_id = ? AND confidence = 'widget'").all(op.id), null, 1));
    console.log(JSON.stringify(db.prepare("SELECT fact_key, substr(fact_value, 1, 160) AS v FROM facts WHERE operator_id = ? AND confidence = 'widget' AND fact_key NOT IN ('photo','service')").all(op.id), null, 1));
    process.exit(0);
  }
  const out = await widgetsPending(limit, concurrency, process.argv.includes("--redo"));
  refreshRecentScores();
  console.log(`Widgets: ${out.ok}/${out.sites} operators, ${out.offerings} items, ${out.facts} facts. Run "npm run sync" to push to the app.`);
  process.exit(0);
}

// Re-crawl operators that already have photos, this time keeping any clip, GIF or YouTube / Vimeo embed as a moving cover.
if (cmd === "videos") {
  const limit = Number(process.argv[3] || 500);
  const concurrency = Number(process.argv[4] || 8);
  guardLaptopJob({ name: "videos", limit, concurrency });
  const out = await photosPending(limit, concurrency, "videos");
  console.log(`Videos: ${out.sites} sites re-crawled. Run "npm run sync" to push to the app.`);
  process.exit(0);
}

if (cmd === "prune") {
  const dry = process.argv.includes("--dry");
  const r = pruneNoise(dry);
  console.log(`${dry ? "Would remove" : "Removed"} ${r.total} non-experience rows: ${r.types} by Google type, ${r.names} by name, ${r.domains} by domain.`);
  process.exit(0);
}

if (cmd === "thumbs") {
  const r = importThumbnails();
  console.log(`Thumbnails: scanned ${r.scanned} Google results, set ${r.covers} covers. Run "npm run sync" to push to the app.`);
  process.exit(0);
}

if (cmd === "social") {
  const limit = Number(process.argv[3] || 5000);
  const concurrency = Number(process.argv[4] || 4);
  guardLaptopJob({ name: "social", limit, concurrency });
  const r = await socialPending(limit, concurrency);
  console.log(`Social: ${r.operators} operators, ${r.videos} YouTube videos, ${r.tiktok} TikTok profiles. Run "npm run sync" to push to the app.`);
  process.exit(0);
}

if (cmd === "structure") {
  const limit = Number(process.argv[3] || 200);
  const concurrency = Number(process.argv[4] || 6);
  const only = process.argv.slice(5).find((a) => !a.startsWith("--"));
  if (!only) guardLaptopJob({ name: "structure", limit, concurrency });
  if (only) {
    const op = db.prepare("SELECT id, domain, website FROM operators WHERE domain = ?").get(only) as { id: string; domain: string; website: string } | undefined;
    if (!op) { console.error("unknown domain"); process.exit(1); }
    console.log(JSON.stringify(await readSiteStructure(op)));
    console.log(JSON.stringify(db.prepare("SELECT name, detail, price_cents, price_unit FROM offerings WHERE operator_id = ? AND confidence = 'site'").all(op.id), null, 1));
    console.log(JSON.stringify(db.prepare("SELECT fact_key, fact_value FROM facts WHERE operator_id = ? AND confidence = 'site' AND fact_key != 'service'").all(op.id), null, 1));
    process.exit(0);
  }
  const results = await readPendingStructures(limit, concurrency, process.argv.includes("--redo"));
  refreshAllScores();
  const ok = results.filter((r) => r.status === "ok").length;
  const svc = results.reduce((n, r) => n + r.services, 0);
  console.log(`Read ${ok}/${results.length} sites, ${svc} services. Run "npm run sync" to push to the app.`);
  process.exit(0);
}

if (cmd === "enrich") {
  // enrich [limit] [concurrency]            live calls, stops at the budget
  // enrich [limit] --dry                    crawl and trim only, print tokens and cost, no key needed
  // enrich [limit] --batch                  submit an OpenAI batch (half price), prints the batch id
  // enrich --collect=<batch id>             store a finished batch
  const limit = Number(process.argv[3] || 10);
  const concurrency = Number(process.argv.find((a) => /^\d+$/.test(a) && a !== process.argv[3]) || 3);
  const collect = process.argv.find((a) => a.startsWith("--collect="))?.split("=")[1];
  if (!process.argv.includes("--collect-all") && !collect) {
    guardLaptopJob({ name: "enrich", limit, concurrency });
  }
  if (process.argv.includes("--collect-all")) {
    const rs = await collectAll();
    refreshAllScores();
    for (const r of rs) console.log(`${r.batchId}: ${r.status}, stored ${r.stored}, failed ${r.failed}, $${r.usd.toFixed(2)}`);
    const pending = rs.filter((r) => r.status !== "completed").length;
    console.log(`${rs.length} batches checked, ${pending} still running. Total spent $${spentUsd().toFixed(2)} of $${budgetUsd().toFixed(2)}.`);
    process.exit(pending ? 2 : 0);
  }
  if (collect) {
    const r = await collectBatch(collect);
    refreshAllScores();
    console.log(`Batch ${collect}: ${r.status}. Stored ${r.stored}, failed ${r.failed}, spent $${r.usd.toFixed(2)}. Total spent $${spentUsd().toFixed(2)} of $${budgetUsd().toFixed(2)}.`);
    process.exit(0);
  }
  if (process.argv.includes("--dry")) {
    const r = await dryRun(limit, concurrency);
    console.log(`Dry run: ${r.sites} sites, ${r.tokens} tokens, avg ${Math.round(r.tokens / Math.max(1, r.sites))} per site. Live ~$${r.liveUsd.toFixed(2)}, batch ~$${r.batchUsd.toFixed(2)}.`);
    process.exit(0);
  }
  if (process.argv.includes("--batch")) {
    const r = await submitBatch(limit, concurrency);
    console.log(r.batchId ? `Submitted batch ${r.batchId}: ${r.ops} sites, ~$${r.estUsd.toFixed(2)}. Collect later with: npm run enrich -- --collect=${r.batchId}` : "Nothing to submit within budget.");
    process.exit(0);
  }
  const results = await enrichPending(limit, concurrency);
  refreshAllScores();
  const ok = results.filter((r) => r.status === "ok").length;
  const usage = results.reduce((a, r) => ({ i: a.i + (r.usage?.input || 0), o: a.o + (r.usage?.output || 0) }), { i: 0, o: 0 });
  const cost = (usage.i * rate().in + usage.o * rate().out) / 1e6;
  console.log(`Enriched ${ok}/${results.length}. Tokens in=${usage.i} out=${usage.o}. This run $${cost.toFixed(2)}, total $${spentUsd().toFixed(2)} of $${budgetUsd().toFixed(2)}. Run "npm run sync" to push to the app.`);
  process.exit(0);
}

// locations [limit] [concurrency]: chains get one pin per venue, from the OpenStreetMap cache and their own locations page.
if (cmd === "locations") {
  const osm = loadOsmLocations();
  console.log(`OpenStreetMap: ${osm.locations} extra locations across ${osm.operators} chains.`);
  const limit = Number(process.argv[3] || 3000);
  const concurrency = Number(process.argv[4] || 8);
  guardLaptopJob({ name: "locations", limit, concurrency });
  const r = await locationsPending(limit, concurrency);
  console.log(`Sites: ${r.sites} checked, ${r.withPage} with a locations page, ${r.added} locations geocoded. Run "npm run sync" to push to the app.`);
  process.exit(0);
}

// reviews [limit] [concurrency] [domain]: schema.org Review markup and testimonial pages from each operator's own site.
if (cmd === "reviews") {
  const limit = Number(process.argv[3] || 4000);
  const concurrency = Number(process.argv[4] || 8);
  const only = process.argv[5];
  if (!only) guardLaptopJob({ name: "reviews", limit, concurrency });
  if (only) {
    const op = db.prepare("SELECT id, domain, website FROM operators WHERE domain = ?").get(only) as { id: string; domain: string; website: string | null } | undefined;
    if (!op) { console.error("unknown domain"); process.exit(1); }
    console.log(JSON.stringify(await reviewsForOperator(op)));
    console.log(JSON.stringify(db.prepare("SELECT fact_value FROM facts WHERE operator_id = ? AND fact_key = 'review'").all(op.id).map((r) => JSON.parse((r as { fact_value: string }).fact_value)), null, 1));
    process.exit(0);
  }
  const r = await reviewsPending(limit, concurrency);
  console.log(`Reviews: ${r.sites} sites, ${r.withReviews} with reviews, ${r.reviews} reviews kept. Run "npm run sync" to push to the app.`);
  process.exit(0);
}

if (cmd === "sync") {
  const t0 = Date.now();
  const lap = (label: string) => console.log(`${label} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  // The sync only reads. Seed ingest (a writer) runs on request, and other writers may hold the lock for minutes.
  db.exec("PRAGMA busy_timeout = 300000");
  if (process.argv.includes("--ingest")) {
    ingestAll();
    lap("ingest");
  }
  const out = syncContactsToApp();
  lap("Wrote " + out.count + " operator contact records to " + out.path);
  const ov = await loadProfileOverlays();
  lap("Loaded " + ov.count + " claimed listings' edits from " + ov.source);
  const cat = syncCatalogToApp();
  lap("Wrote " + cat.count + " operators to " + cat.path);
  const ci = writeClaimIndex();
  lap("Wrote claim index for " + ci.count + " operators (" + ci.withEmail + " with an email on file) to " + ci.path);
  process.exit(0);
}

// The API host has no operator database. This file tells it which email may claim each listing.
if (cmd === "claim-index") {
  const ci = writeClaimIndex();
  console.log("Wrote claim index for " + ci.count + " operators (" + ci.withEmail + " with an email on file) to " + ci.path);
  process.exit(0);
}

if (cmd === "owners") {
  if (process.argv.includes("--csv")) {
    const { writeFileSync } = await import("node:fs");
    const out = process.argv.find((a) => a.startsWith("--out="))?.split("=")[1] || "data/owners.csv";
    writeFileSync(out, ownersCsv());
    console.log("Wrote " + out);
    process.exit(0);
  }
  const limit = Number(process.argv[3] || 5000);
  const concurrency = Number(process.argv[4] || 12);
  guardLaptopJob({ name: "owners", limit, concurrency });
  const r = await ownersPending(limit, concurrency);
  console.log("Owners: " + JSON.stringify(r));
  process.exit(0);
}

if (cmd === "outreach-send") {
  const lArg = process.argv.find((a) => a.startsWith("--limit="));
  const tArg = process.argv.find((a) => a.startsWith("--to="));
  const mArg = process.argv.find((a) => a.startsWith("--metro="));
  const cArg = process.argv.find((a) => a.startsWith("--country="));
  const r = await sendOutreach({
    limit: lArg ? Number(lArg.split("=")[1]) : 50,
    dry: process.argv.includes("--dry"),
    to: tArg?.split("=")[1],
    metro: mArg?.split("=")[1],
    country: cArg?.split("=")[1],
  });
  console.log("Outreach: " + JSON.stringify(r));
  process.exit(0);
}

if (cmd === "unsub") {
  const email = process.argv.find((a) => a.startsWith("--email="))?.split("=")[1];
  if (!email) {
    console.error("Usage: npx tsx src/index.ts unsub --email=owner@shop.com");
    process.exit(1);
  }
  await recordUnsub(email);
  console.log("Unsubscribed " + email.trim().toLowerCase());
  process.exit(0);
}

if (cmd === "outreach") {
  ingestAll();
  const n = generateOutreachDrafts();
  const rows = db.prepare("SELECT subject, to_email, o.name FROM outreach_drafts d JOIN operators o ON o.id = d.operator_id").all();
  console.log("Drafted " + n + " emails.");
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

if (cmd === "status") {
  ingestAll();
  const ops = db.prepare("SELECT name, domain, completeness, claim_status, booking_mode, category_id, city FROM operators ORDER BY name").all();
  console.log(
    JSON.stringify(
      {
        metros: METROS.length,
        categories: CATEGORIES.length,
        coverageCells: METROS.length * CATEGORIES.length,
        operators: ops,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

/**
 * Repoint covers that no longer load at a photograph that does.
 *
 * About one cover in thirteen is dead at any moment, and the guest app draws a generated illustration in its
 * place, which is the exact thing browse's cover filter exists to prevent. Most of those listings have other
 * photographs; they are pointed at the wrong one, not missing one. A crawl, so it obeys the crawl rules and
 * caps at 40 on this Mac.
 *
 *   npm run cover-screen                     40 listings, the laptop cap
 *   npm run cover-screen -- --limit=60000    the worker's run over the catalog
 *   npm run cover-screen -- --dry            probe and report, change nothing
 */
if (cmd === "cover-screen") {
  const { screenCovers } = await import("./enrich/coverlive.ts");
  const arg = (k: string) => process.argv.slice(3).find((a) => a.startsWith("--" + k + "="))?.split("=")[1];
  const res = await screenCovers({
    limit: Number(arg("limit") || 40),
    concurrency: Number(arg("concurrency") || 4),
    pauseMs: Number(arg("pause") || 400),
  });
  console.log(`Checked ${res.checked} covers: ${res.alive} still load, ${res.repointed} repointed at another photo, ${res.cleared} cleared for want of one.`);
  for (const f of res.fixes.slice(0, 25)) {
    console.log(`  ${f.domain.padEnd(34)} ${f.now ? "-> photo " + f.tried + " of its gallery" : "no working photo, cover dropped"}`);
  }
  if (res.repointed || res.cleared) console.log('Run "npm run sync" to push the change to the app.');
  process.exit(0);
}

/**
 * Record real booking systems answering, into the availability corpus under data/avail-eval/cases.
 *
 * This is a crawl and obeys the crawl rules: the single lock, the CPU floor, a hard cap of 40 shops on this
 * Mac. A corpus over the whole catalog runs on the Render worker, where the cap does not apply.
 *
 *   npm run avail:capture                      12 shops of each readable vendor, a fortnight from today
 *   npm run avail:capture -- --per-vendor=200  the worker's run
 *   npm run avail:capture -- --vendors=peek --from=2026-10-01 --days=7
 */
if (cmd === "avail-capture") {
  const arg = (k: string) => process.argv.slice(3).find((a) => a.startsWith("--" + k + "="))?.split("=")[1];
  const today = new Date();
  const from = arg("from") || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const vendors = (arg("vendors") || "fareharbor,peek,xola").split(",").filter(Boolean) as CaseVendor[];
  const rows = await capture({
    perVendor: Number(arg("per-vendor") || 12),
    vendors,
    from,
    days: Number(arg("days") || 14),
    pauseMs: Number(arg("pause") || 1500),
  });
  for (const r of rows) console.log([r.vendor, r.domain, r.error ? "ERROR " + r.error : `${r.live ? "live" : "dead"} days=${r.days} slots=${r.slots} calls=${r.calls}`].join("  "));
  const live = rows.filter((r) => r.live).length;
  console.log(`\nCaptured ${rows.length} cases, ${live} of them with something bookable. Score them with "npm run avail:report".`);
  process.exit(0);
}

/**
 * Accept the reader's current answers as the corpus baseline, after a deliberate fix. Replays the existing
 * recordings; crawls nothing.
 */
if (cmd === "avail-rebaseline") {
  const { rebaseline } = await import("./eval/availReport.ts");
  console.log(await rebaseline());
  process.exit(0);
}

/** Score the corpus: the free rule checks and the independent second read, with no network and no model. */
if (cmd === "avail-report") {
  const { report } = await import("./eval/availReport.ts");
  console.log(await report({ json: process.argv.includes("--json") }));
  process.exit(0);
}

/**
 * Have a model read each recorded feed and say what the answer should have been, independently of our reader.
 *
 * The only part of the availability suite that spends money, so it prints a measured estimate from the real
 * token count and stops there unless --yes is given. An agent must not pass --yes on its own.
 *
 *   npm run avail:judge                      what it would cost, and nothing else
 *   npm run avail:judge -- --yes             submit, wait, and write each case's truth.json
 *   npm run avail:judge -- --only=fareharbor --model=claude-sonnet-5 --yes
 */
if (cmd === "avail-judge") {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { DEFAULT_JUDGE_MODEL, collect, estimate, judgeableCases, plan, submit } = await import("./eval/availJudge.ts");
  const arg = (k: string) => process.argv.slice(3).find((a) => a.startsWith("--" + k + "="))?.split("=")[1];
  const model = arg("model") || DEFAULT_JUDGE_MODEL;
  const cases = judgeableCases(arg("only"));
  if (!cases.length) {
    console.error('No cases to judge. Run "npm run avail:capture" first.');
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set, so nothing can be judged.");
    process.exit(1);
  }
  const client = new Anthropic();
  const plans = await plan(client, model, cases);
  const { inputTokens, usd } = estimate(model, plans);
  console.log(`${plans.length} case(s), ${inputTokens.toLocaleString("en-US")} input tokens on ${model}, through the Batch API at half price.`);
  console.log(`Worst case cost: $${usd.toFixed(2)} (every answer running to the output cap; the real figure is usually well under).`);
  if (!process.argv.includes("--yes")) {
    console.log("\nNothing submitted. Re-run with --yes to spend that.");
    process.exit(0);
  }
  const { batchId } = await submit(client, model, plans);
  console.log(`Submitted batch ${batchId}. Most finish inside an hour.`);
  const out = await collect(client, model, batchId, plans, (s) => console.log("  " + s));
  console.log(`Wrote truth for ${out.written} case(s). Actual spend: $${out.usd.toFixed(2)}.`);
  for (const f of out.failed) console.log("  no truth written: " + f);
  console.log('Now run "npm run avail:report" to see accuracy against it.');
  process.exit(0);
}

if (cmd === "serve") {
  if (!pgConfigured()) {
    console.error("DATABASE_URL is not set. Profiles and bookings live in Postgres; the API will not serve without it.");
    process.exit(1);
  }
  await migratePg();
  ingestAll();
  const port = Number(process.env.PORT || 8787);
  console.log("Outset backend on http://localhost:" + port);
  serve({ fetch: app.fetch, port });
} else {
  console.error("Unknown command: " + cmd);
  process.exit(1);
}
