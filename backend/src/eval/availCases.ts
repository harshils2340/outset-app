import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Availability } from "../enrich/availability.ts";
import { normalizeKey, type Exchange } from "../enrich/__tests__/fixtures/replay.ts";
import { resetLiveIndexCache } from "../enrich/availability.ts";

/**
 * A corpus of real booking systems, recorded once and replayed for ever, so the availability reader can be
 * scored rather than trusted.
 *
 * The reader in src/enrich/availability.ts answers the only question a guest actually has: is there a seat at
 * seven tonight, and what does it cost. It answers it by reading whatever JSON the operator's booking widget
 * reads, which means its correctness depends on the shape of nine other companies' undocumented feeds. Those
 * shapes change without notice and there is no way to know from the outside that one has, because a reader
 * that has stopped understanding a feed does not crash: it returns `{ live: false }`, or worse, a plausible
 * and wrong list of times, and the page quietly shows nothing or lies.
 *
 * The unit tests beside the reader pin behaviours somebody already thought of, from payloads somebody hand
 * wrote. This is the other half: a few dozen real shops, captured whole, so the questions are the ones real
 * operators' calendars actually pose. Each case is one operator at one moment:
 *
 *   cases/<vendor>/<slug>/case.json          what was asked, and what the reader answered at capture time
 *   cases/<vendor>/<slug>/exchanges.json.gz  every HTTP request and response that answer was built from
 *   cases/<vendor>/<slug>/truth.json         what the answer should have been, decided independently
 *
 * The recordings are gzipped because they are not read by people and they are enormous otherwise: a single
 * FareHarbor company calendar is a third of a megabyte of JSON, and a corpus of a few hundred shops kept as
 * plain text would be a larger thing to clone than the application. They compress about twelvefold.
 *
 * The split between `observed` in case.json and truth.json is the whole point. `observed` locks the reader
 * against silent change, which is a regression test and says nothing about whether it was ever right. truth.json
 * is arrived at without the reader, by the rules in availChecks.ts, by a model reading the raw payload, or by a
 * person looking at the shop's own booking page, and is what accuracy is measured against. A suite that only
 * compares the reader to its own past output will happily certify a bug that has been there from the start.
 */

const here = dirname(fileURLToPath(import.meta.url));
export const CASES_DIR = join(here, "../../data/avail-eval/cases");

export type CaseVendor = "fareharbor" | "peek" | "xola";

export type AvailCase = {
  /** Stable id: "<vendor>/<slug>". The folder path, and what a report names. */
  id: string;
  vendor: CaseVendor;
  /** The real shop, kept so a failure can be checked against the operator's own page by hand. */
  domain: string;
  bookingUrl: string;
  /** A synthetic operator id, unique per case: the reader caches a live answer for ten minutes by this key. */
  operatorId: string;
  /** The window asked for. Replay passes these back, so the same dates are requested however long from now. */
  from: string;
  days: number;
  capturedAt: string;
  /** What the reader said at capture time. A regression lock, not a statement that it was right. */
  observed: Availability;
};

/** What the answer should have been, decided without asking the reader. */
export type AvailTruth = {
  /** How this was arrived at. Only "human" is beyond argument; the other two are evidence. */
  source: "human" | "ai" | "crossread";
  decidedAt: string;
  /** Model id and the run's cost, when a model decided it, so a paid run is accountable afterwards. */
  model?: string;
  costUsd?: number;
  /** Is anything bookable at all in this window? The cheapest question, and the one that matters most. */
  live: boolean;
  /** Every start the operator really offers, "YYYY-MM-DDTHH:MM" in the shop's own wall clock. */
  starts: string[];
  /** Cents, by start, where the payload states one. Absent means the truth source could not tell. */
  priceByStart?: Record<string, number>;
  /** Free text from the adjudicator, so a disagreement can be read rather than guessed at. */
  note?: string;
};

const slugOf = (s: string): string => s.toLowerCase().replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

export function caseId(vendor: CaseVendor, domain: string): string {
  return vendor + "/" + slugOf(domain);
}

export function caseDir(id: string): string {
  return join(CASES_DIR, id);
}

/**
 * Every case on disk, in a stable order so a report reads the same way twice. A folder missing either of its
 * two required files is skipped rather than thrown on: a capture killed half way through leaves one behind,
 * and one bad folder must not take the whole suite down.
 */
export function loadCases(vendors?: CaseVendor[]): AvailCase[] {
  if (!existsSync(CASES_DIR)) return [];
  const out: AvailCase[] = [];
  for (const vendor of readdirSync(CASES_DIR).sort()) {
    if (vendors && !vendors.includes(vendor as CaseVendor)) continue;
    const vdir = join(CASES_DIR, vendor);
    for (const slug of readdirSync(vdir).sort()) {
      const dir = join(vdir, slug);
      const cf = join(dir, "case.json");
      const xf = join(dir, "exchanges.json.gz");
      if (!existsSync(cf) || !existsSync(xf)) continue;
      try {
        out.push(JSON.parse(readFileSync(cf, "utf8")) as AvailCase);
      } catch {
        /* a half written case is not a failing case */
      }
    }
  }
  return out;
}

export function loadExchanges(id: string): Exchange[] {
  return JSON.parse(gunzipSync(readFileSync(join(caseDir(id), "exchanges.json.gz"))).toString("utf8")) as Exchange[];
}

export function loadTruth(id: string): AvailTruth | null {
  const f = join(caseDir(id), "truth.json");
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, "utf8")) as AvailTruth;
  } catch {
    return null;
  }
}

export function saveCase(c: AvailCase, exchanges: Exchange[]): void {
  const dir = caseDir(c.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "case.json"), JSON.stringify(c, null, 2) + "\n");
  writeFileSync(join(dir, "exchanges.json.gz"), gzipSync(Buffer.from(JSON.stringify(exchanges)), { level: 9 }));
}

export function saveTruth(id: string, t: AvailTruth): void {
  mkdirSync(caseDir(id), { recursive: true });
  writeFileSync(join(caseDir(id), "truth.json"), JSON.stringify(t, null, 2) + "\n");
}

/**
 * Where our own booking index sits, for the purpose of a recording.
 *
 * `availability.ts` builds that URL out of `SITE_URL` when it is imported, which is right on a real host: the
 * index is served beside the site. It is wrong in a recording. A rehearsal points `SITE_URL` at its own
 * localhost, as it is told to, and the reader then asked for a key no case holds: the index answered 404, every
 * shop lost its booking link, and 69 of the corpus's assertions failed on a machine where nothing at all was
 * broken. All 39 recorded cases key it here, so this is the form both ends agree on, and a case recorded on a
 * laptop with `SITE_URL` set now replays the same as one recorded without it.
 */
export const LIVE_INDEX_KEY_URL = "https://onoutset.com/live-index.json";

const asRecorded = (url: string): string => (/\/live-index\.json(?:[?#]|$)/.test(url) ? LIVE_INDEX_KEY_URL : url);

/** `normalizeKey`, with the one URL whose host is an environment detail rather than part of the recording. */
export function replayKey(method: string, url: string, body: string | null): string {
  return normalizeKey(method, asRecorded(url), body);
}

/**
 * Answer one case's requests from its recording, with the reader running exactly as it did live.
 *
 * Shares `normalizeKey` with the hand made fixtures under src/enrich/__tests__/fixtures so there is one rule
 * for what counts as the same request, and so a case recorded in September replays in March: the key blanks
 * the dates and the calendar month, which are the parts of a URL that move with the calendar.
 *
 * A request the recording does not hold answers 404 rather than throwing. A live capture is a budget of three
 * calls and a vendor that answered slowly got fewer; a reader that then asks a fourth question during replay
 * should see what it would have seen live, which is nothing, not an exception that fails the case for a
 * reason that has nothing to do with correctness.
 */
export async function withCase<T>(exchanges: Exchange[], fn: () => Promise<T>): Promise<{ result: T; asked: string[]; unused: string[] }> {
  const queues = new Map<string, Exchange[]>();
  for (const e of exchanges) {
    const q = queues.get(e.key) || [];
    q.push(e);
    queues.set(e.key, q);
  }
  const served = new Set<string>();
  const asked: string[] = [];
  // Each case carries its own one-entry booking index, and the reader keeps one for an hour. Without this the
  // first case's index would answer for every later case, and each would report "no booking url".
  resetLiveIndexCache();
  const realFetch = globalThis.fetch;
  const realSetTimeout = globalThis.setTimeout;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method || "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : null;
    const key = replayKey(method, url, body);
    asked.push(key);
    const q = queues.get(key);
    if (!q || !q.length) return new Response("{}", { status: 404 });
    served.add(key);
    const e = q.length > 1 ? q.shift()! : q[0];
    const headers = new Headers();
    for (const [k, v] of e.headers) headers.append(k, v);
    const res = new Response(e.status === 204 || e.status === 205 || e.status === 304 ? null : e.body, { status: e.status, headers });
    Object.defineProperty(res, "url", { value: e.url });
    return res;
  }) as typeof fetch;
  // The readers pause between calls to be polite to someone else's server. Nobody is being called here.
  globalThis.setTimeout = ((f: (...a: unknown[]) => void, _ms?: number, ...args: unknown[]) => realSetTimeout(f, 0, ...args)) as typeof setTimeout;
  try {
    const result = await fn();
    return { result, asked, unused: [...queues.keys()].filter((k) => !served.has(k)) };
  } finally {
    globalThis.fetch = realFetch;
    globalThis.setTimeout = realSetTimeout;
  }
}
