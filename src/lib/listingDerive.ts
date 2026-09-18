import type { Unclaimed } from "../data/types";
import { plainWords } from "./catalog";
import { durationFrom } from "./duration";

/**
 * Derivations shared by the desktop listing page and the phone listing sheet. Every function reads what the
 * operator's own site states and returns null when it says nothing. Nothing here invents a fact.
 */

/** Service copy straight from the operator's page, minus the button labels that get scraped along with it. */
export function cleanDesc(raw: string): string {
  return plainWords(raw)
    .replace(/\b(SELECT|BOOK NOW|BOOK ONLINE|RESERVE NOW|LEARN MORE|READ MORE|CLICK HERE|ADD TO CART|BUY NOW)\b\.?/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();
}

export { freeCancel } from "./cancellation";

/** Minimum age from lines like "Must be 18+", "Minimum age 8", "ages 6 and up". */
export function minAge(lines: string[]): number | null {
  for (const l of lines) {
    const m = l.match(/\b(?:min(?:imum)? age(?: is|:)?|must be(?: at least)?|ages?|riders? must be)\s*(\d{1,2})\s*(?:\+|and (?:up|over|older)|years|yrs|or older)/i) || l.match(/\b(\d{1,2})\s*\+/);
    if (m) {
      const n = Number(m[1]);
      if (n >= 2 && n <= 21) return n;
    }
  }
  return null;
}

/**
 * The largest party the operator's own group lines state. It lives in `groupSize.ts` so the guest picker's
 * ceiling in `catalog.ts` can read the same rule without the two files importing each other; every surface
 * still imports it from here.
 */
export { groupCap } from "./groupSize";

/**
 * The first length the menu states, as the operator wrote it, for a listing whose crawled `dur` is empty.
 *
 * This reader had no idea what a booking can be, while the backend's, which writes `dur` in the first place,
 * has refused a policy window and an implausible length all along. So the page printed exactly the durations
 * the sync had already declined: 135 of the 178 shipped listings that fall back to this one, among them a
 * campground whose "Cancellations prior to 72 hours" read as a 72 hour trip and a yoga studio advertising
 * "200 hours" off a teacher training. Worse on a claimed shop, where this reader wins over the crawled fact
 * (`publishedPatch`): 130 listings would have replaced a good `dur` with one of these on the day they claimed.
 * One rule now, in `duration.ts`, and the sync calls the same one.
 */
export function durationLabel(item: Unclaimed): string | null {
  return durationFrom([...(item.services || []).flatMap((s) => s.variants.map((v) => v.label)), ...item.options.map((o) => o.detail)]);
}
