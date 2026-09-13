import { classify, computeStats, decodePng, tinyUrl } from "./photoquality.ts";

/**
 * Catches printed pages that the 32x32 screen calls photographs: a scanned safety booklet, a rate card, a
 * flyer. Those pages usually carry a real photo in the middle, so at thumbnail size they look like one. Read
 * at 128x128 the giveaway is the paper around the photo: large unsaturated near-white areas, dense small
 * strokes where the text sits, and rows that alternate between ink and empty margin the way type does.
 *
 * Deliberately conservative. A listing losing a real photo is worse than a booklet page slipping through,
 * so every test has to agree before a page is rejected.
 */

const SIZE = 128;

export type PageScan = { isPage: boolean; paper: number; ink: number; textRows: number; reason: string };

function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

export function scanPage(width: number, height: number, rgba: Uint8Array): PageScan {
  const n = width * height;
  const L = new Float32Array(n);
  let paper = 0;
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    L[i] = luma(r, g, b);
    // Paper is bright and colourless. Bright sky and sand are bright but carry colour.
    if (L[i] > 225 && saturation(r, g, b) < 0.12) paper++;
  }
  const paperFrac = paper / n;

  // Ink strokes: dark pixels sitting next to paper. Text has many; a dark photo has few next to white.
  let ink = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 1; x < width; x++) {
      const i = y * width + x;
      if (L[i] < 140 && L[i - 1] > 210) ink++;
      else if (L[i] > 210 && L[i - 1] < 140) ink++;
    }
  }
  const inkFrac = ink / n;

  // Type sets in lines: rows of ink separated by clean margins. Count the switches down the page.
  let textRows = 0;
  let prevInky = false;
  for (let y = 0; y < height; y++) {
    let dark = 0;
    let light = 0;
    for (let x = 0; x < width; x++) {
      const v = L[y * width + x];
      if (v < 150) dark++;
      else if (v > 225) light++;
    }
    const inky = dark / width > 0.04 && dark / width < 0.55 && light / width > 0.3;
    if (inky && !prevInky) textRows++;
    prevInky = inky;
  }

  // Measured on scanned booklet pages against real trip photos: pages run 0.25 to 0.72 paper with 4 to 24
  // lines of type; photographs sit under 0.06 paper with at most 2. The cut sits in the empty middle.
  const isPage = paperFrac > 0.15 && textRows >= 3;
  return {
    isPage,
    paper: Number(paperFrac.toFixed(3)),
    ink: Number(inkFrac.toFixed(3)),
    textRows,
    reason: isPage ? `paper ${paperFrac.toFixed(2)}, ${textRows} lines of type` : "",
  };
}

/** Fetch one image at 128px and decide whether it is a printed page. Null when it could not be read. */
export async function probePage(url: string): Promise<PageScan | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20000);
    try {
      const res = await fetch(tinyUrl(url, SIZE), { signal: ctl.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; OutsetBot/1.0)" } });
      clearTimeout(timer);
      if (res.status === 429 || res.status === 403) {
        await new Promise((r) => setTimeout(r, 3000 + attempt * 4000));
        continue;
      }
      if (!res.ok) return null;
      const png = decodePng(new Uint8Array(await res.arrayBuffer()));
      if (!png) return null;
      return scanPage(png.width, png.height, png.rgba);
    } catch {
      clearTimeout(timer);
    }
  }
  return null;
}

/** The 32x32 verdict, then the page test on anything it called a photograph. */
export async function probeKind(url: string): Promise<{ kind: string; reason: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20000);
    try {
      const res = await fetch(tinyUrl(url), { signal: ctl.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; OutsetBot/1.0)" } });
      clearTimeout(timer);
      if (res.status === 429 || res.status === 403) {
        await new Promise((r) => setTimeout(r, 3000 + attempt * 4000));
        continue;
      }
      if (!res.ok) return { kind: "unknown", reason: "http " + res.status };
      const png = decodePng(new Uint8Array(await res.arrayBuffer()));
      if (!png) return { kind: "unknown", reason: "decode" };
      const first = classify(computeStats(png.width, png.height, png.rgba));
      if (first.kind !== "photo") return first;
      const page = await probePage(url);
      return page?.isPage ? { kind: "document", reason: page.reason } : first;
    } catch {
      clearTimeout(timer);
    }
  }
  return { kind: "unknown", reason: "failed" };
}
