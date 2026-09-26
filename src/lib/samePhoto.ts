import type { Unclaimed } from "../data/types";

/**
 * Telling two spellings of one photograph apart from two photographs, and the fold every surface that shows a
 * listing's photos reads: the hero, the lightbox and the static /l/ page the sync writes.
 *
 * It lives apart from media.ts so the sync can read it. media.ts reaches images.ts for the photo proxy, and
 * that reaches api.ts and `import.meta.env`, which is Vite's and not the backend's.
 */

/** A path that names the image file itself, so whatever follows in the query is a resize or a cache-buster. */
const IMAGE_PATH = /\.(?:jpe?g|png|webp|gif|avif|bmp|tiff?)$/i;

/**
 * The file a photo URL actually reaches, for telling two spellings of one picture apart from two pictures.
 * A site links the same photograph under both schemes, with and without `www.`, and at whatever size its
 * resizing CDN was asked for, and the crawl keeps every spelling it saw.
 *
 * The query only comes off when the path already names the file. Plenty of hosts pass the image through the
 * query instead ("/_next/image?url=...", "/ImageRepository/Path?filePath=3O3Q6578.JPG"), and dropping it
 * there would fold every photo on those sites into one. Path case is kept for the same reason: it is worth
 * one duplicate across the whole catalog and a case-sensitive host could be serving two different files.
 */
export function samePicture(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    return IMAGE_PATH.test(path) ? host + path : host + path + u.search;
  } catch {
    return url;
  }
}

/**
 * Photo URLs to probe before laying the hero out. Folded the same way and in the same order the hero will
 * render them, so the handful of probes a page can afford are spent on the tiles it is really going to show,
 * and a probe never reports one spelling broken while the tile renders the other.
 */
export function photoCandidates(item: Pick<Unclaimed, "cover" | "photos">): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const src of [item.cover, ...(item.photos || [])]) {
    if (!src) continue;
    const key = samePicture(src);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(src);
  }
  return out;
}
