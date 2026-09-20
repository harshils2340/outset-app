import "../src/env.ts";
import { chromium } from "playwright";
import { randomUUID } from "node:crypto";
import { db } from "../src/db/client.ts";
import { sniffBookingPage } from "../src/concierge/sniff.ts";
import { isLaptop } from "../src/scrape/guard.ts";
import { cpuIdle, MIN_IDLE } from "../src/scrape/cpu.ts";

/**
 * Find the availability endpoint behind booking widgets that have no API we know of.
 *
 * 9,016 of our 11,046 booking links look hand-built. The instinct is that those shops are unreadable, and it
 * is wrong: a calendar that shows a guest which times are free had to fetch that list from somewhere. Open
 * the page in a headless browser, watch what it asks for, and keep the request. After that the shop is as
 * cheap to read as FareHarbor — a plain fetch of an endpoint we now know — on a business that never published
 * an API.
 *
 * Three real examples, the ones a guest was being told to telephone:
 *
 *   badaxethrowing.com        -> /wp-json/badaxe/v1/location/list/   30 times, $33.99 and $42.99
 *   lumberjacksaxethrowing.com-> it is FareHarbor. We already read FareHarbor. It was filed as hand-built
 *                                because the booking link was their own page.
 *   riotaxe.com               -> schedulista.com/schedule/widget, a vendor we had never heard of
 *
 * So this does three jobs at once: cracks genuinely custom systems, reclassifies shops we misfiled, and finds
 * vendors worth writing a proper reader for.
 *
 *   npx tsx scripts/sniff-endpoints.mts --limit=40            write what it finds
 *   npx tsx scripts/sniff-endpoints.mts --limit=5 --dry       print and store nothing
 *   npx tsx scripts/sniff-endpoints.mts --url=https://...     one page, for working out why
 *
 * A browser per page makes this a crawl, so it refuses to run at size on a laptop and belongs on the Render
 * worker. Always headless: it must never open a window on somebody's desk.
 */

const args = process.argv.slice(2);
const arg = (k: string) => args.find((a) => a.startsWith("--" + k + "="))?.split("=").slice(1).join("=");
const limit = Number(arg("limit") || 20);
const concurrency = Math.min(Number(arg("concurrency") || 3), 4);
const dry = args.includes("--dry");
const only = arg("url");

const LAPTOP_CAP = 12;
if (!only && isLaptop() && limit > LAPTOP_CAP && !process.env.OUTSET_ALLOW_CRAWL) {
  console.error(
    `A browser per page is a crawl. On a laptop this is capped at ${LAPTOP_CAP} pages; asked for ${limit}.\n` +
      `Run it on the Render worker (outset-pipeline), or pass --limit=${LAPTOP_CAP} or fewer to sample.`,
  );
  process.exit(2);
}

function ensure(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS booking_endpoints (
      id TEXT PRIMARY KEY,
      operator_id TEXT NOT NULL,
      page_url TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      method TEXT NOT NULL,
      post_body TEXT,
      content_type TEXT,
      score INTEGER NOT NULL,
      sample_times TEXT,
      sample_prices TEXT,
      found_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_booking_endpoints_op ON booking_endpoints(operator_id);
  `);
}

type Target = { id: string; name: string; domain: string; url: string };

function targets(): Target[] {
  if (only) return [{ id: "adhoc", name: "ad hoc", domain: new URL(only).hostname, url: only }];
  /**
   * The ones a guest was shown and we could not quote, first — the concierge writes those down in
   * `crawl_demand`. Then anything with a booking link we cannot already read.
   */
  const KNOWN = "(f.fact_value LIKE '%fareharbor%' OR f.fact_value LIKE '%resova%')";
  /**
   * One row per operator. An operator can carry several `booking_url` facts — a crawl that found the widget
   * on two of their pages writes two — and joining straight to facts sniffed the same shop twice in a run.
   */
  return db
    .prepare(
      `SELECT o.id, o.name, o.domain, MIN(f.fact_value) AS url
         FROM facts f JOIN operators o ON o.id = f.operator_id
         LEFT JOIN crawl_demand d ON d.operator_id = o.id
        WHERE f.fact_key = 'booking_url' AND f.fact_value LIKE 'http%' AND NOT ${KNOWN}
          AND NOT EXISTS (SELECT 1 FROM booking_endpoints b WHERE b.operator_id = o.id)
        GROUP BY o.id
        ORDER BY MAX(COALESCE(d.asks, 0)) DESC, o.review_count DESC NULLS LAST
        LIMIT ?`,
    )
    .all(limit) as Target[];
}

ensure();
const list = targets();
if (!list.length) {
  console.log("Nothing to sniff.");
  process.exit(0);
}
console.log(`sniffing ${list.length} booking pages, ${concurrency} at a time${dry ? " (dry)" : ""}\n`);

// Headless without exception.
const browser = await chromium.launch({ headless: true });
const ins = db.prepare(
  `INSERT INTO booking_endpoints (id, operator_id, page_url, endpoint, method, post_body, content_type, score, sample_times, sample_prices, found_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

let found = 0, none = 0, i = 0;
const vendors: Record<string, number> = {};

async function worker(): Promise<void> {
  while (i < list.length) {
    const t = list[i++];
    // The same courtesy the rest of the crawlers show: pause when the machine is busy.
    if (isLaptop() && cpuIdle() < MIN_IDLE + 5) await new Promise((r) => setTimeout(r, 4000));
    const r = await sniffBookingPage(t.url, { browser }).catch((e) => ({ url: t.url, best: null, candidates: [], domTimes: [], note: (e as Error).message.slice(0, 120) }));
    const best = r.best;
    if (!best) {
      none += 1;
      console.log(`  --  ${t.domain.padEnd(34)} ${r.note ?? "nothing"}`);
      continue;
    }
    found += 1;
    const host = new URL(best.url).hostname.replace(/^www\./, "");
    vendors[host] = (vendors[host] || 0) + 1;
    console.log(`  [${String(best.score).padStart(2)}] ${t.domain.padEnd(34)} ${best.method} ${best.url.slice(0, 74)}`);
    if (best.times.length) console.log(`       ${best.times.slice(0, 10).join(" ")}${best.prices.length ? "   " + best.prices.slice(0, 4).map((p) => "$" + p).join(" ") : ""}`);
    if (!dry && t.id !== "adhoc") {
      ins.run(randomUUID(), t.id, t.url, best.url, best.method, best.body, best.type, best.score,
        best.times.slice(0, 20).join(","), best.prices.slice(0, 12).join(","), new Date().toISOString());
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));
await browser.close();

console.log(`\n${found} with an endpoint, ${none} without.`);
const byHost = Object.entries(vendors).sort((a, b) => b[1] - a[1]);
if (byHost.length) {
  console.log("\nwhere those endpoints live (a host that keeps appearing is a vendor worth a proper reader):");
  for (const [h, n] of byHost.slice(0, 14)) console.log("  " + String(n).padStart(3), h);
}
if (dry) console.log("\n(dry run: nothing stored)");
