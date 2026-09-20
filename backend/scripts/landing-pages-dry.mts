/**
 * Dry run of the landing page generator: reads public/catalog.json, writes the pages into a temp directory (never
 * under public/), and prints what a sync would produce. No network, no database.
 *
 *   npx tsx scripts/landing-pages-dry.mts [out-dir] [art] [metro] [cityId]
 */
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeLandingPages, type Item } from "../src/sync/pages.ts";

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || mkdtempSync(join(tmpdir(), "outset-pages-dry-"));
const art = process.argv[3] || "cooking";
const metroId = process.argv[4] || "toronto";
const cityId = process.argv[5];

const catalog = JSON.parse(readFileSync(join(here, "../../public/catalog.json"), "utf8")) as { operators: Item[] };
const items = catalog.operators.filter((i) => !(i as { unlisted?: boolean }).unlisted);
const t0 = Date.now();
const r = writeLandingPages(items, { publicDir: out });
const files = readdirSync(join(out, "p")).filter((f) => f.endsWith(".html"));
const bytes = files.reduce((n, f) => n + statSync(join(out, "p", f)).size, 0);
console.log(
  `${items.length} listings -> ${r.pages} pages (${r.metroPages} metro pages, ${r.cityPages} city pages, ${r.kindPages} all-metro pages) plus index in ${Date.now() - t0} ms, ${(bytes / 1024 / 1024).toFixed(1)} MB total, ${Math.round(bytes / files.length / 1024)} KB average`,
);
// pages.ts writes sitemap-pages.xml, one child of the sitemap.xml index sync/contacts.ts assembles from it and
// listingPages.ts together; a bare dry run never sees that index, only the child this generator owns.
console.log(`sitemap-pages.xml: ${(readFileSync(join(out, "sitemap-pages.xml"), "utf8").match(/<loc>/g) || []).length} urls`);
console.log(`out: ${out}`);

const show = (file: string) => {
  let html: string;
  try {
    html = readFileSync(join(out, "p", file), "utf8");
  } catch {
    console.log(`\n${file}: not produced (fewer than 3 listings, or none)`);
    return;
  }
  console.log(`\n${file} (${Math.round(html.length / 1024)} KB)`);
  console.log("  title: " + html.match(/<title>([^<]*)<\/title>/)![1]);
  console.log("  h1:    " + html.match(/<h1>([^<]*)<\/h1>/)![1]);
  for (const m of html.matchAll(/<h3>([^<]*)<\/h3><p>([^<]*)<\/p>/g)) console.log(`  Q: ${m[1]}\n  A: ${m[2]}`);
};
show(`${art}-in-${metroId}.html`);
const local = items.filter((i) => i.art === art && i.metroId === metroId).length;
console.log(`\n${art} listings in ${metroId}: ${local}`);
show(`${art}-in-anywhere.html`);
if (cityId) show(`${art}-in-${cityId}.html`);
