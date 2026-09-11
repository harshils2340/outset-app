/**
 * Read an image's pixel size from its first bytes, without downloading the whole file.
 * JPEG, PNG, WebP and GIF headers are enough to tell a 4000px hero from a 300px badge or a 1600x200 banner.
 */

import { withCpuBudget } from "../scrape/cpu.ts";

export type ImageSize = { width: number; height: number; bytes: number };

function jpeg(b: Uint8Array): ImageSize | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = b[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: (b[i + 7] << 8) | b[i + 8], height: (b[i + 5] << 8) | b[i + 6], bytes: b.length };
    }
    i += 2 + len;
  }
  return null;
}

function png(b: Uint8Array): ImageSize | null {
  if (b.length < 24) return null;
  const w = (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19];
  const h = (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23];
  return { width: w >>> 0, height: h >>> 0, bytes: b.length };
}

function gif(b: Uint8Array): ImageSize | null {
  if (b.length < 10) return null;
  return { width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8), bytes: b.length };
}

function webp(b: Uint8Array): ImageSize | null {
  if (b.length < 30) return null;
  const tag = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (tag === "VP8 ") return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff, bytes: b.length };
  if (tag === "VP8L") {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, bytes: b.length };
  }
  if (tag === "VP8X") return { width: (b[24] | (b[25] << 8) | (b[26] << 16)) + 1, height: (b[27] | (b[28] << 8) | (b[29] << 16)) + 1, bytes: b.length };
  return null;
}

export function parseImageSize(b: Uint8Array): ImageSize | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8) return jpeg(b);
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return png(b);
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return gif(b);
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return webp(b);
  return null;
}

const cache = new Map<string, ImageSize | null>();

/** First 64 KB of the file is enough for every format here. Null when the server refuses, times out, or it is not an image. */
export async function probeImage(url: string, timeoutMs = 8000): Promise<ImageSize | null> {
  if (cache.has(url)) return cache.get(url)!;
  return withCpuBudget(async () => {
    let out: ImageSize | null = null;
    try {
      const res = await fetch(url, {
        headers: { range: "bytes=0-65535", "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36", accept: "image/*,*/*;q=0.8" },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      });
      if (res.ok) {
        const reader = res.body?.getReader();
        const chunks: Uint8Array[] = [];
        let got = 0;
        if (reader) {
          while (got < 65536) {
            const { value, done } = await reader.read();
            if (done || !value) break;
            chunks.push(value);
            got += value.length;
          }
          reader.cancel().catch(() => undefined);
        }
        const buf = new Uint8Array(got);
        let o = 0;
        for (const c of chunks) {
          buf.set(c.subarray(0, Math.min(c.length, buf.length - o)), o);
          o += c.length;
          if (o >= buf.length) break;
        }
        out = parseImageSize(buf);
        if (out) out.bytes = Number(res.headers.get("content-range")?.split("/")[1] || res.headers.get("content-length") || got);
      }
    } catch {
      out = null;
    }
    cache.set(url, out);
    return out;
  });
}

/**
 * How much a photo of this shape deserves to be a cover. Wide photos of at least 900px win; tiny images, tall
 * portraits and skinny banners lose; anything under 500px wide is not cover material.
 */
export function shapeBonus(s: ImageSize | null): number {
  if (!s || !s.width || !s.height) return 0;
  const ar = s.width / s.height;
  if (s.width < 500 || s.height < 300) return -6;
  if (ar > 2.8 || ar < 0.45) return -5;
  let b = 0;
  if (s.width >= 900) b += 2;
  if (s.width >= 1400) b += 1;
  if (ar >= 1.15 && ar <= 2.1) b += 2;
  else if (ar < 0.8) b -= 2;
  return b;
}
