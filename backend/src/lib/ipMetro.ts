/**
 * Which of our metros a visitor's IP address sits in, from a compact table built out of the free DB-IP City
 * Lite database (CC BY 4.0, https://db-ip.com) by `scripts/build-ip-metros.mts`.
 *
 * Why this exists: the home opens on where the guest is, and the only signal it had was Cloudflare's city
 * headers, which Render's edge never sends (only the country arrives). So the guess fell through to the
 * browser's time zone, and everyone on America/New_York opened on New York, Miami and Boston included.
 *
 * The table keeps only the address ranges that sit within reach of one of our metros (US and Canada), each
 * range mapped to the nearest metro and merged with its neighbours when they agree, so the whole thing is a
 * few megabytes and one binary search per request. IPv4 ranges are 32-bit; IPv6 ranges are keyed on the
 * top 64 bits, which is coarser than any ISP allocation and so loses nothing.
 *
 * File layout, all little-endian:
 *   "IPM1" | u32 metroCount | metroCount × (u8 len, utf8 id) | u32 n4 | n4 × (u32 start, u32 end, u8 metro)
 *   | u32 n6 | n6 × (u64 start, u64 end, u8 metro)
 */
import { readFileSync } from "node:fs";

export type Range4 = { start: number; end: number; metro: number };
export type Range6 = { start: bigint; end: bigint; metro: number };
export type Table = { metros: string[]; v4: Range4[]; v6: Range6[] };

export function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return null;
  let n = 0;
  for (let i = 1; i <= 4; i++) {
    const b = Number(m[i]);
    if (b > 255) return null;
    n = n * 256 + b;
  }
  return n;
}

/** The top 64 bits of an IPv6 address as a BigInt, or null when the text is not one. Handles `::` and a v4 tail. */
export function ipv6Top64(ip: string): bigint | null {
  let s = ip.trim().toLowerCase();
  if (s.startsWith("[")) s = s.slice(1, s.indexOf("]"));
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  if (!s.includes(":")) return null;
  // A dotted IPv4 tail ("::ffff:1.2.3.4") becomes two hextets.
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (tail) {
    const v4 = ipv4ToInt(tail[1]);
    if (v4 == null) return null;
    s = s.slice(0, -tail[1].length) + (v4 >>> 16).toString(16) + ":" + (v4 & 0xffff).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const parts = [...head, ...Array(fill).fill("0"), ...rest];
  if (parts.length !== 8 || parts.some((p) => !/^[0-9a-f]{1,4}$/.test(p))) return null;
  let n = 0n;
  for (let i = 0; i < 4; i++) n = (n << 16n) | BigInt(parseInt(parts[i], 16));
  return n;
}

/** Merge runs of adjacent ranges that map to the same metro, so the table is as small as the geography allows. */
export function mergeAdjacent<T extends { start: number | bigint; end: number | bigint; metro: number }>(sorted: T[]): T[] {
  const out: T[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    // `+ 1` works for number and bigint alike only through the typed branches below.
    const touches = last && last.metro === r.metro && (typeof r.start === "bigint" ? (last.end as bigint) + 1n >= (r.start as bigint) : (last.end as number) + 1 >= (r.start as number));
    if (touches) {
      if (r.end > last.end) last.end = r.end;
    } else out.push({ ...r });
  }
  return out;
}

function find<T extends { start: number | bigint; end: number | bigint; metro: number }>(list: T[], key: number | bigint): number | null {
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = list[mid];
    if (key < r.start) hi = mid - 1;
    else if (key > r.end) lo = mid + 1;
    else return r.metro;
  }
  return null;
}

/** The metro id for an address, or null when it is not near any of ours (or is not an address at all). */
export function lookup(t: Table, ip: string): string | null {
  const v4 = ipv4ToInt(ip);
  if (v4 != null) {
    const i = find(t.v4, v4);
    return i == null ? null : t.metros[i];
  }
  const v6 = ipv6Top64(ip);
  if (v6 == null) return null;
  // A v4-mapped address ("::ffff:a.b.c.d") is really a v4 one; its top 64 bits are all zero.
  if (v6 === 0n) {
    const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
    if (tail) return lookup(t, tail[1]);
  }
  const i = find(t.v6, v6);
  return i == null ? null : t.metros[i];
}

export function encode(t: Table): Buffer {
  const enc = new TextEncoder();
  const ids = t.metros.map((m) => enc.encode(m));
  const size = 4 + 4 + ids.reduce((n, b) => n + 1 + b.length, 0) + 4 + t.v4.length * 9 + 4 + t.v6.length * 17;
  const buf = Buffer.alloc(size);
  let o = 0;
  buf.write("IPM1", o, "ascii"); o += 4;
  buf.writeUInt32LE(t.metros.length, o); o += 4;
  for (const b of ids) { buf.writeUInt8(b.length, o++); buf.set(b, o); o += b.length; }
  buf.writeUInt32LE(t.v4.length, o); o += 4;
  for (const r of t.v4) { buf.writeUInt32LE(r.start, o); buf.writeUInt32LE(r.end, o + 4); buf.writeUInt8(r.metro, o + 8); o += 9; }
  buf.writeUInt32LE(t.v6.length, o); o += 4;
  for (const r of t.v6) { buf.writeBigUInt64LE(r.start, o); buf.writeBigUInt64LE(r.end, o + 8); buf.writeUInt8(r.metro, o + 16); o += 17; }
  return buf;
}

export function decode(buf: Buffer): Table {
  if (buf.toString("ascii", 0, 4) !== "IPM1") throw new Error("not an IPM1 table");
  let o = 4;
  const metroCount = buf.readUInt32LE(o); o += 4;
  const metros: string[] = [];
  for (let i = 0; i < metroCount; i++) { const len = buf.readUInt8(o++); metros.push(buf.toString("utf8", o, o + len)); o += len; }
  const n4 = buf.readUInt32LE(o); o += 4;
  const v4: Range4[] = new Array(n4);
  for (let i = 0; i < n4; i++) { v4[i] = { start: buf.readUInt32LE(o), end: buf.readUInt32LE(o + 4), metro: buf.readUInt8(o + 8) }; o += 9; }
  const n6 = buf.readUInt32LE(o); o += 4;
  const v6: Range6[] = new Array(n6);
  for (let i = 0; i < n6; i++) { v6[i] = { start: buf.readBigUInt64LE(o), end: buf.readBigUInt64LE(o + 8), metro: buf.readUInt8(o + 16) }; o += 17; }
  return { metros, v4, v6 };
}

export const TABLE_MAGIC = "IPM1";

let loaded: Table | null = null;
let lastTry = 0;
const RETRY_MS = 30_000;

/**
 * The table built for this deploy, read once it exists. While it is absent (the build is still fetching the
 * DB-IP file at boot, or could not) this answers null and looks again every half minute, so `/where` starts
 * placing visitors the moment the file lands without a restart.
 */
export function ipTable(path: string): Table | null {
  if (loaded) return loaded;
  const now = Date.now();
  if (now - lastTry < RETRY_MS) return null;
  lastTry = now;
  try {
    loaded = decode(readFileSync(path));
  } catch {
    loaded = null;
  }
  return loaded;
}
