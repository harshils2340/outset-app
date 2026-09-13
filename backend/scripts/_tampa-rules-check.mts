/**
 * What the listing-cleanup rules change in Tampa, printed so a human can check every one of them.
 *
 * Reads only: the shared connection is pinned with PRAGMA query_only, and this script's own handle is opened
 * read-only, so nothing here can write to data/outset.db. Nothing is written to public/ either: it calls
 * `buildCatalogItems`, the pure half of the catalog sync.
 *
 *   npx tsx scripts/_tampa-rules-check.mts
 */
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../src/db/client.ts";
import { buildCatalogItems, startCleanupLog } from "../src/sync/contacts.ts";

const here = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.OUTSET_DB || process.env.OUTSET_DB_PATH || join(here, "../data/outset.db");
// Proof the file is intact when this finishes: a second, read-only handle on the same database.
const ro = new DatabaseSync(dbPath, { readOnly: true });
const before = (ro.prepare("SELECT COUNT(*) AS n FROM operators").get() as { n: number }).n;
db.exec("PRAGMA query_only = ON");

const log = startCleanupLog();
const t0 = Date.now();
const items = buildCatalogItems((r) => r.metro_id === "tampa");
const secs = ((Date.now() - t0) / 1000).toFixed(1);

const section = (title: string) => console.log("\n" + "=".repeat(100) + "\n" + title + "\n" + "=".repeat(100));

section("1. Option prices nulled (name | was | why) — " + log.priceNulled.length + " of " + items.reduce((n, i) => n + ((i.options as unknown[]) || []).length, 0) + " options");
for (const p of log.priceNulled) console.log(p.id.padEnd(30) + " | " + p.name.slice(0, 58).padEnd(58) + " | $" + String(p.oldPrice).padEnd(7) + " | " + p.why);

section("2. Paragraphs sentence-cased — " + log.shouted.length);
for (const s of log.shouted) {
  console.log(s.id + "  [" + s.field + "]");
  console.log("   before: " + s.before);
  console.log("   after : " + s.after);
}

section("3. Repeated sentences and bullets dropped — " + log.deduped.length);
for (const d of log.deduped) console.log(d.id.padEnd(30) + " | " + d.field.padEnd(12) + " | " + d.text);

section("4. Duplicate operators dropped — " + log.dupes.length);
for (const d of log.dupes) console.log("kept " + d.kept.padEnd(32) + " dropped " + d.dropped.padEnd(32) + " (" + d.shared + ", " + d.why + ")");

const priced = items.flatMap((i) => ((i.options as { price: number | null }[]) || []).map((o) => o.price)).filter((n): n is number => n != null && n > 0);
section("Totals");
console.log("Tampa listings: " + items.length + "  options with a price: " + priced.length + "  lowest surviving price: $" + Math.min(...priced) + "  built in " + secs + "s");
const froms = items
  .map((i) => ({ title: String(i.title), from: Math.min(...(((i.options as { price: number | null }[]) || []).map((o) => o.price).filter((n): n is number => n != null && n > 0) as number[])) }))
  .filter((x) => Number.isFinite(x.from))
  .sort((a, b) => a.from - b.from)
  .slice(0, 12);
console.log("Cheapest listing 'from' prices after the rules:");
for (const f of froms) console.log("  $" + String(f.from).padEnd(8) + f.title);

const after = (ro.prepare("SELECT COUNT(*) AS n FROM operators").get() as { n: number }).n;
console.log("\noperators rows before/after: " + before + "/" + after + " (read-only run)");
