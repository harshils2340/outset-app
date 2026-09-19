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

/**
 * A shop's published policy lines, sorted into the columns a guest reads them under. The waiver rule is the one
 * the "Safety and waiver" column already used, kept first so a line is never printed in two columns at once.
 *
 * Both surfaces used to put everything that was not a waiver under the heading "Cancellation policy", so 2,129
 * listings headed "No outside food or drink permitted" and "$20 fuel surcharge may apply" as cancellation terms,
 * and 74 more had their real terms ("Full refund if canceled 5 days or more before sail date") swallowed by the
 * same filter and were told to contact the business instead, on the page where Otto quotes the line.
 */
const WAIVER_LINE = /\bwaivers?\b|\bliabilit|\brelease form|\bsign(ed|ing)? (a |the |our |your )?(waiver|release|form)|\bcheck-?in\b/i;
const CANCEL_LINE = /\bcancel\w*|\brefund\w*|\breschedul\w*|\bno[- ]?shows?\b/i;

export function splitPolicies(lines: string[]): { cancel: string[]; other: string[] } {
  const cancel: string[] = [];
  const other: string[] = [];
  for (const line of lines) {
    if (WAIVER_LINE.test(line)) continue;
    (CANCEL_LINE.test(line) ? cancel : other).push(line);
  }
  return { cancel, other };
}

/**
 * One "what to bring" line as the "Who can go" column reads it. The first letter is only lowered when the word is
 * ordinary prose: "ID for check-in" was printed as "Bring iD for check-in" on 170 lines across 140 listings, and
 * "BYOB allowed" as "Bring bYOB allowed". This is the rule Otto's own bring answer already used.
 */
export function bringLine(text: string): string {
  return "Bring " + (/^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text);
}

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

/**
 * A Q&A page's own label, kept by the crawl: "A. We generally launch at daybreak" and "Q: How long is it?".
 * Four surfaces print a shipped FAQ (the desktop listing, the phone sheet, Otto and the dashboard prefill an
 * operator edits), and all four printed the label. Formatting only: nothing here changes a fact. The mark
 * after the letter is what makes it a label, so an answer that opens "A life jacket is provided" is left be.
 */
export function faqText(text: string): string {
  return String(text || "").replace(/^\s*[QA]\s*[.:)\]]\s+/i, "").trim();
}
