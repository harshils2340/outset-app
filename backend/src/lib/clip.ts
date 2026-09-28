/**
 * A full stop that is a shortened word rather than the end of a sentence.
 *
 * An abbreviation is followed by a space and a capital exactly as a sentence end is, so the last full stop
 * inside the budget is often not one. Cutting there shipped 73 blurbs that read "The Art of Alfred A.",
 * "a snow capped Mt." and "hosted names like Joe Pesci, Michael B.", and 112 of the `/l/` pages' own
 * og:descriptions, which is the line a shared listing link previews as. Otto learned the same rule for its own
 * quoting in `src/lib/companyAgent.ts`; the two lists are deliberately not identical, because that one clips a
 * shop's hours line as well and can refuse a stop for free, while refusing one here costs a real sentence end.
 *
 * So the list here leaves out the words a sentence does end on: a unit ("an elevation of 7,200 ft.", "230
 * lbs."), "etc.", a day or a month, and a decade or a clock, which are letters after a digit or a dot ("in the
 * 1870s.", "open until 5:00 p.m."). Capitals settle the two that read both ways: "Ft." is Fort and "ft." is
 * feet.
 */
const INITIAL = /(?:^|[^\p{L}\p{N}'\u2019\u00b0])\p{Lu}\.$/u;
const SHORTENED =
  /\b(?:st|ste|mt|mts|sq|dr|mr|mrs|ms|jr|sr|capt|cpt|lt|sgt|col|gen|rev|prof|hon|hwy|rte|ave|av|blvd|rd|ln|apt|dept|div|pkwy|univ|no|nos|inc|corp|ltd|llc|co|approx|vs)\.$/iu;
const CASED = /\bFt\.$/u;

export function endsInAbbreviation(text: string): boolean {
  return INITIAL.test(text) || SHORTENED.test(text) || CASED.test(text);
}

/**
 * The last place inside `head` where a sentence really ends, or -1. Scanned from the back, so the longest text
 * that ends on a sentence wins, and a stop inside an unclosed bracket is passed over for the same reason an
 * abbreviation is: "open Mon-Fri 9:30 am(Saturday admission by appointment only." is not a finished sentence.
 */
export function lastSentenceEnd(head: string, floor: number): number {
  for (let i = head.length - 2; i >= floor; i--) {
    const mark = head[i];
    if ((mark !== "." && mark !== "!" && mark !== "?") || head[i + 1] !== " ") continue;
    const upto = head.slice(0, i + 1);
    if (mark === "." && endsInAbbreviation(upto)) continue;
    if ((upto.match(/\(/g) || []).length > (upto.match(/\)/g) || []).length) continue;
    return i;
  }
  return -1;
}

/** The word boundary fallback, with a shortened word taken off the end so no cut claims to be a name. */
export function endAtWord(head: string): string {
  let out = head.replace(/[,;:\s]+$/, "");
  while (out && endsInAbbreviation(out)) {
    const shorter = out.replace(/\s*\S+$/, "").replace(/[,;:\s]+$/, "");
    if (!shorter) break;
    out = shorter;
  }
  return out || head;
}

/**
 * Cutting a shop's own prose to a budget, where a sentence or a word ends rather than at whatever character
 * the count landed on.
 *
 * This started in `sync/listingPages.ts`, where `slice(0, 300)` cut 3,049 of the 11,545 pages mid-word: "The
 * guide shares favorite fishing spot", "Inferno Hot Pilates, Vi". That was already the meta description a
 * search result prints, and it is now the og:description a link preview shows a friend, which is where a
 * sentence stopping in the middle of a word reads as something broken rather than something trimmed.
 *
 * It lives here because every other budget a guest's prose is cut to was still spent with a bare `slice`, and
 * they land in the same places: 762 shipped listings carry an `extraNote` cut at 700 characters mid-word
 * ("...able to book another trip of equal or greater valu"), 65 a cancellation policy cut at 400, and a
 * handful an arrival note or an FAQ answer the same way. That cut line is the last bullet of "Who can go" or
 * "Safety and waiver" on the listing page, and the arrival note on the booking confirmation.
 *
 * A sentence end in the last third of the allowance wins, because it is a real ending and needs no mark. Past
 * that, the last word boundary, with an ellipsis to say the text goes on. Anything already short enough is
 * left exactly as the operator wrote it, which is the guard the hand-rolled
 * `slice(0, n).replace(/\s+\S*$/, "")` copies were missing: applied unconditionally that replace eats the last
 * word of every short string it is handed, which is what three of them were doing to vendor descriptions.
 */
export function clip(text: string, max: number): string {
  const s = text.trim();
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  const sentence = lastSentenceEnd(head, Math.floor(max * 0.66));
  if (sentence >= 0) return head.slice(0, sentence + 1);
  const word = head.lastIndexOf(" ");
  return endAtWord(word > 0 ? head.slice(0, word) : head) + "…";
}
