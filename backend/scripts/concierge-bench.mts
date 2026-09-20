import { db } from "../src/db/client.ts";
import { CATEGORIES } from "../src/taxonomy/catalog.ts";
import { plan } from "../src/concierge/plan.ts";

/**
 * A benchmark across the catalog, not one listing.
 *
 * Every fix this session was verified against one escape room in one town. That is how a bug like the
 * `avail`/Vail one hides for months: it only shows up once the sentence, the city or the category changes.
 * This samples broadly on purpose — random categories, random cities, random party sizes, some queries with a
 * time named and some without — and reports what a guest actually gets: how often the agent reads a real,
 * live calendar rather than falling back to a published price, how long that took, and where the coverage
 * gaps are, broken out by category so the next reader to write is the one that pays off most.
 */

const SAMPLE = Number(process.env.BENCH_N) || 80;
const CONCURRENCY = Number(process.env.BENCH_CONCURRENCY) || 5;
const ASK = 5;
const DEADLINE_MS = 5000;

type Row = {
  category: string;
  city: string;
  region: string;
  party: number;
  sentence: string;
  saidTime: boolean;
  atMinute: number | null;
  ms: number;
  total: number;
  quoted: number;
  priced: number;
  routes: Record<string, number>;
  followUp: boolean;
  timeProven: boolean | null; // null when no time was asked for
  error: string | null;
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// A broad spread of towns, not just the handful with the deepest catalog. Mixes big metros with
// mid-size and small ones so "how well does this work outside the five cities everyone tests" is answerable.
const CITIES = db
  .prepare(
    `SELECT city, region, COUNT(*) n FROM operators WHERE lat IS NOT NULL AND city IS NOT NULL AND length(city) >= 4
       GROUP BY lower(city), region HAVING n >= 8 ORDER BY n DESC LIMIT 200`,
  )
  .all() as { city: string; region: string; n: number }[];

// Categories actually present in the catalog with a meaningful number of businesses, so a sample is never
// spent on a category with three operators nationwide.
const catCounts = new Map(
  (db.prepare(`SELECT category_id, COUNT(*) n FROM operators WHERE lat IS NOT NULL GROUP BY category_id`).all() as { category_id: string; n: number }[]).map(
    (r) => [r.category_id, r.n],
  ),
);
const LIVE_CATEGORIES = CATEGORIES.filter((c) => (catCounts.get(c.id) ?? 0) >= 30);

const DAYS = ["today", "tonight", "tomorrow", "this saturday", "this weekend", "next friday", "on sunday"];
const TIMES = ["at 5pm", "at 3pm", "around 6:30pm", "at 11am", "at noon", "in the evening"];

function sentenceFor(): { category: (typeof CATEGORIES)[number]; city: string; region: string; party: number; sentence: string; saidTime: boolean } {
  const category = pick(LIVE_CATEGORIES);
  const spot = pick(CITIES);
  const party = 2 + Math.floor(Math.random() * 7);
  const day = pick(DAYS);
  const saidTime = Math.random() < 0.5;
  const time = saidTime ? " " + pick(TIMES) : "";
  const sentence = `${category.searchQuery} in ${spot.city}${time}, ${day}, ${party} of us`;
  return { category, city: spot.city, region: spot.region, party, sentence, saidTime };
}

async function run(): Promise<void> {
  const jobs = Array.from({ length: SAMPLE }, sentenceFor);
  const results: Row[] = [];
  let i = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const idx = i++;
      if (idx >= jobs.length) return;
      const job = jobs[idx];
      const t0 = Date.now();
      try {
        const a = await plan(job.sentence, { ask: ASK, deadlineMs: DEADLINE_MS });
        const ms = Date.now() - t0;
        const routes: Record<string, number> = {};
        for (const o of a.options) routes[o.route] = (routes[o.route] ?? 0) + 1;
        const quoted = a.options.filter((o) => o.departures.length).length;
        const priced = a.options.filter((o) => !o.departures.length && o.services.some((s) => s.price != null)).length;
        let timeProven: boolean | null = null;
        if (a.intent.atMinute != null) {
          timeProven = a.options.some((o) => o.departures.some((d) => {
            const [hh, mm] = d.time.split(":").map(Number);
            return Math.abs(hh * 60 + mm - a.intent.atMinute!) <= 90;
          }));
        }
        results.push({
          category: job.category.id, city: job.city, region: job.region, party: job.party,
          sentence: job.sentence, saidTime: job.saidTime, atMinute: a.intent.atMinute,
          ms, total: a.options.length, quoted, priced, routes,
          followUp: !!a.followUp, timeProven, error: null,
        });
      } catch (e) {
        results.push({
          category: job.category.id, city: job.city, region: job.region, party: job.party,
          sentence: job.sentence, saidTime: job.saidTime, atMinute: null,
          ms: Date.now() - t0, total: 0, quoted: 0, priced: 0, routes: {}, followUp: false,
          timeProven: null, error: (e as Error).message.slice(0, 200),
        });
      }
      process.stderr.write(".");
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  process.stderr.write("\n");
  report(results);
}

function pct(n: number, d: number): string {
  return d ? ((100 * n) / d).toFixed(0) + "%" : "n/a";
}

function report(rows: Row[]): void {
  const ok = rows.filter((r) => !r.error);
  const errored = rows.filter((r) => r.error);
  const withLive = ok.filter((r) => r.quoted > 0);
  const withAnything = ok.filter((r) => r.quoted > 0 || r.priced > 0);
  const askedTime = ok.filter((r) => r.atMinute != null);
  const provenTime = askedTime.filter((r) => r.timeProven);

  const totalRoutes: Record<string, number> = {};
  for (const r of ok) for (const [k, v] of Object.entries(r.routes)) totalRoutes[k] = (totalRoutes[k] ?? 0) + v;

  const times = ok.map((r) => r.ms).sort((a, b) => a - b);
  const p = (q: number) => (times.length ? times[Math.min(times.length - 1, Math.floor(times.length * q))] : 0);

  console.log("\n=== Concierge benchmark: " + rows.length + " queries across " + new Set(ok.map((r) => r.city)).size + " cities and " + new Set(ok.map((r) => r.category)).size + " categories ===\n");
  console.log(`Answered:        ${ok.length}/${rows.length} (${errored.length} threw)`);
  console.log(`Live times:      ${withLive.length}/${ok.length}  (${pct(withLive.length, ok.length)})`);
  console.log(`Anything useful: ${withAnything.length}/${ok.length}  (${pct(withAnything.length, ok.length)}) — live time or a published price`);
  console.log(`Follow-up asked: ${ok.filter((r) => r.followUp).length}/${ok.length}`);
  console.log(`Latency:         p50 ${p(0.5)}ms  p90 ${p(0.9)}ms  max ${times[times.length - 1] ?? 0}ms`);
  console.log(`Booking routes across all candidates seen: ${JSON.stringify(totalRoutes)}`);
  if (askedTime.length) {
    console.log(`\nAsked for a specific time: ${askedTime.length}/${ok.length} queries.`);
    console.log(`  Proved a live slot within 90min of that time: ${provenTime.length}/${askedTime.length} (${pct(provenTime.length, askedTime.length)})`);
    const example = askedTime.find((r) => r.timeProven);
    if (example) console.log(`  Example: "${example.sentence}" -> live slot found near the requested time.`);
  }

  console.log("\n--- Live-time hit rate by category ---");
  const byCat = new Map<string, { n: number; live: number }>();
  for (const r of ok) {
    const s = byCat.get(r.category) ?? { n: 0, live: 0 };
    s.n++; if (r.quoted > 0) s.live++;
    byCat.set(r.category, s);
  }
  const catRows = [...byCat.entries()].sort((a, b) => b[1].n - a[1].n);
  for (const [cat, s] of catRows) console.log(`  ${cat.padEnd(16)} ${String(s.live).padStart(2)}/${String(s.n).padEnd(2)} live  (${pct(s.live, s.n)})`);

  const zeroLive = catRows.filter(([, s]) => s.live === 0 && s.n >= 2);
  if (zeroLive.length) {
    console.log("\n--- Categories with zero live coverage in this sample (candidates for the next reader) ---");
    for (const [cat, s] of zeroLive) console.log(`  ${cat} (${s.n} queries, 0 live)`);
  }

  if (errored.length) {
    console.log("\n--- Errors ---");
    for (const r of errored.slice(0, 10)) console.log(`  "${r.sentence}" -> ${r.error}`);
  }
}

await run();
process.exit(0);
