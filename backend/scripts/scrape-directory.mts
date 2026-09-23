import "../src/env.ts";
import { db } from "../src/db/client.ts";
import { ingestAll } from "../src/ingest/load.ts";
import { scrapeOperator } from "../src/scrape/run.ts";
import { refreshAllScores } from "../src/lib/completeness.ts";
import { measureIdle } from "../src/scrape/cpu.ts";

/**
 * Scrape the operators discovered from directories (origin 'directory'), one at a time, so the businesses
 * DropzoneFinder, SkydivingSource, indoorclimbing.com and the WATL list gave us get something read off their
 * own site and can publish. scrapePending picks oldest-updated first, so these freshly imported rows would be
 * last; this targets them directly.
 *
 * Harshil lifted the Mac-crawl ban on 23 September 2026 with one condition: idle must not sit below 5% for more
 * than a minute. This is plain HTTP fetch (scrapeOperator), not a browser fan-out, so load is light, and the
 * loop still watches idle between sites and waits when the laptop is busy. Free: no AI extraction here, that is
 * the separate paid `enrich` step.
 *
 *   npx tsx scripts/scrape-directory.mts            every origin='directory' operator not scraped yet
 *   npx tsx scripts/scrape-directory.mts --limit=50
 */

const arg = (name: string, fallback: number): number => {
  const a = process.argv.find((x) => x.startsWith("--" + name + "="));
  return a ? Number(a.split("=")[1]) : fallback;
};
const limit = arg("limit", 1000);
const FLOOR = 5; // % idle; Harshil's condition
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

ingestAll();

const rows = db
  .prepare(
    // Never actually site-scraped: the only source rows are discovery provenance ("discover-directory:*"), not a
    // crawl of the operator's own site. website present (import guarantees it for directory rows).
    `SELECT o.id, o.website, o.name FROM operators o
     WHERE o.origin = 'directory' AND o.website IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM sources s WHERE s.operator_id = o.id AND s.extractor NOT LIKE 'discover%')
     ORDER BY o.updated_at ASC LIMIT ?`,
  )
  .all(limit) as { id: string; website: string; name: string }[];

console.log(`${rows.length} directory operators to scrape.`);
let done = 0;
let ok = 0;
let belowSince = 0;
for (const row of rows) {
  // Honour the CPU floor: if idle is under 5%, wait for it to recover before starting another site, and never
  // let it sit below for more than a minute of continuous checks.
  for (;;) {
    const idle = await measureIdle();
    if (idle >= FLOOR) {
      belowSince = 0;
      break;
    }
    if (!belowSince) belowSince = Date.now();
    const stuckMs = Date.now() - belowSince;
    console.log(`  idle ${idle.toFixed(1)}% under ${FLOOR}%, waiting (${Math.round(stuckMs / 1000)}s)`);
    await sleep(5000);
    if (stuckMs > 60_000) {
      console.log("  idle under floor for over a minute, stopping so the laptop stays usable.");
      refreshAllScores();
      console.log(`Scraped ${ok} of ${done} attempted before stopping.`);
      process.exit(0);
    }
  }
  try {
    const r = await scrapeOperator({ operatorId: row.id, website: row.website, fallbackName: row.name });
    if (r && !r.robotsBlocked && r.pages > 0) ok++;
  } catch (e) {
    console.log(`  ${row.name}: ${String((e as Error).message).slice(0, 100)}`);
  }
  done++;
  if (done % 20 === 0) console.log(`  ${done}/${rows.length} (${ok} read something)`);
  await sleep(600);
}
refreshAllScores();
console.log(`Done. ${ok} of ${rows.length} directory operators now have something read from their site.`);
process.exit(0);
