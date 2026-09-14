/**
 * Reading `srcset` the way a browser does.
 *
 * Splitting on every comma is wrong, and it cost real listings their photos. Wix, Cloudinary and imgix put
 * commas inside the URL itself (`/v1/fill/w_147,h_83,al_c,q_80,enc_auto/DSC_8876.jpg`), so a naive split cut
 * one candidate into fourteen fragments, and a fragment like `quality_auto/DSC_8876.jpg` resolved against the
 * page into a URL that does not exist. On 14 September 2026 that had published 1,798 dead image URLs across
 * 676 listings, 576 of them as the listing's cover.
 *
 * The HTML standard's rule is the fix: a candidate's URL runs to the next whitespace, so a comma inside it is
 * part of it. A comma only ends a candidate when it trails the URL or follows the descriptor.
 */

export type SrcsetCandidate = { url: string; width: number };

export function srcsetCandidates(srcset: string): SrcsetCandidate[] {
  const out: SrcsetCandidate[] = [];
  const s = srcset || "";
  let i = 0;
  while (i < s.length) {
    while (i < s.length && (s[i] === "," || /\s/.test(s[i]))) i += 1;
    if (i >= s.length) break;
    let j = i;
    while (j < s.length && !/\s/.test(s[j])) j += 1;
    let url = s.slice(i, j);
    i = j;
    let descriptor = "";
    if (url.endsWith(",")) {
      // "a.jpg, b.jpg 2x": the comma belongs to the separator, not the URL.
      url = url.replace(/,+$/, "");
    } else {
      while (i < s.length && /\s/.test(s[i])) i += 1;
      let k = i;
      let depth = 0;
      while (k < s.length && (s[k] !== "," || depth > 0)) {
        if (s[k] === "(") depth += 1;
        else if (s[k] === ")") depth = Math.max(0, depth - 1);
        k += 1;
      }
      descriptor = s.slice(i, k).trim();
      i = k + 1;
    }
    if (!url) continue;
    const m = descriptor.match(/^(\d+(?:\.\d+)?)([wx])$/i);
    const width = m ? Number(m[1]) * (m[2].toLowerCase() === "x" ? 1000 : 1) : 0;
    out.push({ url, width });
  }
  return out;
}

/** The largest candidate, or the first when none says how large it is. */
export function largestFromSrcset(srcset: string): string | null {
  let best: SrcsetCandidate | null = null;
  for (const c of srcsetCandidates(srcset)) if (!best || c.width > best.width) best = c;
  return best?.url || null;
}

/**
 * A URL that is really a piece of a comma-split image-CDN transform, left over from the old parser. The tell is
 * a path that opens with a transform token rather than a folder: `quality_auto/`, `enc_auto,`, `usm_0.66_...`,
 * `h_83,`, `al_c,`, `q_80,`. No real site keeps its images in a folder with those names.
 */
const FRAGMENT = /^\/(?:quality_auto|enc_auto|usm_[\d._]+|[whxyq]_\d+|al_[a-z]+|lg_\d|blur_\d+|fill|fit|crop)(?:[,/]|$)/i;

export function looksLikeSrcsetFragment(url: string): boolean {
  try {
    return FRAGMENT.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/**
 * Rebuild a Wix image from a fragment when the fragment still carries its media id. Wix serves the original at
 * `static.wixstatic.com/media/<id>` whatever transform the page asked for, so the photo is recoverable without
 * crawling the site again. A fragment with no id (`save.png`) cannot be rebuilt and returns null.
 */
export function repairWixFragment(url: string): string | null {
  const m = url.match(/([0-9a-f]{6}_[0-9a-f]{32}~mv2(?:_d_\d+_\d+_s_\d+_\d+_\d+)?\.(?:jpe?g|png|webp|gif))/i);
  return m ? "https://static.wixstatic.com/media/" + m[1] : null;
}

/**
 * One stored image URL, made safe to publish. A leftover fragment with no media id is dropped. A Wix URL cut
 * off mid-transform (`.../media/<id>~mv2.jpg/v1/fill/w_147`) is rebuilt as the original. Every other URL,
 * including an intact Wix transform, is returned untouched, so a working image keeps the URL its quality
 * verdict was recorded under.
 */
export function cleanImageUrl(url: string): string | null {
  if (!url) return null;
  if (looksLikeSrcsetFragment(url)) return repairWixFragment(url);
  if (/wixstatic\.com\/media\//i.test(url) && /\/v1\//.test(url)) {
    const last = url.split("?")[0].split("/").pop() || "";
    if (!/\.(?:jpe?g|png|webp|gif|avif)$/i.test(last)) return repairWixFragment(url);
  }
  return url;
}
