/**
 * Operator photos are hotlinked from their own sites, which means multi-megabyte originals on every card.
 * wsrv.nl (images.weserv.nl) is a free, cached image proxy that resizes and re-encodes on the fly, so a card
 * pulls a 30 KB WebP instead of a 6 MB JPEG. If the proxy fails for a URL the caller falls back to the original.
 */

export type PhotoSize = "thumb" | "card" | "wide" | "hero" | "full";

const WIDTH: Record<PhotoSize, number> = { thumb: 320, card: 640, wide: 960, hero: 1600, full: 2000 };

/** Already small or already a resizing CDN: leave it alone. */
const SKIP = /^data:|wsrv\.nl|images\.weserv\.nl|\.svg(\?|$)|\.gif(\?|$)/i;

export function thumb(url: string | undefined, size: PhotoSize = "card"): string | undefined {
  if (!url) return url;
  if (SKIP.test(url) || !/^https?:\/\//i.test(url)) return url;
  const w = WIDTH[size];
  const square = size === "thumb" || size === "card";
  const bare = url.replace(/^https?:\/\//i, "");
  return (
    "https://wsrv.nl/?url=" + encodeURIComponent(bare) + "&w=" + w + (square ? "&h=" + w + "&fit=cover" : "") + "&output=webp&q=" + (size === "thumb" ? 70 : 78) + "&il&n=-1"
  );
}
