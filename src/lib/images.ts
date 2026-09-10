/**
 * Operator photos are hotlinked from their own sites, which means multi-megabyte originals on every card.
 * wsrv.nl (images.weserv.nl) is a free, cached image proxy that resizes and re-encodes on the fly, so a card
 * pulls a 30 KB WebP instead of a 6 MB JPEG. If the proxy fails for a URL the caller falls back to the original.
 *
 * Every size has two proxy widths: the 1x width matches the CSS box, the 2x width is for retina screens.
 * `srcSet` plus `sizes` lets the browser pick, so a 1x laptop stops pulling 4x the pixels it can show.
 * backend/scripts/warm-images.mts copies `proxyUrl` verbatim to pre-warm the proxy; keep the two in step.
 */

export type PhotoSize = "thumb" | "card" | "wide" | "hero" | "full";

/** Retina (2x) proxy width per slot; the 1x candidate is half of it. */
const WIDTH: Record<PhotoSize, number> = { thumb: 240, card: 360, wide: 800, hero: 1280, full: 1600 };

/** CSS width the slot renders at, so the browser can choose between the 1x and 2x candidates. */
export const SIZES: Record<PhotoSize, string> = {
  thumb: "160px",
  card: "(max-width: 700px) 50vw, 240px",
  wide: "(max-width: 900px) 100vw, 480px",
  hero: "(max-width: 900px) 100vw, 800px",
  full: "100vw",
};

/** Already small or already a resizing CDN: leave it alone. */
const SKIP = /^data:|wsrv\.nl|images\.weserv\.nl|\.svg(\?|$)|\.gif(\?|$)/i;

export function proxyUrl(url: string, size: PhotoSize, w: number): string {
  const square = size === "thumb" || size === "card";
  const bare = url.replace(/^https?:\/\//i, "");
  return (
    "https://wsrv.nl/?url=" + encodeURIComponent(bare) + "&w=" + w + (square ? "&h=" + w + "&fit=cover" : "") + "&output=webp&q=" + (square ? 68 : 78) + "&il&n=-1"
  );
}

function proxyable(url: string): boolean {
  return !SKIP.test(url) && /^https?:\/\//i.test(url);
}

/** The 2x proxy URL (the historical default), or the original when it cannot be proxied. */
export function thumb(url: string | undefined, size: PhotoSize = "card"): string | undefined {
  if (!url) return url;
  if (!proxyable(url)) return url;
  return proxyUrl(url, size, WIDTH[size]);
}

/** Two candidates, 1x and 2x, for `srcset`; undefined when the URL is not proxied so `src` alone applies. */
export function srcSet(url: string | undefined, size: PhotoSize = "card"): string | undefined {
  if (!url || !proxyable(url)) return undefined;
  const w = WIDTH[size];
  return proxyUrl(url, size, w / 2) + " " + w / 2 + "w, " + proxyUrl(url, size, w) + " " + w + "w";
}
