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
/**
 * Both surfaces print a waiver line in "Safety and waiver" only while it is short enough to read as a bullet.
 * A longer one was passed over here as well, on the assumption that column had it, so it was shown nowhere: no
 * shipped listing wrote one that long, and the first that would is a partner's ("Participant Waiver & Release
 * of Liability and Terms & Conditions. By purchasing ticket(s) and/or by participating on a tour...", 29 lines
 * across the Viator feed). It falls through to the columns below instead of off the page.
 */
const SAFETY_MAX = 160;

export function splitPolicies(lines: string[]): { cancel: string[]; other: string[] } {
  const cancel: string[] = [];
  const other: string[] = [];
  for (const line of lines) {
    if (WAIVER_LINE.test(line) && line.length <= SAFETY_MAX) continue;
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

/**
 * A bare "21+" with no age word beside it, which is how a shop most often writes the rule ("Adults only 18+",
 * "This experience is 21+"). Those same two characters also count people, miles, nights, course units, a
 * phone's software version and a tennis rating, and the fallback below read every one of them as somebody's
 * age: 55 shipped listings printed "Ages N+" off a line that names no age at all. "Supported devices: iPhone
 * with iOS 15+" put "Ages 15+" on 22 self-guided tours, "Additional Cost For Groups Of 7+ Passengers" put
 * "Ages 7+" on 19 charters, "Groups of 4+ may be split into multiple helicopters" put "Ages 4+" on 5 flights,
 * and "Not recommended for travelers who cannot walk 3+ miles" put "Ages 3+" on a walking tour.
 *
 * So the number has to be counting years. It is not when the words right after it say what it counts, and it
 * is not when the words in front of it do. A decimal's tail is not a number of its own either: "USTA rating
 * 3.5+" was read as an age of 5. "N+ years" stays an age unless the years are of experience rather than of
 * life, which is the one phrase that uses the same word for something else.
 */
const PLUS_COUNTS = /^\s*(?:tax|people|persons?|passengers?|players?|guests?|pax|travell?ers?|paddlers?|anglers?|miles?|mi|km|kms|kilomet(?:er|re)s?|feet|ft|foot|inch(?:es)?|lbs?|pounds?|kg|%|units?|credits?|nights?|days?|weeks?|months?|hours?|hrs?|min(?:ute)?s?|years?\s+(?:of\s+)?(?:experience|training|boating|riding|teaching))\b/i;
const PLUS_COUNTED = /(?:groups?|part(?:y|ies)|teams?|planning)\s+(?:of|for)\s*$|\b(?:ios|android|version|level|rating|grade|size)\s*$/i;

/** Minimum age from lines like "Must be 18+", "Minimum age 8", "ages 6 and up". */
export function minAge(lines: string[]): number | null {
  for (const l of lines) {
    const worded = l.match(/\b(?:min(?:imum)? age(?: is|:)?|must be(?: at least)?|ages?|riders? must be)\s*(\d{1,2})\s*(?:\+|and (?:up|over|older)|years|yrs|or older)/i);
    const n = worded ? Number(worded[1]) : barePlusAge(l);
    if (n != null && n >= 2 && n <= 21) return n;
  }
  return null;
}

/** The first "N+" in a line that is counting years rather than anything else. */
function barePlusAge(line: string): number | null {
  for (const m of line.matchAll(/(?<![\d.])(\d{1,2})\s*\+/g)) {
    const after = line.slice(m.index + m[0].length);
    const before = line.slice(0, m.index);
    if (PLUS_COUNTS.test(after) || PLUS_COUNTED.test(before)) continue;
    return Number(m[1]);
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

/**
 * A page heading the crawl swept up with the sentence under it: "Cancellations Cancellation requests received
 * at least 48 hours before...". The heading names what follows, so the second word repeats the first, either
 * word for word ("Gas Gas is not included") or as its plural ("Cancellations Cancellation").
 *
 * The plural allowance needs a real word behind it. Stripping a trailing s from "As" leaves "a", which matched
 * every sentence that opens "As a", so six shipped lines lost their first word and read as something else:
 * "A reminder, it is customary to tip your crew" and "A boat rental business, cancellations can be very
 * costly" were both the shop stating a fact, not a heading.
 */
export function unglueHeading(text: string): string {
  const lead = text.match(/^([A-Za-z]+)\s+([A-Za-z]+)\b/);
  if (!lead) return text;
  const [, first, second] = lead;
  const same =
    first.length >= 3 &&
    (first.toLowerCase() === second.toLowerCase() ||
      (first.length >= 4 && first.toLowerCase().replace(/s$/, "") === second.toLowerCase().replace(/s$/, "")));
  return same ? text.slice(first.length).trim() : text;
}

/** Space before punctuation, "( x )", doubled spaces, a leading bullet, list number or Q&A label: the crawl's leftovers. */
export function tidyLine(text: string): string {
  let t = plainWords(faqText(text))
    .replace(/^\s*(?:[•·*\-–—:;,|>]+|\d{1,2}\s*[-.)]\s+)\s*/, "")
    .replace(/\s+([,.;:!?)])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s{2,}/g, " ")
    .trim();
  // A line still set in capitals reads as shouting: sentence case it, keeping short acronyms.
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 12 && letters.replace(/[^A-Z]/g, "").length / letters.length > 0.7) {
    t = t.toLowerCase().replace(/(^|[.!?]\s+)([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase()).replace(/\b(am|pm|atv|utv|vip|faq|id|usa|fl)\b/g, (w) => w.toUpperCase());
  }
  // "Cancellations Cancellation requests received..." carries the page heading glued to the sentence.
  t = unglueHeading(t);
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/**
 * What's included, split the way a guest reads it. A short "Fuel (not included)" is struck through as Airbnb does
 * with a missing amenity; a whole sentence ("Gratuity is not included in the ticket price") keeps its own words,
 * because cutting "not included" out of the middle turns it into the opposite claim.
 *
 * Three ways a line ended up under the green tick saying the opposite of what the shop wrote:
 *
 * - The "Not included:" label was stripped and then looked for. "Not Included: Gratuity for your guide" became
 *   "Gratuity for your guide", which carries no marker, so it was filed as included on 2 shipped listings.
 * - A thing the shop sells beside the trip is not a thing the trip comes with. "Golf clubs rental (extra fee)",
 *   "Snacks and drinks available for purchase" and "Fish cleaning service available for additional fee" were all
 *   ticked as included, on 86 lines across 81 shipped listings. They keep the shop's own words on the other side
 *   of the split: striking through "Full bar with light snacks" would say the bar is missing, which is not the claim.
 * - A line that says it is included as well as for sale ("Your first drink is included, with additional drinks
 *   available for purchase") is the shop stating both, so it stays where it is.
 */
const NOT_INCLUDED = /\bnot included\b|\bexcluded\b|\bnot provided\b|\bdoes(?: not|n[’']t) include\b/i;
/** The section's own heading, swept up in front of the first bullet: "What's Included: Guests will enjoy...". */
const INCLUDED_HEADING = /^(?:not included|what(?:'|’)?s? (?:is )?included|what is included|included|includes|inclusions?|package includes)\s*:\s*/i;
/** The shop sells this beside the trip: it is not in the price a guest pays here. */
const COSTS_EXTRA = /\b(?:at|for)\s+(?:an?\s+)?(?:extra|additional)\s+(?:cost|charge|fee|price)\b|\(\s*(?:extra|additional)\s+(?:cost|charge|fee)\s*\)|\bavailable for purchase\b|\bfor purchase\b|\bcosts? extra\b|\bat (?:your|guests?'?)\s+own (?:expense|cost)\b/i;
/** The same line also states something the price does cover, so it is not ours to move. */
const ALSO_INCLUDED = /\bincluded\b|\bincludes\b|\bprovided\b|\bsupplied\b|\bcomplimentary\b|\bfree of charge\b|\bat no (?:extra|additional)\b/i;
export function splitIncluded(lines: string[]): { yes: string[]; no: { text: string; strike: boolean }[] } {
  const yes: string[] = [];
  const no: { text: string; strike: boolean }[] = [];
  const seen = new Set<string>();
  for (const raw of lines) {
    const tidied = tidyLine(raw);
    const labelled = INCLUDED_HEADING.test(tidied) && /^not included/i.test(tidied);
    const line = tidied.replace(INCLUDED_HEADING, "").replace(/^./, (c) => c.toUpperCase());
    const key = line.toLowerCase();
    if (!line || seen.has(key)) continue;
    seen.add(key);
    if (/\bbring your own\b/i.test(line)) continue;
    if (!labelled && !NOT_INCLUDED.test(line)) {
      if (COSTS_EXTRA.test(line) && !ALSO_INCLUDED.test(line)) no.push({ text: line, strike: false });
      else yes.push(line);
      continue;
    }
    const short = line.replace(/\s*[-–:(,]*\s*(?:is |are )?(?:not included|excluded|not provided)\)?\.?\s*$/i, "").trim();
    const clean = short !== line && !!short && short.split(/\s+/).length <= 4 && !/[:;]/.test(short) && !/\b(?:in|also|are|is|the|of|and|a|to|that|for|with)$/i.test(short);
    if (clean && !NOT_INCLUDED.test(short)) no.push({ text: short.charAt(0).toUpperCase() + short.slice(1), strike: true });
    else no.push({ text: line, strike: false });
  }
  // "Gratuity" struck through beside "Gratuity is not included in the ticket price" says the same thing twice.
  const out = no.filter((n) => !n.strike || !no.some((m) => !m.strike && m.text.toLowerCase().startsWith(n.text.toLowerCase() + " ")));
  // 14 shipped listings publish the same thing in both halves of their own list: "Admission fees" and
  // "Admission fees (not included)", "All Fees and Taxes" and "All Fees and Taxes (not included)". A page cannot
  // promise a guest what the same list excludes, so the exclusion wins.
  const denied = new Set(out.map((n) => n.text.toLowerCase()));
  return { yes: yes.filter((y) => !denied.has(y.toLowerCase())), no: out };
}

/**
 * A greeting and a sign-off are courtesy, not arrival information, and a shop's arrival note is full of both.
 * The words that are left are what a guest needs on the day: the dock, the parking, how early to be there.
 *
 * The rule used to be a prefix test over the whole note, so a note that opened "Thank you for booking with
 * us" was dropped entire. 110 of the 644 shipped notes open that way, and with them went "Meeting location:
 * Pier 39, Gate I", "arrive at the dock 45 minutes prior to sailing time", and "We meet under the white tent
 * behind the GoldBelt Tram building". A guest was shown nothing at all where the shop had said the most.
 *
 * So the courtesy goes sentence by sentence and only when that sentence says nothing else: a date, a time, a
 * place, a waiver or anything else in `ARRIVAL_FACT` keeps it, and so does a sentence too long to be only a
 * greeting. What is left of a note that was all courtesy is nothing, which is what a guest should be shown.
 */
const PLEASANTRY = new RegExp(
  "^(?:" +
    [
      "see you",
      "thanks?(?: you)?",
      "welcome",
      "have fun",
      "enjoy",
      "we(?:'re|’re| are)? ?(?:so |very |really )?(?:looking forward|look forward|excited|stoked|can(?:'|’)?t wait|cannot wait|appreciate)",
      "you(?:'re|’re| are) all set",
      "like us on",
      "follow us",
      "check out our",
      "connect with",
    ].join("|") +
    ")\\b",
  "i",
);

/** Anything a guest would act on. A sentence carrying one of these is kept however politely it opens. */
const ARRIVAL_FACT =
  /\d|\barriv|\bcheck[ -]?in\b|\bmeet\b|\bmeeting\b|\bpark(?:ing)?\b|\bdock\b|\bmarina\b|\bpier\b|\bramp\b|\bgate\b|\baddress\b|\blocat|\bbring\b|\bwear\b|\bwaiver|\bearly\b|\bprior\b|\blate\b|\bdepart|\bcall\b|\btext\b|\bsign\b/i;

/** The shop's own arrival note with the courtesy taken out, or "" when courtesy was all of it. */
export function arrivalWords(checkin: string): string {
  const kept = String(checkin || "")
    .split(/(?<=[.!?])\s+/)
    .filter((s) => !(s.length <= 160 && PLEASANTRY.test(s.trim()) && !ARRIVAL_FACT.test(s)))
    .join(" ")
    .trim();
  // What is left of o-fishnorthmyrtlebeach-com's note is "Capt.", the front of a name the crawl cut. One word
  // is not an arrival note, and a guest is better shown nothing than shown that.
  return kept.split(/\s+/).filter((w) => /[a-z]{2}/i.test(w)).length >= 2 ? kept : "";
}
