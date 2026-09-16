import { fetchHtml, robotsAllowed } from "../scrape/fetch.ts";
import { safeFetch } from "../lib/safeFetch.ts";

/**
 * Polite fetching for database-free discovery (chains, OpenStreetMap by name, the Brave Search API).
 *
 * Every page fetch goes through `fetchHtml`, which honours robots.txt and sends a From header naming who we
 * are. On top of that this keeps one request at a time per host and a pause between two requests to the same
 * host (or the site's robots.txt Crawl-delay, when longer), whatever the caller does, so a registry entry cannot turn into a burst against one company's site.
 * Nothing here opens SQLite: these modules run on GitHub runners.
 */

export const BOT = "Mozilla/5.0 (compatible; OutsetBot/0.2; +https://onoutset.com; supply discovery)";

const hostTail = new Map<string, Promise<void>>();
const hostLast = new Map<string, number>();

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const crawlDelays = new Map<string, Promise<number>>();

/** Crawl-delay for user-agent * (or ours) from robots.txt, in ms, capped at 30 s. Fetched once per host. */
function crawlDelayMs(origin: string): Promise<number> {
  if (!crawlDelays.has(origin)) {
    crawlDelays.set(
      origin,
      safeFetch(new URL("/robots.txt", origin).href, { headers: { "user-agent": BOT }, timeoutMs: 8000, maxBytes: 300_000 })
        .then(async (res) => {
          if (!res.ok) return 0;
          let applies = false;
          let delay = 0;
          for (const raw of (await res.text()).split(/\r?\n/)) {
            const [k, ...rest] = raw.replace(/#.*$/, "").split(":");
            const v = rest.join(":").trim();
            if (/^\s*user-agent\s*$/i.test(k)) applies = v === "*" || /outset/i.test(v);
            else if (applies && /^\s*crawl-delay\s*$/i.test(k) && Number(v) > 0) delay = Math.max(delay, Number(v) * 1000);
          }
          return Math.min(delay, 30_000);
        })
        .catch(() => 0),
    );
  }
  return crawlDelays.get(origin)!;
}

/** Run `fn` when this host is free and at least `gapMs` after its previous request. */
export async function perHost<T>(url: string, fn: () => Promise<T>, gapMs = 1500): Promise<T> {
  const u = new URL(url);
  const host = u.hostname;
  gapMs = Math.max(gapMs, await crawlDelayMs(u.origin));
  const prev = hostTail.get(host) || Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  hostTail.set(host, prev.then(() => mine));
  await prev;
  try {
    const wait = (hostLast.get(host) || 0) + gapMs - Date.now();
    if (wait > 0) await sleep(wait);
    return await fn();
  } finally {
    hostLast.set(host, Date.now());
    release();
  }
}

/** A page through fetchHtml (robots.txt, identity), one at a time per host. Never throws: status 0 is a failure. */
export async function getPage(url: string, gapMs = 1500): Promise<{ status: number; html: string; finalUrl: string }> {
  try {
    return await perHost(url, () => fetchHtml(url), gapMs);
  } catch (e) {
    return { status: 0, html: "", finalUrl: url + " (" + (e as Error).message.slice(0, 60) + ")" };
  }
}

/** JSON from a store-locator endpoint, same robots.txt check and per-host pacing. Returns null on any failure. */
export async function getJson<T = unknown>(url: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}, gapMs = 1500): Promise<T | null> {
  try {
    const u = new URL(url);
    if (!(await robotsAllowed(u.origin, u.pathname))) return null;
    return await perHost(url, async () => {
      const res = await safeFetch(url, {
        method: init.method || "GET",
        body: init.body,
        headers: { accept: "application/json, text/plain, */*", "user-agent": BOT, ...(init.headers || {}) },
        timeoutMs: 20000,
        maxBytes: 8_000_000,
      });
      if (!res.ok) return null;
      return (await res.json()) as T;
    }, gapMs);
  } catch {
    return null;
  }
}
