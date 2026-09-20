import { db } from "../db/client.ts";
import { getAvailability, vendorFor } from "../enrich/availability.ts";
import { type Exchange } from "../enrich/__tests__/fixtures/replay.ts";
import { guardLaptopJob, isLaptop } from "../scrape/guard.ts";
import { measureIdle, MIN_IDLE } from "../scrape/cpu.ts";
import { caseId, LIVE_INDEX_KEY_URL, replayKey, saveCase, type AvailCase, type CaseVendor } from "./availCases.ts";

/**
 * Record real booking systems answering, so the reader can be replayed against them for ever afterwards.
 *
 * This is the only part of the suite that touches the network, and it is a crawl: it asks other companies'
 * servers for their calendars. It therefore obeys the same rules as every other crawl in this repository. On
 * this Mac it takes the single crawl lock, refuses to go past a small cap, and waits when the machine is busy.
 * A run over the whole catalog belongs on the Render worker, and the command says so rather than doing it.
 *
 * What it records is every HTTP exchange the reader made, keyed the way replay.ts keys them, plus the answer
 * the reader gave at that moment. The answer is kept as `observed`, and is a regression lock and nothing more:
 * whether it was right is decided later, by availChecks.ts, by a model, or by a person, and stored separately.
 *
 * Capture is one operator at a time on purpose. Two at once would interleave their fetches through the one
 * global hook and each case would end up holding the other's exchanges.
 */

/** The cap a laptop run may not exceed. Matches the 40 sites the crawl rules allow on this machine. */
export const LAPTOP_MAX = 40;

export type CaptureOpts = {
  /** How many operators per vendor. The corpus wants breadth over depth: many shops, one window each. */
  perVendor: number;
  vendors: CaseVendor[];
  from: string;
  days: number;
  /** Seconds to wait between operators. Somebody else's server is answering these. */
  pauseMs: number;
};

export type CaptureRow = { id: string; domain: string; vendor: CaseVendor; live: boolean; days: number; slots: number; calls: number; error?: string };

/**
 * Candidate shops, by vendor, spread over as many different domains as the catalog holds.
 *
 * Ordered by the operator's own id rather than at random so a re-run captures the same shops and a case can be
 * refreshed in place. A shop already in the corpus is still returned: re-recording it is how a case is kept
 * current when a vendor changes their feed.
 */
export function candidates(vendor: CaseVendor, limit: number): { operatorId: string; domain: string; bookingUrl: string }[] {
  const rows = db
    .prepare(
      `SELECT o.id AS operatorId, o.domain AS domain, f.fact_value AS bookingUrl
         FROM facts f JOIN operators o ON o.id = f.operator_id
        WHERE f.fact_key = 'booking_url' AND o.domain IS NOT NULL
        ORDER BY o.id`,
    )
    .all() as { operatorId: string; domain: string; bookingUrl: string }[];
  const out: { operatorId: string; domain: string; bookingUrl: string }[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (out.length >= limit) break;
    if (!r.bookingUrl || vendorFor(r.bookingUrl) !== vendor) continue;
    if (seen.has(r.domain)) continue;
    seen.add(r.domain);
    out.push(r);
  }
  return out;
}

/**
 * Run the reader once against a live vendor with every request and response written down.
 *
 * The hook records what came back rather than what the reader made of it, so a case stays usable when the
 * reader is rewritten. Bodies are kept whole: trimming them to the fields today's reader happens to read is
 * how a corpus stops being able to test tomorrow's.
 */
async function recordOne(operatorId: string, from: string, days: number): Promise<{ exchanges: Exchange[]; answer: Awaited<ReturnType<typeof getAvailability>> }> {
  const exchanges: Exchange[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method || "GET").toUpperCase();
    const reqBody = typeof init?.body === "string" ? init.body : null;
    const res = await realFetch(input, init);
    // The reader will read the body itself, so this reads a clone and leaves the original untouched.
    let body = "";
    try {
      body = await res.clone().text();
    } catch {
      body = "";
    }
    const headers: [string, string][] = [];
    for (const k of ["content-type", "location", "set-cookie"]) {
      const v = res.headers.get(k);
      if (v) headers.push([k, v]);
    }
    exchanges.push({ key: replayKey(method, url, reqBody), url: res.url || url, status: res.status, headers, body });
    return res;
  }) as typeof fetch;
  try {
    const answer = await getAvailability(operatorId, from, days);
    return { exchanges, answer };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function capture(opts: CaptureOpts): Promise<CaptureRow[]> {
  const total = opts.perVendor * opts.vendors.length;
  if (isLaptop() && total > LAPTOP_MAX) {
    throw new Error(
      `Refusing to capture ${total} shops on this Mac. The cap here is ${LAPTOP_MAX}. ` +
        `A corpus over the whole catalog runs on the Render worker outset-pipeline: npm run avail:capture -- --per-vendor=200`,
    );
  }
  guardLaptopJob({ name: "avail:capture" });

  const rows: CaptureRow[] = [];
  for (const vendor of opts.vendors) {
    for (const cand of candidates(vendor, opts.perVendor)) {
      if (isLaptop()) {
        // Wait rather than stack work: this machine has to stay usable while the capture runs.
        for (let i = 0; i < 20 && (await measureIdle()) < MIN_IDLE; i += 1) await sleep(3000);
      }
      const id = caseId(vendor, cand.domain);
      try {
        const { exchanges, answer } = await recordOne(cand.operatorId, opts.from, opts.days);
        const synthetic = "case-" + id.replace(/\//g, "-");
        /**
         * Capture ran under the operator's real id, which the reader resolved against the crawl database.
         * Replay has no database, so the case carries the one thing that makes it self contained: the index
         * the reader falls back to, holding this case's synthetic id and nothing else. One entry per case,
         * rather than one index shared by all of them, so a single case still replays on its own.
         */
        exchanges.unshift({
          // Keyed where every case keys it, not at whatever SITE_URL this machine happens to carry.
          key: replayKey("GET", LIVE_INDEX_KEY_URL, null),
          url: LIVE_INDEX_KEY_URL,
          status: 200,
          headers: [["content-type", "application/json"]],
          body: JSON.stringify({ urls: { [synthetic]: cand.bookingUrl } }),
        });
        const kase: AvailCase = {
          id,
          vendor,
          domain: cand.domain,
          bookingUrl: cand.bookingUrl,
          // Synthetic and unique per case: the reader caches a live answer for ten minutes under the real id,
          // and a replay that collided with a capture from the same process would be served from that cache.
          operatorId: "case-" + id.replace(/\//g, "-"),
          from: opts.from,
          days: opts.days,
          capturedAt: new Date().toISOString(),
          observed: answer,
        };
        saveCase(kase, exchanges);
        rows.push({ id, domain: cand.domain, vendor, live: answer.live, days: answer.days.length, slots: answer.days.reduce((n, d) => n + d.slots.length, 0), calls: exchanges.length });
      } catch (e) {
        rows.push({ id, domain: cand.domain, vendor, live: false, days: 0, slots: 0, calls: 0, error: String(e).slice(0, 120) });
      }
      await sleep(opts.pauseMs);
    }
  }
  return rows;
}
