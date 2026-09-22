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
  const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (sentence >= Math.floor(max * 0.66)) return head.slice(0, sentence + 1);
  const word = head.lastIndexOf(" ");
  return (word > 0 ? head.slice(0, word) : head).replace(/[,;:\s]+$/, "") + "…";
}
