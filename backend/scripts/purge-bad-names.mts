import "../src/env.ts";
import { db } from "../src/db/client.ts";
import { BAD_NAME } from "../src/enrich/images.ts";

/**
 * Apply the crawler's filename rule to photos already in the database. Images the crawl now skips by name
 * (safety guides, waivers, scanned pages, flyers, gift cards, thumbnails) were stored before the rule grew, and
 * a guest gallery full of booklet pages sells nothing. Free and instant: no network. Covers lost here fall back
 * to the operator's next photo at sync time. Pass --dry to count only.
 *   npx tsx scripts/purge-bad-names.mts [--dry]
 */
const dry = process.argv.includes("--dry");
db.exec("PRAGMA busy_timeout = 180000");
const rows = db.prepare("SELECT id, operator_id, fact_key, fact_value FROM facts WHERE fact_key IN ('photo','cover')").all() as { id: string; operator_id: string; fact_key: string; fact_value: string }[];
const nameOf = (url: string) => { try { return decodeURIComponent(url.split("?")[0].split("/").pop() || ""); } catch { return url.split("/").pop() || ""; } };
const bad = rows.filter((r) => BAD_NAME.test(nameOf(r.fact_value)));
const hits: Record<string, number> = {};
for (const r of bad) { const m = nameOf(r.fact_value).match(BAD_NAME); if (m) hits[m[0].toLowerCase()] = (hits[m[0].toLowerCase()] || 0) + 1; }
console.log(`${rows.length} photo facts, ${bad.length} fail the filename rule (${new Set(bad.map((r) => r.operator_id)).size} operators)`);
console.log(Object.entries(hits).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => k + ":" + v).join("  "));
if (dry) process.exit(0);
const del = db.prepare("DELETE FROM facts WHERE id = ?");
db.exec("BEGIN IMMEDIATE");
for (const r of bad) del.run(r.id);
db.exec("COMMIT");
console.log(`deleted ${bad.length}`);
