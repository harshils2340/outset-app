import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Replays one vendor's recorded HTTP exchanges (fixtures/<vendor>/exchanges.json) through globalThis.fetch so a
 * reader runs exactly as it did against the live vendor, with no network. Each exchange is what the reader asked
 * for and what the vendor answered: method, URL, body, status, headers (redirect Location and Set-Cookie
 * included) and the response text.
 *
 * Keys normalise the parts of a request that change with the day the test runs (dates, the calendar month), so
 * a fixture recorded in September replays in March. Two requests with the same key (this month's calendar, next
 * month's) are answered in the order they were recorded.
 *
 * The readers pause between requests with setTimeout; those pauses are collapsed to zero while a replay runs
 * (AbortSignal.timeout is untouched), so a fixture with forty exchanges replays in milliseconds.
 */

export type Exchange = { key: string; url: string; status: number; headers: [string, string][]; body: string };

const here = dirname(fileURLToPath(import.meta.url));

export function normalizeKey(method: string, url: string, body: string | null): string {
  const u = url
    .replace(/\d{4}-\d{2}-\d{2}/g, "DATE")
    .replace(/calendar\/\d{4}\/\d{2}\//g, "calendar/YM/")
    .replace(/year=\d{4}&month=\d{1,2}/g, "year=Y&month=M");
  const b = (body || "").replace(/\d{4}-\d{2}-\d{2}/g, "DATE");
  return method.toUpperCase() + " " + u + (b ? "\n" + b : "");
}

export function loadExchanges(vendor: string): Exchange[] {
  return JSON.parse(readFileSync(join(here, vendor, "exchanges.json"), "utf8")) as Exchange[];
}

function toResponse(e: Exchange): Response {
  const headers = new Headers();
  for (const [k, v] of e.headers) headers.append(k, v);
  // A constructed Response has no body for 204/205/304 and an empty url; the readers read res.url after redirects.
  const res = new Response(e.status === 204 || e.status === 205 || e.status === 304 ? null : e.body, { status: e.status, headers });
  Object.defineProperty(res, "url", { value: e.url });
  return res;
}

/** Runs `fn` with fetch answering from the fixture and pauses collapsed. Unrecorded requests throw, naming the request. */
export async function withReplay<T>(vendor: string, fn: () => Promise<T>): Promise<{ result: T; requests: string[]; unserved: string[] }> {
  const queues = new Map<string, Exchange[]>();
  for (const e of loadExchanges(vendor)) {
    const q = queues.get(e.key) || [];
    q.push(e);
    queues.set(e.key, q);
  }
  const requests: string[] = [];
  const realFetch = globalThis.fetch;
  const realSetTimeout = globalThis.setTimeout;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method || "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : null;
    const key = normalizeKey(method, url, body);
    requests.push(key);
    const q = queues.get(key);
    if (!q || !q.length) throw new Error(`no recorded exchange for ${key}`);
    // The last recording of a repeated key stays available so a retry after a null answer sees the same page.
    const e = q.length > 1 ? q.shift()! : q[0];
    return toResponse(e);
  }) as typeof fetch;
  globalThis.setTimeout = ((fn: (...a: unknown[]) => void, _ms?: number, ...args: unknown[]) => realSetTimeout(fn, 0, ...args)) as typeof setTimeout;
  try {
    const result = await fn();
    const unserved = [...queues.entries()].filter(([, q]) => q.length > 1).map(([k]) => k);
    return { result, requests, unserved };
  } finally {
    globalThis.fetch = realFetch;
    globalThis.setTimeout = realSetTimeout;
  }
}
