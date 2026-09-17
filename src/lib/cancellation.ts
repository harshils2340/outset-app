/**
 * "Free cancellation", the badge a guest reads on the card, in the booking box and under the title.
 *
 * It is a promise to the guest: change your mind in time and you get your money back. Plenty of operators
 * publish a different promise, that they refund a trip they themselves call off for weather or safety, and
 * the reader could not tell the two apart. So a shop whose own policy opens "You have booked a
 * NON-REFUNDABLE, non-cancellable purchase" advertised Free cancellation, and so did "All sales are final",
 * "Tickets purchased are non-refundable" and "Deposits fully refundable only if weather causes trip
 * cancellation": 72 of the 1,314 listings that carry the badge in the shipped catalog.
 */

/** The words an operator uses to promise money back. */
const REFUND =
  /\b(?:full refund|100% refund|fully refundable|refunds? in full|free cancellation|no penalty|no-penalty|free of charge|no charge|no fee|refunds?|refunded|refundable)\b|\bwithout (?:a )?(?:fee|penalty|charge)\b/i;
/** The stronger form, the only one that can put a badge on a card. */
const PROMISE = String.raw`full refund|free cancellation|100% refund|fully refundable|refunds? in full`;
/** A promise that hangs on a condition rather than standing on its own. */
const CONDITION = /\b(?:if|when|in case of|due to|because of|in the event of|should|reserves the right|unless)\b/i;
/** The condition being the shop calling the day off, which is not the guest cancelling. */
const THEIRS =
  /\b(?:weather|unsafe|safety|hazardous|mechanical|unforeseen|lightning|storm|wind|rain|conditions|captain|pilot|instructor|operator|company|outfitter|service provider)\b|\bwe\b[^.;]{0,20}\bcancel|\bcancell?ed by (?:us|the )|\b(?:cruise|trip|tour|charter|flight|sail|rental|class|session|event)s?\s+(?:is|are|was|were|being|gets?)\s+cancell?ed\b/i;
/** The guest being the one who cancels: a notice period, a no-penalty window, a cancellation in their name. */
const GUEST = String.raw`you|your|guests?|customers?|clients?|patrons?|participants?|renters?|passengers?`;
const WINDOW = new RegExp(
  [
    // "24 hours notice", "a week in advance", "two weeks prior"
    String.raw`\b(?:a|an|one|two|three|four|\d+)[- ]?(?:hours?|hrs?|days?|weeks?|months?)\b[^.;]{0,40}?\b(?:notice|in advance|prior|before|ahead|no penalty|no-penalty)\b`,
    // the same window written the other way round: "prior to 72 hours of the charter"
    String.raw`\b(?:notice|in advance|prior to|before|ahead of)\b[^.;]{0,24}?\b(?:a|an|one|two|three|four|\d+)[- ]?(?:hours?|hrs?|days?|weeks?|months?)\b`,
  ].join("|"),
  "gi",
);
/** The guest doing the cancelling, not merely being told about one: "if you cancel", "cancelled by the patron". */
const GUEST_ACTS = new RegExp(
  [
    String.raw`\b(?:${GUEST})\b\s+(?:may |can |must |choose to |chooses to |decide to |wish(?:es)? to |need(?:s)? to |request(?:s|ed)? to )?cancel`,
    String.raw`\bcancel\w*\b[^.;]{0,16}?\bby (?:the )?(?:${GUEST})\b`,
    String.raw`\bfor any reason\b`,
  ].join("|"),
  "i",
);

/**
 * The guest's side of the policy: they cancel, or a notice period is stated about cancelling. The window has
 * to be near the cancelling to count, or o-boatgenevalake-com's "final 50% due one week before rental" reads
 * as one.
 */
function yours(text: string): boolean {
  if (GUEST_ACTS.test(text)) return true;
  for (const m of text.matchAll(WINDOW)) {
    const at = m.index ?? 0;
    if (/cancel|refund|reschedul/i.test(text.slice(Math.max(0, at - 45), at + m[0].length + 45))) return true;
  }
  return false;
}

/** A line that takes money back rather than promising it. */
const DENIAL = /\bno refunds?\b|\bnon-?refundable\b|\bnot refundable\b|\bforfeit\w*\b|\bcharged in full\b|\bsales are final\b|\ball sales final\b|\bfinal sale\b/i;

/** One claim at a time, out of policy text that is often scraped without its full stops. */
const SPLIT = /(?<=[.;])\s+|\n+|(?=\b(?:Customers? (?:will|can)|Full refunds?|100% refunds?|Fully refundable|Free cancellation|No refunds?|Cancellations?|Cancel |Deposits?|Refunds?|If )\b)/;

/**
 * True when the operator promises money back only for a trip they call off themselves, and nowhere promises
 * a guest who cancels anything at all. Then there is no free cancellation to put on a card.
 *
 * Read over everything the shop publishes about cancelling, because the two promises often live in different
 * lines: o-seaspiritfishing-com's cancellation text covers only weather and its policy lines carry "a minimum
 * of 24 hours cancellation notice for a refund".
 */
export function onlyOperatorCancels(text: string | undefined): boolean {
  const t = String(text || "");
  if (!new RegExp(PROMISE, "i").test(t)) return false;
  const segments = t.split(SPLIT).map((s) => s.trim()).filter(Boolean);
  let theirs = false;
  for (const s of segments) {
    if (!REFUND.test(s)) continue;
    // "a full refund if we cancel for weather": the shop's own promise about its own call.
    if (CONDITION.test(s) && THEIRS.test(s) && !yours(s)) {
      theirs = true;
      continue;
    }
    // "no refunds within 14 days", "non-refundable deposit": a denial promises the guest nothing either way.
    if (DENIAL.test(s) && !new RegExp(PROMISE, "i").test(s)) continue;
    // Anything else that names money back reads as the guest's, which is what the badge claims.
    return false;
  }
  return theirs;
}

/**
 * "Free cancellation up to 48 hours before" when the operator's own policy says so. Null otherwise.
 *
 * `corpus` is everything the shop publishes about cancelling, for the reason above. Left out, the badge is
 * judged on `text` alone, which is all a claimed shop's own policy field is.
 */
export function freeCancel(text: string | undefined, corpus?: string): string | null {
  if (!text) return null;
  if (!new RegExp(PROMISE, "i").test(text)) return null;
  if (onlyOperatorCancels(corpus ?? text)) return null;
  const m = text.match(/(\d+)\s*(hours?|hrs?|days?)/i);
  if (!m) return "Free cancellation";
  const n = Number(m[1]);
  const unit = /day/i.test(m[2]) ? (n === 1 ? "day" : "days") : n === 1 ? "hour" : "hours";
  return `Free cancellation up to ${n} ${unit} before`;
}

/**
 * The badge itself, for every surface that draws one: the feed card, the listing page, the venue rows, the
 * booking sheet and the "Free cancellation" filter.
 *
 * `fc` was read off this same policy text by the sync, with an older reading of it, so where the text is here
 * it is read again rather than trusted. A listing whose text the sync never carried keeps the published badge.
 */
export function freeCancelBadge(item: { fc?: string; cancellation?: string; policies?: string[] }): string | null {
  const corpus = [item.cancellation || "", ...(item.policies || [])].join(" ").trim();
  if (corpus && onlyOperatorCancels(corpus)) return null;
  return item.fc || freeCancel(item.cancellation, corpus);
}
