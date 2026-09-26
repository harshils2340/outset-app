import type { Unclaimed } from "../data/types";
import { plainWords } from "./catalog";
import { barePlusAge } from "./ages";
import { durationFrom } from "./duration";

/**
 * Derivations shared by the desktop listing page and the phone listing sheet. Every function reads what the
 * operator's own site states and returns null when it says nothing. Nothing here invents a fact.
 */

/**
 * The words a shop's own page uses for a call to action, which the crawl sweeps up with the copy beside them.
 * Every one of them is also an ordinary English word a shop writes inside a sentence, so a bare word match took
 * the shop's own prose apart on 1,035 listings: "we will learn more about chocolate varietals" became "we will
 * about chocolate varietals", "our experienced guides select the best breweries" became "our experienced guides
 * the best breweries", and "So what are you waiting for? BOOK NOW!" became "So what are you waiting for? !".
 * "Select" alone accounted for 538 of the 1,475 cuts and not one of them was a button.
 *
 * A leftover button is text no sentence runs through: it opens a segment (the start of the copy, the end of the
 * sentence before it, or a separator the crawl left between rows) and nothing follows it but the end of the copy
 * or the next separator. A label with a word after it is the shop talking, and is left alone.
 */
const CTA = "SELECT|BOOK NOW|BOOK ONLINE|RESERVE NOW|LEARN MORE|READ MORE|CLICK HERE|ADD TO CART|BUY NOW";
const SEP = "\\u2022\\u00b7|>\\u2014\\u2013-";
const BUTTON_LABEL = new RegExp(
  // After the start of the copy or the end of a sentence: the label and the separator that followed it both go.
  `(^|[.!?\\u2026])\\s*(?:${CTA})\\b[\\s.!\\u2026]*(?:$|[\\u2022\\u00b7|>]\\s*)` +
  // After a separator: that separator goes with the label, so the row before it does not end on a dangling mark,
  // and the separator that starts the next row is left where it is.
  `|\\s*[${SEP}]\\s*(?:${CTA})\\b[\\s.!\\u2026]*(?=$|[\\u2022\\u00b7|>])`,
  "gi",
);

/** Service copy straight from the operator's page, minus the button labels that get scraped along with it. */
export function cleanDesc(raw: string): string {
  return plainWords(raw)
    .replace(BUTTON_LABEL, (_m, lead: string | undefined) => (lead ? lead + " " : " "))
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
 * "Bring " is a label for a thing, so it belongs only in front of a line that names one. A shop's own
 * what-to-bring list is not all things: a third of it is the shop telling a guest what to do, what it will let
 * them carry in, or what they may not. In front of one of those the label reads twice, turns a rule into an
 * errand, or says the opposite of what the shop wrote. 1,469 lines on 1,179 shipped listings printed one of:
 *
 * - "Bring bring your own fishing poles", "Bring guests may bring their own alcohol", "Bring BYOB allowed".
 * - "Bring no outside food or alcohol", "Bring no special equipment needed", "Bring do not wear perfume": the
 *   flat opposite of the shop's rule, on 104 lines.
 * - "Bring dress in layers", "Bring wear closed-toe shoes", "Bring arrive 15 minutes early": an instruction
 *   the shop already gave, with a second verb stuck on the front.
 * - "Bring sunglasses recommended", "Bring closed-toe shoes required", "Bring personal chairs allowed inside":
 *   the line rates its own subject, so the label leaves it ungrammatical.
 *
 * A line that carries its own verb keeps the shop's own words and its own capital. The "Who can go" column
 * already prints full sentences beside these (a shop's requirements and its group rules), so nothing about it
 * needs the label to read.
 */
/** The shop says a guest may, or should, bring it: an imperative, a subject that carries the verb, or BYOB. */
const OFFERS_TO_BRING =
  /^(?:bring|byob?)\b|^(?:guests?|parents?|children|kids|visitors?|players?|participants?|customers?|clients?|members?|families|everyone|anyone|you|we)\b[^,;:(]{0,40}?\bbring\b|\bBYOB\b/i;
/** The shop says not to: the one class where the label states the opposite of the fact. */
const FORBIDS = /^(?:no|not|none|nothing|never|do not|don[’']?t|avoid)\b/i;
/** The shop is telling a guest what to do. Every verb here was read off the shipped lines that open with it. */
const TELLS =
  /^(?:arrive|wear|dress|pack|leave|keep|check|remove|apply|use|come|see|expect|consider|prepare|plan|sign|purchase|allow|store(?!-)|download|show|present|park|meet|ensure|remember|note)\b/i;
/**
 * The line rates its own subject: "Binoculars recommended", "Proper attire required". The participle has to
 * reach back to the subject rather than sit in a later clause, so nothing before it may be punctuation:
 * "Cooler with ice; alcohol permitted" is still a cooler to bring.
 */
const RATES_ITSELF =
  /^[^,;:(]{2,60}?\s(?:is |are |must be |may be )?(?:recommended|required|allowed|permitted|encouraged|prohibited|welcome|suggested|mandatory)\b/i;

/** Whether a what-to-bring line carries its own verb, and so reads on its own without the "Bring " label. */
export function statesOwnAction(text: string): boolean {
  return OFFERS_TO_BRING.test(text) || FORBIDS.test(text) || TELLS.test(text) || RATES_ITSELF.test(text);
}

/**
 * One "what to bring" line as the "Who can go" column reads it. The first letter is only lowered when the word is
 * ordinary prose: "ID for check-in" was printed as "Bring iD for check-in" on 170 lines across 140 listings, and
 * "BYOB allowed" as "Bring bYOB allowed". This is the rule Otto's own bring answer already used.
 */
export function bringLine(text: string): string {
  if (statesOwnAction(text)) return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  return "Bring " + (/^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text);
}

/**
 * Minimum age from lines like "Must be 18+", "Minimum age 8", "ages 6 and up".
 *
 * A shop that has written the words "minimum age" has already said the number is a floor, so it needs nothing
 * after it. One regex asked every cue for the same trailing "+", "years" or "or older", and 86 listings that
 * state the rule in plain English printed no age at all: "Minimum age 8", "Minimum age 10 for paintball, 7 for
 * SplatMaster", "Minimum age 16 to enter without adult supervision". The looser cues keep their suffix, because
 * a bare "ages 6" or "must be 4" is as often a band or a boat as it is a rule.
 *
 * That cue runs only after the others have read the whole list and found nothing, so it adds an age where
 * there was none and never changes one. Reading it in the same pass moved 16 listings to a different number,
 * because this returns the first line that yields an age rather than the lowest, and on a shop that sells more
 * than one thing the two are not the same: Peak Experiences would have gone from the 5 its birthday climbers
 * must be to the 13 its belayers must be.
 */
export function minAge(lines: string[]): number | null {
  for (const l of lines) {
    const worded = l.match(/\b(?:min(?:imum)? age(?: is|:)?|must be(?: at least)?|ages?|riders? must be)\s*(\d{1,2})\s*(?:\+|and (?:up|over|older)|years|yrs|or older)/i);
    const n = worded ? Number(worded[1]) : barePlusAge(l);
    if (n != null && n >= 2 && n <= 21) return n;
  }
  for (const l of lines) {
    const stated = l.match(/\bmin(?:imum)?\.?\s*age(?:\s+is|\s*:|\s+of)?\s*(\d{1,2})\b/i);
    const n = stated ? Number(stated[1]) : null;
    if (n != null && n >= 2 && n <= 21) return n;
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
/**
 * The subject of that sentence is as often plural as singular, and only the singular was read: "Listed rental
 * rates do not include gas, tax, and delivery" and "Prices do not include customary 18-20% gratuity for the
 * mate" were both ticked under the green "What's included", on 16 lines across 13 shipped listings.
 */
const NOT_INCLUDED = /\bnot included\b|\bexcluded\b|\bnot provided\b|\bdo(?:es)?(?: not|n[’']?t) include\b/i;
/** The section's own heading, swept up in front of the first bullet: "What's Included: Guests will enjoy...". */
const INCLUDED_HEADING = /^(?:what(?:'|’)?s? (?:is )?included|what is included|included|includes|inclusions?|package includes)\s*:\s*/i;
/**
 * The other half of that heading, which only ever matched as the bare words "Not included:". A shop writes the
 * heading out on its own page, so "What is not included: Gratuities are not included in the ticket price" and
 * "Excluded: Lunch" were printed under "Not included" with the heading still on the front of the fact.
 */
const EXCLUDED_HEADING = /^(?:what(?:'|’)?s? (?:is )?not included|what is not included|not included|excludes?|exclusions?|excluded|do(?:es)?(?: not|n[’']?t) include)\s*:\s*/i;
/** The shop sells this beside the trip: it is not in the price a guest pays here. */
const COSTS_EXTRA = /\b(?:at|for)\s+(?:an?\s+)?(?:extra|additional)\s+(?:cost|charge|fee|price)\b|\(\s*(?:extra|additional)\s+(?:cost|charge|fee)\s*\)|\bavailable for purchase\b|\bfor purchase\b|\bcosts? extra\b|\bat (?:your|guests?'?)\s+own (?:expense|cost)\b/i;
/** The same line also states something the price does cover, so it is not ours to move. */
const ALSO_INCLUDED = /\bincluded\b|\bincludes\b|\bprovided\b|\bsupplied\b|\bcomplimentary\b|\bfree of charge\b|\bat no (?:extra|additional)\b/i;
export function splitIncluded(lines: string[]): { yes: string[]; no: { text: string; strike: boolean }[] } {
  const yes: string[] = [];
  const no: { text: string; strike: boolean }[] = [];
  const seen = new Map<string, "yes" | "no">();
  for (const raw of lines) {
    const tidied = tidyLine(raw);
    const labelled = EXCLUDED_HEADING.test(tidied);
    const line = tidied.replace(labelled ? EXCLUDED_HEADING : INCLUDED_HEADING, "").replace(/^./, (c) => c.toUpperCase());
    if (!line) continue;
    const marked = labelled || NOT_INCLUDED.test(line);
    // A guest bringing their own is not a thing the price covers, so a line about it is no inclusion. It was
    // dropped off the page outright, though, which took 36 shipped lines that say in the same breath that the
    // shop does not supply it: "Lunch (bring your own) (not included)", "Bottled water (we recommend to bring
    // your own) (not included)", "Headphones for the Digital Tour Guide App narration (please bring your own)
    // (not included)". A guest was told nothing at all about lunch. A line that marks itself keeps its place
    // under "Not included", which is exactly what it says.
    if (!marked && /\bbring your own\b/i.test(line)) continue;
    const sold = !marked && COSTS_EXTRA.test(line) && !ALSO_INCLUDED.test(line);
    const side = marked || sold ? "no" : "yes";
    // Stripping the heading can leave a line reading exactly like another bullet, so the same words arrive
    // twice, once as a promise and once as an exclusion. An exclusion still wins, the way it does below for a
    // shop that writes "Admission fees" and "Admission fees (not included)" in the same list.
    const key = line.toLowerCase();
    const was = seen.get(key);
    if (was === side || was === "no") continue;
    seen.set(key, side);
    if (side === "yes") {
      yes.push(line);
      continue;
    }
    if (sold) {
      no.push({ text: line, strike: false });
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
