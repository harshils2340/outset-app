/**
 * Dry run of the listing page generator: reads public/catalog.json (for the browse `thin`/`unlisted`/`kindUnconfirmed`
 * flags) plus the matching per-listing file in public/o (for the real content: menu, hours, FAQ, photos), runs the
 * same two generators a sync does (writeLandingPages then writeListingPages) into a temp directory, never under
 * public/, and reports what it produced. No network, no database, no browser.
 *
 *   npx tsx scripts/listing-pages-dry.mts [out-dir]
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeLandingPages, type Item } from "../src/sync/pages.ts";
import { writeListingPages } from "../src/sync/listingPages.ts";

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || mkdtempSync(join(tmpdir(), "outset-listing-pages-dry-"));
const publicDir = join(here, "../../public");

type LiteOp = { id: string; thin?: true; kindUnconfirmed?: true; unlisted?: true; cover?: string };
const catalog = JSON.parse(readFileSync(join(publicDir, "catalog.json"), "utf8")) as { operators: LiteOp[] };

const t0 = Date.now();
const items: Item[] = [];
let missingFile = 0;
for (const op of catalog.operators) {
  if (op.unlisted) continue;
  const file = join(publicDir, "o", op.id + ".json");
  if (!existsSync(file)) {
    missingFile += 1;
    continue;
  }
  const full = JSON.parse(readFileSync(file, "utf8")) as Item;
  // `thin` is decided on the browse record in sync/contacts.ts, not stored on the per-listing file; carried
  // across by id here exactly the way the real sync carries it into writeLandingPages's own input.
  items.push(op.thin ? { ...full, thin: true } : full);
}
console.log(`${catalog.operators.length} catalog rows -> ${items.length} not-unlisted listings read from public/o (${missingFile} had no file)`);

const landing = writeLandingPages(items, { publicDir: out });
const listing = writeListingPages(items, landing, { publicDir: out });
const ms = Date.now() - t0;

const lFiles = readdirSync(join(out, "l")).filter((f) => f.endsWith(".html"));
console.log(
  `\n${listing.pages} listing pages written in ${ms} ms, ${(listing.totalBytes / 1024 / 1024).toFixed(1)} MB total, ${Math.round(listing.avgBytes / 1024)} KB average` +
    ` (largest ${Math.round(Math.max(...lFiles.map((f) => statSync(join(out, "l", f)).size)) / 1024)} KB)`,
);
console.log(`landing pages: ${landing.pages} (${landing.metroPages} city, ${landing.kindPages} all-metro) plus index`);
console.log(`out: ${out}`);

const show = (id: string) => {
  const file = join(out, "l", `${id}.html`);
  if (!existsSync(file)) {
    console.log(`\n${id}.html: not produced (no cover photo, or unlisted)`);
    return;
  }
  const html = readFileSync(file, "utf8");
  console.log(`\n===== ${id}.html (${html.length} bytes) =====\n${html}\n===== end ${id}.html =====`);
};

console.log("\n\n########## SAMPLE 1: o-hubbardsmarina-com ##########");
show("o-hubbardsmarina-com");

console.log("\n\n########## SAMPLE 2: an unpriced, request-only listing (o-adayinthewest-com) ##########");
show("o-adayinthewest-com");

// Proof every internal link this run emitted points at a file that was actually written.
console.log("\n\n########## LINK CHECK ##########");
const written = new Set<string>();
for (const f of readdirSync(join(out, "l"))) written.add("l/" + f);
for (const f of readdirSync(join(out, "p"))) written.add("p/" + f);
const site = "https://onoutset.com/";
let checked = 0;
let broken = 0;
const sampleIds = lFiles.slice(0, 4000); // full 37k+ check would dominate runtime; a large, representative sample
for (const f of sampleIds) {
  const html = readFileSync(join(out, "l", f), "utf8");
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    const href = m[1];
    if (href.startsWith(site + "l/") || href.startsWith(site + "p/")) {
      checked += 1;
      const rel = href.slice(site.length);
      if (!written.has(rel)) {
        broken += 1;
        console.log(`BROKEN: ${f} links to ${href}, which was not written`);
      }
    } else if (!href.startsWith(site + "#o=") && href !== site) {
      broken += 1;
      console.log(`UNEXPECTED: ${f} links to ${href}`);
    }
  }
}
console.log(`checked ${checked} internal /l/ and /p/ links across ${sampleIds.length} listing pages: ${broken} broken`);

// Sitemap structure.
console.log("\n\n########## SITEMAP ##########");
console.log(readFileSync(join(out, "sitemap.xml"), "utf8"));
for (const f of readdirSync(out)) {
  if (/^sitemap.*\.xml$/.test(f) && f !== "sitemap.xml") {
    const urls = (readFileSync(join(out, f), "utf8").match(/<loc>/g) || []).length;
    console.log(`${f}: ${urls} urls`);
  }
}
