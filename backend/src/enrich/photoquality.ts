/**
 * Photo quality screen: is this image a real photograph, or a map, logo, flyer, screenshot or blank tile?
 * Judged from the pixels, not the file name. We pull a 32x32 PNG through the wsrv.nl proxy the app already
 * uses for thumbnails, decode it with Node's zlib (no npm dependency), and read a handful of statistics:
 * palette size, white and black coverage, saturation, edge density and Hasler-Süsstrunk colourfulness.
 */
import { inflateSync } from "node:zlib";

export type PhotoKind = "photo" | "graphic" | "map" | "document" | "unknown";

export type PhotoStats = {
  colours: number;      // distinct colours after quantising to 4 bits per channel (max 4096)
  white: number;        // fraction of pixels with every channel > 235
  black: number;        // fraction of pixels with every channel < 20
  saturation: number;   // mean HSV saturation, 0..1
  edges: number;        // fraction of neighbouring pairs whose luminance differs by more than 40
  colourfulness: number;// Hasler-Süsstrunk metric; photos are usually 20+, maps and pastel graphics under ~25
  top4: number;         // share of pixels held by the 4 most common quantised colours
  alpha: number;        // fraction of transparent pixels, 0 when the PNG has no alpha
};

export type PhotoVerdict = { kind: PhotoKind; stats: PhotoStats | null; reason?: string };

const SIZE = 32;
const TIMEOUT_MS = 10_000;
const cache = new Map<string, Promise<PhotoVerdict>>();

/** Same URL shape as src/lib/images.ts thumb(), but PNG so we can decode it without a codec. */
export function tinyUrl(url: string, w = SIZE): string {
  const bare = url.replace(/^https?:\/\//i, "");
  return "https://wsrv.nl/?url=" + encodeURIComponent(bare) + "&w=" + w + "&h=" + w + "&fit=cover&output=png";
}

// ---------- PNG decoding ----------

function u32(b: Uint8Array, i: number): number {
  return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
}

/** Decode an 8-bit PNG (RGB, RGBA, grey, grey+alpha or palette; non-interlaced) into RGBA pixels. */
export function decodePng(buf: Uint8Array): { width: number; height: number; rgba: Uint8Array } | null {
  if (buf.length < 33 || buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
  let width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  const idat: Uint8Array[] = [];
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  let i = 8;
  while (i + 8 <= buf.length) {
    const len = u32(buf, i);
    const type = String.fromCharCode(buf[i + 4], buf[i + 5], buf[i + 6], buf[i + 7]);
    const data = buf.subarray(i + 8, i + 8 + len);
    if (type === "IHDR") {
      width = u32(data, 0);
      height = u32(data, 4);
      depth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    i += 12 + len;
  }
  if (!width || !height || depth !== 8 || interlace !== 0) return null;
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
  if (!channels || (colorType === 3 && !palette)) return null;
  const total = idat.reduce((n, d) => n + d.length, 0);
  const joined = new Uint8Array(total);
  let off = 0;
  for (const d of idat) { joined.set(d, off); off += d.length; }
  let raw: Uint8Array;
  try { raw = inflateSync(joined); } catch { return null; }
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return null;
  const px = new Uint8Array(stride * height);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = row[x];
      switch (filter) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default: return null;
      }
      cur[x] = v & 0xff;
    }
    px.set(cur, y * stride);
    prev = cur;
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const s = p * channels;
    let r: number, g: number, b: number, a = 255;
    if (colorType === 3) {
      const idx = px[s];
      r = palette![idx * 3]; g = palette![idx * 3 + 1]; b = palette![idx * 3 + 2];
      if (trns && idx < trns.length) a = trns[idx];
    } else if (channels <= 2) {
      r = g = b = px[s];
      if (channels === 2) a = px[s + 1];
    } else {
      r = px[s]; g = px[s + 1]; b = px[s + 2];
      if (channels === 4) a = px[s + 3];
    }
    rgba[p * 4] = r; rgba[p * 4 + 1] = g; rgba[p * 4 + 2] = b; rgba[p * 4 + 3] = a;
  }
  return { width, height, rgba };
}

// ---------- statistics ----------

export function computeStats(width: number, height: number, rgba: Uint8Array): PhotoStats {
  const n = width * height;
  const counts = new Map<number, number>();
  let white = 0, black = 0, satSum = 0, alpha = 0;
  const lum = new Float32Array(n);
  const rg: number[] = [], yb: number[] = [];
  for (let p = 0; p < n; p++) {
    let r = rgba[p * 4], g = rgba[p * 4 + 1], b = rgba[p * 4 + 2];
    const a = rgba[p * 4 + 3];
    if (a < 128) alpha += 1;
    // Transparent pixels are shown on white in the app, so composite them the same way.
    if (a < 255) { const k = a / 255; r = Math.round(r * k + 255 * (1 - k)); g = Math.round(g * k + 255 * (1 - k)); b = Math.round(b * k + 255 * (1 - k)); }
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    counts.set(key, (counts.get(key) || 0) + 1);
    if (r > 235 && g > 235 && b > 235) white += 1;
    if (r < 20 && g < 20 && b < 20) black += 1;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    satSum += max === 0 ? 0 : (max - min) / max;
    lum[p] = 0.299 * r + 0.587 * g + 0.114 * b;
    rg.push(r - g);
    yb.push(0.5 * (r + g) - b);
  }
  let pairs = 0, strong = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (x + 1 < width) { pairs += 1; if (Math.abs(lum[p] - lum[p + 1]) > 40) strong += 1; }
      if (y + 1 < height) { pairs += 1; if (Math.abs(lum[p] - lum[p + width]) > 40) strong += 1; }
    }
  }
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const std = (v: number[], m: number) => Math.sqrt(v.reduce((s, x) => s + (x - m) * (x - m), 0) / v.length);
  const mRg = mean(rg), mYb = mean(yb);
  const colourfulness = Math.sqrt(std(rg, mRg) ** 2 + std(yb, mYb) ** 2) + 0.3 * Math.sqrt(mRg * mRg + mYb * mYb);
  const top4 = [...counts.values()].sort((a, b) => b - a).slice(0, 4).reduce((s, x) => s + x, 0) / n;
  return {
    colours: counts.size,
    white: white / n,
    black: black / n,
    saturation: satSum / n,
    edges: pairs ? strong / pairs : 0,
    colourfulness,
    top4,
    alpha: alpha / n,
  };
}

// ---------- classification ----------

/**
 * Thresholds tuned on 60 random catalog covers plus known flyers, posters and map tiles (September 2026).
 * Bias: never reject a real photo; letting a few graphics through is fine.
 */
export function classify(s: PhotoStats): { kind: PhotoKind; reason: string } {
  const round = (x: number) => Math.round(x * 100) / 100;
  if (s.alpha > 0.25) return { kind: "graphic", reason: "transparent " + round(s.alpha) };
  if (s.colours < 40) return { kind: "graphic", reason: "colours " + s.colours };
  if (s.white > 0.55) return { kind: "graphic", reason: "white " + round(s.white) };
  if (s.black > 0.6) return { kind: "graphic", reason: "black " + round(s.black) };
  if (s.edges < 0.03 && s.saturation < 0.2) return { kind: "graphic", reason: "flat " + round(s.edges) };
  // Flyers and posters: a bright page with a small hard-edged palette and a lot of white.
  if (s.white > 0.35 && s.colours < 90 && s.edges > 0.12) return { kind: "graphic", reason: "poster white " + round(s.white) + " colours " + s.colours };
  // Maps: at 32px the thin lines average away, leaving a pale, flat, low-saturation tile owned by a few colours.
  // Pale photos (snow, overcast sea) keep more texture and more distinct colours than that.
  if (s.saturation < 0.25 && s.edges < 0.05 && s.top4 > 0.6 && s.colourfulness < 30) return { kind: "map", reason: "flat pale top4 " + round(s.top4) + " edge " + round(s.edges) };
  // Scanned pages (safety booklets, waivers, brochures): a lot of paper white, little colour, and the busy
  // edge texture of text, in a small grey-dominated palette. Overcast-sky photos are as pale but hold more distinct colours.
  if (s.white > 0.28 && s.colourfulness < 40 && s.saturation < 0.2 && s.edges > 0.06 && s.colours < 130 && s.top4 > 0.5) return { kind: "document", reason: "paper white " + round(s.white) + " edge " + round(s.edges) };
  return { kind: "photo", reason: "" };
}

export function isUsable(kind: PhotoKind): boolean {
  return kind === "photo" || kind === "unknown";
}

async function fetchOnce(url: string): Promise<Uint8Array | null | "retry"> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(tinyUrl(url), { signal: ctl.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; OutsetBot/1.0)" } });
    if (res.status === 429 || res.status >= 500) return "retry";
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return "retry";
  } finally {
    clearTimeout(timer);
  }
}

/** The proxy drops a few requests under load; one retry after a short pause recovers most of them. */
async function fetchTiny(url: string): Promise<Uint8Array | null> {
  const first = await fetchOnce(url);
  if (first !== "retry") return first;
  await new Promise((r) => setTimeout(r, 1500));
  const second = await fetchOnce(url);
  return second === "retry" ? null : second;
}

/** Classify an image by its pixels. Network or decode failures come back as "unknown", which counts as usable. */
export function probeQuality(url: string): Promise<PhotoVerdict> {
  let p = cache.get(url);
  if (!p) {
    p = (async (): Promise<PhotoVerdict> => {
      const bytes = await fetchTiny(url);
      if (!bytes) return { kind: "unknown", stats: null, reason: "fetch failed" };
      const img = decodePng(bytes);
      if (!img) return { kind: "unknown", stats: null, reason: "decode failed" };
      const stats = computeStats(img.width, img.height, img.rgba);
      const { kind, reason } = classify(stats);
      return { kind, stats, reason };
    })();
    cache.set(url, p);
  }
  return p;
}
