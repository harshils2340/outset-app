import "./env.ts";
import { serve } from "@hono/node-server";
import { app } from "./api/routes.ts";
import { migrate } from "./db/client.ts";
import { ingestAll, seedTaxonomy, addTarget } from "./ingest/load.ts";
import { generateOutreachDrafts } from "./outreach/drafts.ts";
import { scrapePending } from "./scrape/run.ts";
import { refreshAllScores } from "./lib/completeness.ts";
import { syncCatalogToApp, syncContactsToApp } from "./sync/contacts.ts";
import { discoverAll, metroCoverage } from "./discover/osm.ts";
import { enrichPending, rate } from "./enrich/run.ts";
import { discoverSearch } from "./discover/searchapi.ts";
import { readPendingStructures, readSiteStructure } from "./enrich/structure.ts";
import { CITIES } from "./discover/cities.ts";

import { db } from "./db/client.ts";
import { CATEGORIES, METROS } from "./taxonomy/catalog.ts";

migrate();
seedTaxonomy();

const cmd = process.argv[2] || "serve";

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
  const stats = await discoverAll({ only, force, concurrency });
  refreshAllScores();
  const total = stats.reduce((n, s) => n + s.inserted + s.updated, 0);
  console.log("Discovered " + total + " operators across " + stats.length + " areas. " + JSON.stringify(metroCoverage()));
  process.exit(0);
}

if (cmd === "search") {
  const keys = (process.env.SEARCHAPI_KEYS || process.env.SEARCHAPI_KEY || "").split(",").map((k) => k.trim()).filter(Boolean);
  if (!keys.length) {
    console.error("SEARCHAPI_KEY or SEARCHAPI_KEYS is not set. Put it in backend/.env.");
    process.exit(1);
  }
  const arg = (k: string) => process.argv.find((a) => a.startsWith("--" + k + "="))?.split("=")[1];
  const categories = arg("categories")?.split(",").filter(Boolean);
  const cities = arg("cities")?.split(",").filter(Boolean);
  const concurrency = Number(arg("concurrency") || 4);
  const maxPages = Number(arg("pages") || 1);
  const budget = arg("budget") ? Number(arg("budget")) : undefined;
  console.log(`SearchApi discovery: ${cities?.length || CITIES.length} cities x ${categories?.length || CATEGORIES.length} categories, ${maxPages} page(s) each, ${keys.length} key(s)${budget ? ", budget " + budget + " queries" : ""}.`);
  const stats = await discoverSearch({ keys, categories, cities, concurrency, maxPages, budget });
  refreshAllScores();
  const total = (db.prepare("SELECT COUNT(*) AS n FROM operators WHERE origin != 'demo'").get() as { n: number }).n;
  console.log(`Done${stats.stoppedEarly ? " (stopped early: credits or budget)" : ""}. ${stats.queries} queries, ${stats.results} results, ${stats.inserted} new, ${stats.merged} merged into known operators, ${stats.skipped} skipped. Catalog now ${total} operators.`);
  process.exit(0);
}

if (cmd === "structure") {
  const limit = Number(process.argv[3] || 200);
  const concurrency = Number(process.argv[4] || 6);
  const only = process.argv[5];
  if (only) {
    const op = db.prepare("SELECT id, domain, website FROM operators WHERE domain = ?").get(only) as { id: string; domain: string; website: string } | undefined;
    if (!op) { console.error("unknown domain"); process.exit(1); }
    console.log(JSON.stringify(await readSiteStructure(op)));
    console.log(JSON.stringify(db.prepare("SELECT name, detail, price_cents, price_unit FROM offerings WHERE operator_id = ? AND confidence = 'site'").all(op.id), null, 1));
    console.log(JSON.stringify(db.prepare("SELECT fact_key, fact_value FROM facts WHERE operator_id = ? AND confidence = 'site' AND fact_key != 'service'").all(op.id), null, 1));
    process.exit(0);
  }
  const results = await readPendingStructures(limit, concurrency);
  refreshAllScores();
  const ok = results.filter((r) => r.status === "ok").length;
  const svc = results.reduce((n, r) => n + r.services, 0);
  console.log(`Read ${ok}/${results.length} sites, ${svc} services. Run "npm run sync" to push to the app.`);
  process.exit(0);
}

if (cmd === "enrich") {
  const limit = Number(process.argv[3] || 10);
  const concurrency = Number(process.argv[4] || 3);
  const results = await enrichPending(limit, concurrency);
  refreshAllScores();
  const ok = results.filter((r) => r.status === "ok").length;
  const usage = results.reduce((a, r) => ({ i: a.i + (r.usage?.input || 0), o: a.o + (r.usage?.output || 0) }), { i: 0, o: 0 });
  const cost = (usage.i * rate().in + usage.o * rate().out) / 1e6;
  console.log(`Enriched ${ok}/${results.length}. Tokens in=${usage.i} out=${usage.o}. Approx cost $${cost.toFixed(2)}. Run "npm run sync" to push to the app.`);
  process.exit(0);
}

if (cmd === "sync") {
  ingestAll();
  const out = syncContactsToApp();
  console.log("Wrote " + out.count + " operator contact records to " + out.path);
  const cat = syncCatalogToApp();
  console.log("Wrote " + cat.count + " operators to " + cat.path);
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

if (cmd === "serve") {
  ingestAll();
  const port = Number(process.env.PORT || 8787);
  console.log("Outset backend on http://localhost:" + port);
  serve({ fetch: app.fetch, port });
} else {
  console.error("Unknown command: " + cmd);
  process.exit(1);
}
