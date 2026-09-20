import "../src/env.ts";
import { randomUUID } from "node:crypto";
import { db } from "../src/db/client.ts";
import { vendorOf } from "../src/concierge/vendors.ts";
import { usableBookingUrl } from "../src/concierge/plan.ts";
import { crawlOverride, guardLaptopJob, isLaptop } from "../src/scrape/guard.ts";
import { spawnWorkers, withCpuBudget } from "../src/scrape/cpu.ts";

/**
 * Work out what a shop's booking page really runs, by fetching it rather than reading its URL.
 *
 * `booking_url` is classified by pattern-matching the string, so a shop whose link is
 * `theirdomain.com/book` is filed as "hand-built" no matter what is embedded on that page. Capt Zach's
 * Adventures, Papa Joe's Pontoons, Sub Sea Tours and PaddleTap were all showing "price on request" to guests
 * while their live FareHarbor calendars sat one redirect away.
 *
 * How often, measured rather than guessed. Three independent random draws of 120, fetched for real, from
 * the 6,626 operators this queue actually holds:
 *
 * | seed | FareHarbor | readable (+Resova) | any known vendor |
 * | --- | --- | --- | --- |
 * | 11 | 6 | 7 | 31 |
 * | 23 | 7 | 9 | 35 |
 * | 47 | 8 | 8 | 32 |
 * | 360 | 21 (5.8%) | 24 (6.7%, 95% CI 4.1-9.3) | 98 (27.2%) |
 *
 * So **6.7%, not the 13% a sample of 45 suggested** — and about a tenth of those hits sit on links the
 * concierge refuses anyway, so call it 6% that can actually be used: roughly 400 of the 6,626, taking the
 * readable catalog from 1,441 to about 1,840 rather than to 2,600. It is still the cheapest coverage in the
 * product by a wide margin — no new vendor to understand, no browser to drive, no guessing — and the 27%
 * that name some vendor is the real prize, because it says which reader to write next (Peek, then Bookeo).
 *
 * The 13% was high for a reason worth remembering: the pool is not what it was. `widgets` has already tagged
 * 1,536 operators with a `booking_vendor`, 1,380 of them FareHarbor, and those are excluded here. What is
 * left is the part nothing has managed to identify yet, and it is poorer ground by construction.
 *
 *   npx tsx scripts/revendor.mts --limit=120 --dry                look, change nothing
 *   npx tsx scripts/revendor.mts --limit=120 --order=random       measure the rate, unbiased
 *   npx tsx scripts/revendor.mts --limit=2000 --write             store what it finds (worker only)
 *
 * One fetch per shop, so at any size this is a crawl and belongs on the Render worker. The laptop cap is
 * small and deliberate, and the one-crawl-at-a-time lock is taken even for a dry run, because a dry run
 * fetches exactly as much as a real one.
 */

const args = process.argv.slice(2);
const arg = (k: string): string | undefined => args.find((a) => a.startsWith("--" + k + "="))?.split("=").slice(1).join("=");

/**
 * A bad number used to become `NaN` and take the whole run with it quietly: `Math.min(NaN, 10)` is `NaN`,
 * `Array.from({ length: NaN })` is empty, and `Promise.all([])` resolves at once. `--concurrency=six`
 * printed "0 checked" and looked like an empty queue rather than a typo.
 */
function num(k: string, fallback: number): number {
  const raw = arg(k);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    console.error(`--${k}=${raw} is not a positive whole number.`);
    process.exit(2);
  }
  return n;
}

const limit = num("limit", 100);
const concurrency = Math.min(num("concurrency", 6), 10);
const write = args.includes("--write");
const order = arg("order") ?? (arg("seed") ? "random" : "demand");
if (order !== "demand" && order !== "random") {
  console.error(`--order=${order} is not one of: demand, random.`);
  process.exit(2);
}
/**
 * A sample ordered by demand and review count is not a sample of the 6,626; it is a sample of the famous
 * ones, and their booking pages are not built like everybody else's. Measuring the rate needs a random draw,
 * and checking the rate is stable needs a *different* random draw, so the ordering is seeded and reportable
 * rather than `RANDOM()`: `--seed=2` twice gives the same shops, `--seed=3` gives an independent set.
 */
const seed = num("seed", 1);

const LAPTOP_CAP = 120;
if (isLaptop() && limit > LAPTOP_CAP && !crawlOverride()) {
  console.error(
    `One fetch per shop is a crawl. On a laptop this is capped at ${LAPTOP_CAP}; asked for ${limit}.\n` +
      `Run it on the Render worker (outset-pipeline), or sample with --limit=${LAPTOP_CAP}.`,
  );
  process.exit(2);
}

guardLaptopJob({ name: "revendor", limit, concurrency });

/** The vendors a reader exists for today. Everything else is recorded but changes no answer yet. */
const READABLE = new Set(["fareharbor", "resova"]);

/** Links that already name a vendor we can read need no second look. */
const ALREADY = "(f.fact_value LIKE '%fareharbor%' OR f.fact_value LIKE '%resova%')";

/**
 * What this run has already decided about a shop. `booking_vendor` is the answer when there was one;
 * `booking_recheck` is written whatever the answer, including "unknown", because otherwise every rerun
 * spends its whole budget re-fetching the same hand-built pages that said nothing the first time. The
 * original code skipped the write on "unknown" and its own comment claimed the opposite.
 */
const DECIDED = "(v.fact_key = 'booking_vendor' OR v.fact_key = 'booking_recheck')";

/** `crawl_demand` is created lazily by the concierge, so a fresh database has no such table. */
const hasDemand = !!db
  .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'crawl_demand'")
  .get();

type Target = { id: string; name: string; domain: string; url: string };

/**
 * One row per operator: a crawl that found the widget on two of their pages writes two `booking_url` facts,
 * and joining straight to facts fetches the same shop twice in a run.
 *
 * The row taken is the one with the **lowest rowid**, because that is the one the concierge reads — its
 * `LIMIT 1` with no ORDER BY comes back off `idx_facts_op_key` in rowid order. `MIN(f.fact_value)` took the
 * alphabetically first instead, and for Jet Ski Clearwater Beach that was `/about-us/`: we fetched a page
 * nobody reads, promoted it, and the concierge went on quoting `/group-tours/`, which is not a feed. Fetch
 * exactly what the guest's answer will be built from.
 *
 * An operator who already carries a readable link somewhere is skipped outright, not just on the row: their
 * `/book` page nearly always redirects to the same FareHarbor account we already hold, which would be
 * counted as a new win and is not one.
 */
const rows = db
  .prepare(
    `SELECT t.id, t.name, t.domain, z.fact_value AS url
       FROM (
         SELECT o.id AS id, o.name AS name, o.domain AS domain, MIN(f.rowid) AS rid
           FROM facts f JOIN operators o ON o.id = f.operator_id
           ${hasDemand ? "LEFT JOIN crawl_demand d ON d.operator_id = o.id" : ""}
          WHERE f.fact_key = 'booking_url' AND f.fact_value LIKE 'http%' AND NOT ${ALREADY}
            AND NOT EXISTS (SELECT 1 FROM facts v WHERE v.operator_id = o.id AND ${DECIDED})
            AND NOT EXISTS (SELECT 1 FROM facts r WHERE r.operator_id = o.id AND r.fact_key = 'booking_url'
                              AND (r.fact_value LIKE '%fareharbor%' OR r.fact_value LIKE '%resova%'))
          GROUP BY o.id
          ORDER BY ${
            order === "random"
              ? // A uuid is random hex, so eight characters of it from a seeded offset is a cheap, stable shuffle.
                `substr(o.id || o.id, 1 + (${seed} % 30), 8)`
              : `${hasDemand ? "MAX(COALESCE(d.asks, 0)) DESC," : ""} o.review_count DESC NULLS LAST`
          }
          LIMIT ?
       ) t JOIN facts z ON z.rowid = t.rid`,
  )
  .all(limit * 3) as Target[];

/**
 * 16% of the booking links in this catalog point somewhere else entirely, and the concierge already refuses
 * them (`usableBookingUrl`). Re-detecting one is worse than a wasted fetch: BreakOut Escapes' link is a rival
 * axe-throwing company's home page, that page is FareHarbor, and promoting it filed a *competitor's live
 * calendar* under BreakOut Escapes — a link the concierge was rejecting now arrives on a vendor host it
 * trusts. A link the answer would never use is not worth a fetch and must never be laundered into one.
 */
const skipped: string[] = [];
const targets = rows
  .filter((t) => {
    if (usableBookingUrl(t.url, t.domain)) return true;
    skipped.push(t.name);
    return false;
  })
  .slice(0, limit);

if (skipped.length) console.log(`skipping ${skipped.length} links the concierge would refuse anyway (another operator's site, or a host that never takes bookings)`);

if (!targets.length) {
  console.log("Nothing left to re-detect.");
  process.exit(0);
}

console.log(
  `re-detecting ${targets.length} booking pages, ${concurrency} at a time, ` +
    `${order === "random" ? `random (seed ${seed})` : "most-asked-for first"}${write ? "" : " (dry run)"}\n`,
);

const insFact = db.prepare(
  "INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?, ?, ?, ?, ?, 'revendor')",
);
/**
 * The readable link has to *win*, and a second `booking_url` fact does not win. `candidates()` in
 * `concierge/plan.ts` reads `(SELECT fact_value ... WHERE fact_key = 'booking_url' LIMIT 1)` with no
 * ORDER BY, which SQLite answers from `idx_facts_op_key` in rowid order — so the older, hand-built link
 * wins and the FareHarbor page we just found is never opened. Verified on a live row.
 *
 * So the fetched link is moved aside rather than duplicated: the existing fact becomes the hosted URL, and
 * the shop's own page is kept under `booking_page` so this is reversible and nothing is lost. The row's
 * confidence changes to 'revendor' at the same time, which matters twice over: `enrich/structure.ts` deletes
 * every confidence='site' fact when a site is re-crawled, so a 'site' row would be silently undone while the
 * marker that stops us looking again survived; and when the crawl re-adds its own link afterwards, ours
 * already holds the lower rowid and still wins.
 */
const promote = db.prepare(
  "UPDATE facts SET fact_value = ?, source_url = ?, confidence = 'revendor' WHERE operator_id = ? AND fact_key = 'booking_url' AND fact_value = ?",
);
const hasFact = db.prepare("SELECT 1 FROM facts WHERE operator_id = ? AND fact_key = ? AND fact_value = ? LIMIT 1");

let readable = 0, other = 0, none = 0, failed = 0, promoted = 0, i = 0;
const byVendor: Record<string, number> = {};

/**
 * `vendorOf` swallows its own errors, but a fetch that hangs past its abort — a server that dribbles bytes,
 * a redirect chain that never ends — would hold a worker for the length of the run. Nothing is worth more
 * than half a minute of a crawl this small.
 */
async function detect(url: string): Promise<{ vendor: string; hostedUrl: string | null } | null> {
  try {
    return await withCpuBudget(
      () =>
        Promise.race([
          vendorOf(url),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error("stuck")), 30_000).unref()),
        ]),
      "net",
    );
  } catch {
    return null;
  }
}

async function worker(): Promise<void> {
  while (i < targets.length) {
    const t = targets[i++];
    const v = await detect(t.url);
    if (!v) failed += 1;
    const vendor = v?.vendor ?? "unknown";
    byVendor[vendor] = (byVendor[vendor] || 0) + 1;

    const canRead = vendor !== "unknown" && READABLE.has(vendor);
    if (vendor === "unknown") none += 1;
    else if (canRead) readable += 1;
    else other += 1;

    if (vendor !== "unknown") {
      console.log(
        `  ${canRead ? "READABLE" : "        "} ${vendor.padEnd(12)} ${t.name.slice(0, 30).padEnd(32)} ${(v?.hostedUrl ?? "").slice(0, 52)}`,
      );
    }

    if (!write) continue;
    /**
     * One marker per shop whatever the answer, so a second run never pays for the same page twice, and the
     * vendor itself only when there was one — "unknown" is not a booking vendor and would be read as one by
     * everything else that keys on that fact.
     */
    insFact.run(randomUUID(), t.id, "booking_recheck", vendor, t.url);
    if (vendor !== "unknown") insFact.run(randomUUID(), t.id, "booking_vendor", vendor, t.url);
    if (canRead && v?.hostedUrl && v.hostedUrl.startsWith("http") && v.hostedUrl !== t.url) {
      if (!hasFact.get(t.id, "booking_url", v.hostedUrl)) {
        insFact.run(randomUUID(), t.id, "booking_page", t.url, t.url);
        promote.run(v.hostedUrl, t.url, t.id, t.url);
        promoted += 1;
      }
    }
  }
}

await Promise.all(Array.from({ length: spawnWorkers(concurrency) }, worker));

const n = targets.length;
const pc = (x: number): string => ((x / n) * 100).toFixed(1) + "%";
console.log(`\n${n} checked${order === "random" ? `, at random (seed ${seed})` : ""}`);
console.log(`  readable today (no new code)  ${String(readable).padStart(4)}  ${pc(readable)}`);
console.log(`  another known vendor          ${String(other).padStart(4)}  ${pc(other)}`);
console.log(`  no vendor on the page         ${String(none).padStart(4)}  ${pc(none)}`);
// `vendorOf` answers "unknown" for a page that 404s or refuses as well as for one that is genuinely
// hand-built, so this counts only the fetches that threw or had to be cut off, not every page that failed.
console.log(`    of those, threw or hung     ${String(failed).padStart(4)}  ${pc(failed)}`);
console.log("\n  vendors seen:");
for (const [k, c] of Object.entries(byVendor).sort((a, b) => b[1] - a[1])) console.log("   " + String(c).padStart(4), k);
if (write) console.log(`\n${promoted} booking links moved to the vendor's own page; those shops are readable now.`);
else console.log("\n(dry run: nothing stored. Pass --write to keep it.)");
