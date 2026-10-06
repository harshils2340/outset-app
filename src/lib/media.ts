import type { Unclaimed } from "../data/types";
import { thumb } from "./images";
import { photoCandidates, samePicture } from "./samePhoto";
import { isPublicHttpUrl } from "./urlSafety";

export { photoCandidates };

/** Only these embed a listing's video today. Anything else is hostile: an iframe with no host check is a
 *  redirect and a phishing overlay for the price of one crawled or operator-set field. */
const EMBED_HOSTS = new Set(["www.youtube.com", "youtube.com", "www.youtube-nocookie.com", "youtube-nocookie.com", "player.vimeo.com"]);

/** True only for a video embed URL the page is willing to put in an iframe. */
export function isSafeEmbedUrl(url: string): boolean {
  if (!isPublicHttpUrl(url)) return false;
  try {
    return EMBED_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Everything a listing can show in its hero: the operator's clip or embedded video first, then the photos with the
 * cover deduplicated. Anything the page has found broken (failed to load, or a tiny logo under 80 px) is left out,
 * so the count here is the count the layout and the lightbox both use.
 *
 * Deduplication is by the file a URL reaches, not by the URL. Matching on the exact string left 832 shipped
 * listings showing one picture between two and eight times, 657 of them inside the five tiles of the hero, so a
 * guest opened a museum and saw the same doorway three times and "Show all photos" promised nine. The first
 * spelling wins: the cover the photo screen picked stays the cover, and the browser reuses the copy the card
 * it was opened from has already loaded.
 */
export type Media =
  | { kind: "photo"; src: string }
  | { kind: "clip"; src: string; poster?: string }
  | { kind: "embed"; src: string };

export function listingMedia(item: Pick<Unclaimed, "cover" | "photos" | "video" | "videoEmbed">, broken: ReadonlySet<string>): Media[] {
  const out: Media[] = [];
  if (item.video && !broken.has(item.video)) out.push({ kind: "clip", src: item.video, poster: item.cover });
  else if (item.videoEmbed && !broken.has(item.videoEmbed) && isSafeEmbedUrl(item.videoEmbed)) out.push({ kind: "embed", src: item.videoEmbed });
  const seen = new Set<string>();
  for (const src of [item.cover, ...(item.photos || [])]) {
    if (!src || broken.has(src)) continue;
    const key = samePicture(src);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: "photo", src });
  }
  return out;
}

export function isGif(url: string): boolean {
  return /\.gif(\?|$)/i.test(url);
}

/** Background-style autoplay parameters for a YouTube or Vimeo embed. */
export function embedAutoplay(url: string): string {
  return url + (url.includes("?") ? "&" : "?") + "autoplay=1&mute=1&muted=1&loop=1&controls=0&playsinline=1&background=1";
}

/**
 * Probe photos at thumbnail size before the hero lays out. The proxy is tried first and the operator's original
 * second, the same order the tiles themselves use, so a photo only counts as broken when neither loads, the file
 * is a tiny logo, or the picture is flat (a blank tile, an icon on a plain ground). Returns a cleanup that
 * silences the probes.
 */
export function probePhotos(srcs: string[], drop: (src: string) => void, minSide = 80): () => void {
  const imgs = srcs.map((src) => {
    const img = new Image();
    img.referrerPolicy = "no-referrer";
    const proxied = thumb(src, "thumb") || src;
    let triedOriginal = proxied === src;
    // The proxy answers with CORS headers, so its pixels can be read; the original usually cannot and is only load-checked.
    if (!triedOriginal) img.crossOrigin = "anonymous";
    img.onload = () => {
      if (img.naturalWidth < minSide || img.naturalHeight < minSide || isFlat(img)) drop(src);
    };
    img.onerror = () => {
      if (triedOriginal) return drop(src);
      triedOriginal = true;
      img.crossOrigin = null;
      img.src = src;
    };
    img.src = proxied;
    return img;
  });
  return () => imgs.forEach((i) => { i.onload = null; i.onerror = null; });
}

/**
 * True when the picture is close to one colour: a blank, a gradient, or a small glyph on a plain ground.
 *
 * Measured against the white the tile is actually drawn on, which a fresh canvas is not: it is transparent,
 * and a transparent pixel reads back as black. So a picture with an alpha channel was scored against a
 * background a guest never sees, and the one shape that matters is the commonest logo there is, a light mark
 * drawn for a dark header. Driven in a real Chromium: a near-white glyph on a transparent ground scores 118.9
 * as this read it, far over the bar, and 4.8 against white, well under it. It was kept, and what a guest got
 * in the photo grid was a blank white tile, which is the first thing this function was written to drop. The
 * same run says nothing else moves: a dark glyph on alpha scores 14.9 then 95 and is kept either way, a flat
 * opaque tile scores 0 both ways, and every photo with no alpha at all, which is 255,428 of the 294,467
 * shipped photo URLs, is composited over nothing and reads identically.
 */
export function isFlat(img: HTMLImageElement): boolean {
  try {
    const n = 24;
    const canvas = document.createElement("canvas");
    canvas.width = n;
    canvas.height = n;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, n, n);
    ctx.drawImage(img, 0, 0, n, n);
    const px = ctx.getImageData(0, 0, n, n).data;
    let sum = 0;
    let sq = 0;
    for (let i = 0; i < px.length; i += 4) {
      const l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      sum += l;
      sq += l * l;
    }
    const count = px.length / 4;
    const mean = sum / count;
    const sd = Math.sqrt(Math.max(0, sq / count - mean * mean));
    return sd < 14;
  } catch {
    return false; // A tainted canvas (no CORS) tells us nothing; keep the photo.
  }
}
