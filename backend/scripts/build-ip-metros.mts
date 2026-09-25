/**
 * Builds backend/data/geo/ip-metros.bin, the IP-to-metro table `/where` answers from, out of the free DB-IP
 * City Lite CSV (CC BY 4.0, https://db-ip.com/db/download/ip-to-city-lite). Run monthly, when DB-IP publishes
 * a new file:
 *
 *   curl -sLo /tmp/dbip.csv.gz https://download.db-ip.com/free/dbip-city-lite-$(date +%Y-%m).csv.gz
 *   npx tsx scripts/build-ip-metros.mts /tmp/dbip.csv.gz
 *
 * Only ranges within REACH_KM of one of our metros are kept, each mapped to the nearest, and neighbouring
 * ranges that agree are merged, so a 900 MB city database becomes a few megabytes of the addresses we can
 * actually place. Everything else answers null and the home falls back to the browser's time zone as before.
 *
 * Attribution: the site credits DB-IP in its footer, which the licence requires. Keep that if this table stays.
 */
import { createReadStream, createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { METROS } from "../src/taxonomy/catalog.ts";
import { encode, ipv4ToInt, ipv6Top64, mergeAdjacent, type Range4, type Range6 } from "../src/lib/ipMetro.ts";

const REACH_KM = 120;
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "data", "geo", "ip-metros.bin");

/**
 * With no file given (the Render build runs it this way), fetch this month's file, or last month's while
 * DB-IP has not published the new one yet. The table is not committed: it is 24 MB that changes monthly, so
 * it is built into the deploy instead, and a build that cannot fetch it leaves the API answering nulls, which
 * the home takes as "use the time zone", the same as before this table existed. Never a failed deploy.
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
  console.log("build-ip-metros: no DB-IP file could be fetched; /where will answer without a city until the next deploy");
  process.exit(0);
}

const metros = METROS.map((m) => ({ id: m.id, lat: m.lat, lon: m.lon, kx: Math.cos((m.lat * Math.PI) / 180) }));
function nearest(lat: number, lon: number): number | null {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < metros.length; i++) {
    const m = metros[i];
    const dy = (lat - m.lat) * 111;
    const dx = (lon - m.lon) * 111 * m.kx;
    const d = dy * dy + dx * dx;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best >= 0 && Math.sqrt(bestD) <= REACH_KM ? best : null;
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

const v4: Range4[] = [];
const v6: Range6[] = [];
let rows = 0;
let kept = 0;
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
  if (metro == null) continue;
  const a4 = ipv4ToInt(f[0]);
  if (a4 != null) {
    const b4 = ipv4ToInt(f[1]);
    if (b4 != null && b4 >= a4) { v4.push({ start: a4, end: b4, metro }); kept++; }
    continue;
  }
  const a6 = ipv6Top64(f[0]);
  const b6 = ipv6Top64(f[1]);
  if (a6 != null && b6 != null && b6 >= a6) { v6.push({ start: a6, end: b6, metro }); kept++; }
}
v4.sort((a, b) => a.start - b.start);
v6.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
const m4 = mergeAdjacent(v4);
const m6 = mergeAdjacent(v6);
const table = { metros: metros.map((m) => m.id), v4: m4, v6: m6 };
mkdirSync(dirname(out), { recursive: true });
const buf = encode(table);
writeFileSync(out, buf);
console.log(`rows ${rows.toLocaleString()}, within ${REACH_KM} km of a metro ${kept.toLocaleString()}, merged to ${m4.length.toLocaleString()} v4 + ${m6.length.toLocaleString()} v6 ranges, ${(buf.length / 1e6).toFixed(1)} MB -> ${out}`);
