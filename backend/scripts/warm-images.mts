/**
 * Pre-warm the wsrv.nl image proxy so the first guest never waits on a cold resize.
 * Reads public/catalog.json, and for every cover requests the card-size and hero-size proxy URLs,
 * the same URLs src/lib/images.ts builds (proxyUrl is copied verbatim; keep the two in step).
 *
 *   npx tsx backend/scripts/warm-images.mts [--limit 3000] [--offset 0] [--concurrency 12] [--sizes card,hero]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// RATE NOTE: wsrv.nl banned this machine (HTTP 403, error code 1106) after a 3,000-cover warm at concurrency 12.
// Keep concurrency at 2, add a pause between requests, and never warm more than a few hundred per run.
type PhotoSize = "thumb" | "card" | "wide" | "hero" | "full";
const WIDTH: Record<PhotoSize, number> = { thumb: 240, card: 360, wide: 800, hero: 1280, full: 1600 };
const SKIP = /^data:|wsrv\.nl|images\.weserv\.nl|\.svg(\?|$)|\.gif(\?|$)/i;

function proxyUrl(url: string, size: PhotoSize, w: number): string {
  const square = size === "thumb" || size === "card";
  const bare = url.replace(/^https?:\/\//i, "");
  return (
    "https://wsrv.nl/?url=" + encodeURIComponent(bare) + "&w=" + w + (square ? "&h=" + w + "&fit=cover" : "") + "&output=webp&q=" + (square ? 68 : 78) + "&il&n=-1"
  );
}

/** Both srcset candidates for a slot: the 1x width and the 2x width. */
function candidates(url: string, size: PhotoSize): string[] {
  if (SKIP.test(url) || !/^https?:\/\//i.test(url)) return [];
  const w = WIDTH[size];
  return [proxyUrl(url, size, w / 2), proxyUrl(url, size, w)];
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const limit = +arg("limit", "3000");
const offset = +arg("offset", "0");
const concurrency = +arg("concurrency", "12");
const sizes = arg("sizes", "card,hero").split(",").filter((s): s is PhotoSize => s in WIDTH);
const TIMEOUT_MS = 15_000;

const catalogPath = resolve(process.cwd(), "public/catalog.json");
const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as { operators: { id: string; cover?: string }[] };
const covers = catalog.operators.map((o) => o.cover).filter((c): c is string => typeof c === "string" && c.length > 0);
const slice = covers.slice(offset, offset + limit);
const urls = slice.flatMap((c) => sizes.flatMap((s) => candidates(c, s)));
console.log(`covers ${covers.length} total, warming ${slice.length} (offset ${offset}) -> ${urls.length} proxy URLs, concurrency ${concurrency}`);

let ok = 0, failed = 0, timedOut = 0, done = 0;
const statuses = new Map<number, number>();
const times: number[] = [];
const started = Date.now();

async function warm(url: string): Promise<void> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    // GET rather than HEAD: the proxy only renders and caches the resize when a body is produced.
    const res = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": "outset-warm/1" } });
    await res.arrayBuffer(); // drain so the connection is reused; the bytes are discarded
    statuses.set(res.status, (statuses.get(res.status) || 0) + 1);
    if (res.ok) ok++; else failed++;
  } catch (e) {
    if ((e as Error).name === "AbortError") timedOut++;
    failed++;
  } finally {
    clearTimeout(timer);
    times.push(Date.now() - t0);
    done++;
    if (done % 200 === 0) console.log(`${done}/${urls.length} ok ${ok} failed ${failed} (${timedOut} timeouts) ${((Date.now() - started) / 1000).toFixed(0)}s`);
  }
}

let next = 0;
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (next < urls.length) await warm(urls[next++]);
}));

times.sort((a, b) => a - b);
const q = (p: number) => times[Math.min(times.length - 1, Math.floor(p * times.length))] || 0;
const secs = (Date.now() - started) / 1000;
console.log(`done in ${secs.toFixed(1)}s: ${urls.length} requests, ok ${ok}, failed ${failed} (${(100 * failed / Math.max(1, urls.length)).toFixed(1)}%), timeouts ${timedOut}`);
console.log(`response time median ${q(0.5)}ms p90 ${q(0.9)}ms; statuses ${JSON.stringify(Object.fromEntries(statuses))}`);
