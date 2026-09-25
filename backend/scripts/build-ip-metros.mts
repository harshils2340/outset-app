/**
 * Builds backend/data/geo/ip-metros.bin, the IP-to-metro table `/where` answers from, out of the free DB-IP
 * City Lite CSV (CC BY 4.0, https://db-ip.com/db/download/ip-to-city-lite).
 *
 *   npm run geo:build                       fetches this month's file (or last month's) and builds
 *   npx tsx scripts/build-ip-metros.mts <dbip-city-lite-YYYY-MM.csv.gz>   builds from a file in hand
 *
 * Only ranges within REACH_KM of one of our metros are kept, each mapped to the nearest, and neighbouring
 * ranges that agree are merged, so a 900 MB city database becomes a 24 MB table of the addresses we can
 * actually place. Everything else answers null and the home falls back to the browser's time zone as before.
 *
 * Memory: the 2.5 million kept ranges live in typed arrays, not objects, so the whole build peaks well under
 * 150 MB and can run on the API's own instance at boot when the deploy did not build the table (serve.ts).
 *
 * Attribution: the site credits DB-IP in its footer, which the licence requires. Keep that if this table stays.
 */
import { createReadStream, createWriteStream, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { METROS } from "../src/taxonomy/catalog.ts";
import { ipv4ToInt, ipv6Top64, TABLE_MAGIC } from "../src/lib/ipMetro.ts";

const REACH_KM = 120;
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "data", "geo", "ip-metros.bin");

/**
 * With no file given (the Render build and the API's boot run it this way), fetch this month's file, or last
 * month's while DB-IP has not published the new one yet. A fetch that fails leaves the API answering nulls,
 * which the home takes as "use the time zone", the same as before this table existed. Never a failed deploy.
 */
async function fetchLatest(): Promise<string | null> {
  const now = new Date();
  for (const back of [0, 1]) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const url = `https://download.db-ip.com/free/dbip-city-lite-${month}.csv.gz`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      if (!res.ok || !res.body) { console.log(`${url}: ${res.status}`); continue; }
      const file = join(tmpdir(), `dbip-city-lite-${month}.csv.gz`);
      await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), createWriteStream(file));
      console.log(`fetched ${url}`);
      return file;
    } catch (e) {
      console.log(`${url}: ${(e as Error).message}`);
    }
  }
  return null;
}

const src = process.argv[2] || (await fetchLatest());
if (!src) {
  console.log("build-ip-metros: no DB-IP file could be fetched; /where will answer without a city until the next try");
  process.exit(0);
}

const metros = METROS.map((m) => ({ id: m.id, lat: m.lat, lon: m.lon, kx: Math.cos((m.lat * Math.PI) / 180) }));
function nearest(lat: number, lon: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < metros.length; i++) {
    const m = metros[i];
    const dy = (lat - m.lat) * 111;
    const dx = (lon - m.lon) * 111 * m.kx;
    const d = dy * dy + dx * dx;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best >= 0 && Math.sqrt(bestD) <= REACH_KM ? best : -1;
}

/** One CSV row of DB-IP lite: start, end, continent, country, region, city, lat, lon. City may be quoted. */
function fields(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === "," && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Growable columns: the rows arrive sorted by address, so the table can be written straight out afterwards. */
class Cols<A extends Uint32Array | BigUint64Array> {
  n = 0;
  constructor(public start: A, public end: A, public metro = new Uint8Array(start.length)) {}
  grow(make: (n: number) => A) {
    if (this.n < this.start.length) return;
    const bigger = (old: A) => { const b = make(old.length * 2); b.set(old as never); return b; };
    this.start = bigger(this.start);
    this.end = bigger(this.end);
    const m = new Uint8Array(this.metro.length * 2); m.set(this.metro); this.metro = m;
  }
}
const v4 = new Cols(new Uint32Array(1 << 20), new Uint32Array(1 << 20));
const v6 = new Cols(new BigUint64Array(1 << 20), new BigUint64Array(1 << 20));

/** Append a range, merging it into the previous one when they touch and agree on the metro. */
function push4(s: number, e: number, m: number) {
  const i = v4.n - 1;
  if (i >= 0 && v4.metro[i] === m && v4.end[i] + 1 >= s) { if (e > v4.end[i]) v4.end[i] = e; return; }
  v4.grow((n) => new Uint32Array(n));
  v4.start[v4.n] = s; v4.end[v4.n] = e; v4.metro[v4.n] = m; v4.n++;
}
function push6(s: bigint, e: bigint, m: number) {
  const i = v6.n - 1;
  if (i >= 0 && v6.metro[i] === m && v6.end[i] + 1n >= s) { if (e > v6.end[i]) v6.end[i] = e; return; }
  v6.grow((n) => new BigUint64Array(n));
  v6.start[v6.n] = s; v6.end[v6.n] = e; v6.metro[v6.n] = m; v6.n++;
}

let rows = 0;
let kept = 0;
let last4 = -1;
let last6 = -1n;
const rl = createInterface({ input: createReadStream(src).pipe(createGunzip()), crlfDelay: Infinity });
for await (const line of rl) {
  rows++;
  const f = fields(line);
  if (f.length < 8) continue;
  const country = f[3];
  if (country !== "US" && country !== "CA") continue;
  const lat = Number(f[6]);
  const lon = Number(f[7]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;
  const metro = nearest(lat, lon);
  if (metro < 0) continue;
  const a4 = ipv4ToInt(f[0]);
  if (a4 != null) {
    const b4 = ipv4ToInt(f[1]);
    // The file is sorted; a row out of order would break the binary search, so it is dropped rather than trusted.
    if (b4 != null && b4 >= a4 && a4 > last4) { push4(a4, b4, metro); last4 = b4; kept++; }
    continue;
  }
  const a6 = ipv6Top64(f[0]);
  const b6 = ipv6Top64(f[1]);
  if (a6 != null && b6 != null && b6 >= a6 && a6 > last6) { push6(a6, b6, metro); last6 = b6; kept++; }
}

// Same layout decode() in ipMetro.ts reads: magic, metro ids, v4 ranges, v6 ranges, little-endian throughout.
const enc = new TextEncoder();
const ids = metros.map((m) => enc.encode(m.id));
const size = 4 + 4 + ids.reduce((n, b) => n + 1 + b.length, 0) + 4 + v4.n * 9 + 4 + v6.n * 17;
const buf = Buffer.alloc(size);
let o = 0;
buf.write(TABLE_MAGIC, o, "ascii"); o += 4;
buf.writeUInt32LE(metros.length, o); o += 4;
for (const b of ids) { buf.writeUInt8(b.length, o++); buf.set(b, o); o += b.length; }
buf.writeUInt32LE(v4.n, o); o += 4;
for (let i = 0; i < v4.n; i++) { buf.writeUInt32LE(v4.start[i], o); buf.writeUInt32LE(v4.end[i], o + 4); buf.writeUInt8(v4.metro[i], o + 8); o += 9; }
buf.writeUInt32LE(v6.n, o); o += 4;
for (let i = 0; i < v6.n; i++) { buf.writeBigUInt64LE(v6.start[i], o); buf.writeBigUInt64LE(v6.end[i], o + 8); buf.writeUInt8(v6.metro[i], o + 16); o += 17; }
mkdirSync(dirname(out), { recursive: true });
// Written beside and renamed into place, so a reader never sees a half-written table.
writeFileSync(out + ".tmp", buf);
renameSync(out + ".tmp", out);
console.log(`rows ${rows.toLocaleString()}, within ${REACH_KM} km of a metro ${kept.toLocaleString()}, merged to ${v4.n.toLocaleString()} v4 + ${v6.n.toLocaleString()} v6 ranges, ${(buf.length / 1e6).toFixed(1)} MB -> ${out}`);
