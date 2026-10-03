import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Every URL the crawler, the enrich pass or the API fetches can be one a hacked operator site, a vendor's
 * JSON, or a discovery source chose, not one we chose. `safeFetch` refuses to let that turn into a request
 * against this server's own network: only http/https, only a hostname that resolves to a public address,
 * checked on every redirect hop (a public host can answer with a 302 to an internal one just as easily as
 * the first URL could point at one), and a hard cap on how much of a body it will ever read, because a
 * server that controls its own Content-Length can still send more bytes than it claimed.
 */

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

/** A name that is never a real internet host, whatever it resolves to. */
const BAD_NAME_SUFFIX = /(?:^|\.)(?:local|internal|localhost)$/i;

function inV4Range(addr: string, base: string, bits: number): boolean {
  const toNum = (ip: string) => ip.split(".").reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (toNum(addr) & mask) === (toNum(base) & mask);
}

const V4_BLOCKED: [string, number][] = [
  ["127.0.0.0", 8], // loopback
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["172.16.0.0", 12], // private
  ["192.168.0.0", 16], // private
  ["169.254.0.0", 16], // link-local, carries the cloud metadata address
  ["100.64.0.0", 10], // carrier-grade NAT
];

function isBlockedV4(addr: string): boolean {
  const parts = addr.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return true; // not a real dotted quad, refuse
  return V4_BLOCKED.some(([base, bits]) => inV4Range(addr, base, bits));
}

/** The eight hextets of an IPv6 address, or null when the text is not one. Reads `::` and a dotted v4 tail. */
function hextetsOf(addr: string): number[] | null {
  let s = addr;
  const tail = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (tail) {
    const o = tail[1].split(".").map(Number);
    if (o.some((n) => n > 255)) return null;
    s = s.slice(0, -tail[1].length) + ((o[0] << 8) | o[1]).toString(16) + ":" + ((o[2] << 8) | o[3]).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const parts = [...head, ...Array<string>(fill).fill("0"), ...rest];
  if (parts.length !== 8 || parts.some((x) => !/^[0-9a-f]{1,4}$/.test(x))) return null;
  return parts.map((x) => parseInt(x, 16));
}

/**
 * The IPv4 address written inside an IPv6 one, dotted, or null when there is none: the IPv4-mapped range
 * `::ffff:0:0/96` and the deprecated IPv4-compatible range `::/96`. An IPv4 address is still that address
 * whichever of the two it is spelled in, and the kernel routes both to the same place.
 */
function embeddedV4(hextets: number[]): string | null {
  const zero = hextets.slice(0, 5).every((h) => h === 0);
  if (!zero) return null;
  if (hextets[5] !== 0 && hextets[5] !== 0xffff) return null;
  const [a, b] = [hextets[6], hextets[7]];
  return [a >> 8, a & 0xff, b >> 8, b & 0xff].join(".");
}

function isBlockedV6(raw: string): boolean {
  const addr = raw.toLowerCase();
  if (addr === "::1" || addr === "::") return true;
  // An IPv4 address written inside an IPv6 one is still that IPv4 address. Only the dotted spelling used to be
  // read here ("::ffff:169.254.169.254"), which is the one `node:dns` hands back and the one no URL ever
  // carries: `new URL()` rewrites the tail into hextets, so `http://[::ffff:169.254.169.254]/` arrives as
  // `::ffff:a9fe:a9fe`, matched nothing, and the cloud metadata address was reachable after all. The same went
  // for `::ffff:7f00:1` (loopback) and the IPv4-compatible `::7f00:1`, so a hacked operator page publishing one
  // of those, or redirecting to one, got a request sent to this server's own network. Both spellings now read
  // as the address they are.
  const hextets = hextetsOf(addr);
  if (!hextets) return true; // not an address this guard can read, refuse
  const v4 = embeddedV4(hextets);
  if (v4) return isBlockedV4(v4);
  if (hextets[0] >= 0xfc00 && hextets[0] <= 0xfdff) return true; // fc00::/7 unique local
  if (hextets[0] >= 0xfe80 && hextets[0] <= 0xfebf) return true; // fe80::/10 link-local
  return false;
}

export function isBlockedAddress(addr: string): boolean {
  return isIP(addr) === 6 ? isBlockedV6(addr) : isBlockedV4(addr);
}

/**
 * Throws when `url` must not be connected to: a scheme other than http/https, a name that is never a real
 * internet host, or (after resolving it) an address inside a private, loopback, link-local, carrier-NAT or
 * metadata range. Checks every address a name resolves to, not just the first, since a multi-A-record
 * answer only needs one bad address to reach somewhere it should not.
 */
export async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UnsafeUrlError("scheme not allowed: " + url.protocol);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!hostname) throw new UnsafeUrlError("no host");
  if (BAD_NAME_SUFFIX.test(hostname)) throw new UnsafeUrlError("blocked host name: " + hostname);
  if (isIP(hostname)) {
    if (isBlockedAddress(hostname)) throw new UnsafeUrlError("blocked address: " + hostname);
    return;
  }
  if (!hostname.includes(".")) throw new UnsafeUrlError("bare host name: " + hostname);
  let addresses: string[];
  try {
    addresses = (await lookup(hostname, { all: true, verbatim: true })).map((r) => r.address);
  } catch {
    throw new UnsafeUrlError("dns lookup failed: " + hostname);
  }
  if (!addresses.length) throw new UnsafeUrlError("no address for host: " + hostname);
  for (const addr of addresses) {
    if (isBlockedAddress(addr)) throw new UnsafeUrlError("host resolves to a blocked address: " + hostname + " -> " + addr);
  }
}

export type SafeResponse = {
  ok: boolean;
  status: number;
  /** The address the response actually came from, after every redirect hop. */
  url: string;
  headers: Headers;
  text(): Promise<string>;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export type SafeFetchOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Test-only: replaces the DNS lookup `assertPublicUrl` uses, so a unit test can name a "public" or "private" address without a real network. */
  resolveForTest?: (hostname: string) => Promise<string[]>;
};

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;

async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const len = res.headers.get("content-length");
  if (len && Number(len) > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new UnsafeUrlError("content-length " + len + " exceeds cap of " + maxBytes + " bytes");
  }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new UnsafeUrlError("body exceeded cap of " + maxBytes + " bytes");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

/**
 * A guarded `fetch`. Every hop (the first request and every redirect it follows) is checked with
 * `assertPublicUrl` before a connection is made, so a hacked page that 302s to `http://169.254.169.254/`
 * or a vendor JSON blob that names `http://localhost:6379/` never gets a request sent to it. The body is
 * read under `maxBytes` regardless of what the server's own Content-Length says. Throws `UnsafeUrlError`
 * for anything refused; callers that already wrap fetch in try/catch (every crawler in this codebase does)
 * need no other change.
 */
export async function safeFetch(input: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  let url = new URL(input);
  const deadline = Date.now() + timeoutMs;
  const check = async (u: URL) => {
    if (opts.resolveForTest) {
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new UnsafeUrlError("scheme not allowed: " + u.protocol);
      const addrs = await opts.resolveForTest(u.hostname);
      if (!addrs.length || addrs.some(isBlockedAddress)) throw new UnsafeUrlError("blocked address for host: " + u.hostname);
      return;
    }
    await assertPublicUrl(u);
  };

  let res: Response;
  for (let hop = 0; ; hop++) {
    await check(url);
    const remaining = Math.max(1, deadline - Date.now());
    res = await fetch(url, {
      method: opts.method,
      headers: opts.headers,
      body: opts.body,
      redirect: "manual",
      signal: AbortSignal.timeout(remaining),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.has("location")) {
      if (hop >= maxRedirects) throw new UnsafeUrlError("too many redirects: " + input);
      await res.body?.cancel().catch(() => {});
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    break;
  }

  const buf = await readCapped(res, maxBytes);
  const finalUrl = url.href;
  return {
    ok: res.ok,
    status: res.status,
    url: finalUrl,
    headers: res.headers,
    async text() {
      return buf.toString("utf8");
    },
    async json() {
      return JSON.parse(buf.toString("utf8"));
    },
    async arrayBuffer() {
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
  };
}
