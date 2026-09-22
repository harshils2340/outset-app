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
 * A length of time, in digits or in the words a shop writes small counts with, with the filler a rate card
 * puts between the two: "48 hours", "7+ days", "3 or more days".
 */
const SPAN = /\b(\d+|an?|one|two|three|four)\s*(?:\+|or more|or longer|and over)?\s*[- ]?\s*(hours?|hrs?|days?|weeks?|months?)\b/gi;
const WORD_COUNT: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4 };
/** The shop's no-refund side of the same window, which is never what the badge promises. */
const TOO_LATE = /\b(?:within|inside|less than|fewer than|under|no later than|shorter than)\b[^.;]{0,16}$/i;
/**
 * Except where the same breath makes it a notice period after all. Plenty of shops write theirs as "Cancel
 * within 48 hours for full refund", "called to cancel within 72 hours before your cruise" and "within 30
 * days' notice or more", which is the guest's side of the window however oddly it reads.
 */
const STILL_FREE = new RegExp(String.raw`^[^.;]{0,40}?(?:${PROMISE}|or more|or longer|notice|in advance|prior|before|ahead)`, "i");
/** What the losing side of the window costs, which settles it the other way. */
const LOSS = /\bcharges?d?\b|\bfees?\b|\bpenalt\w*\b|\bcredit\b|\brain ?check\b/i;
/**
 * A window the guest has to buy. o-hudsonmarina-net gives a full refund "with purchase of cancelation
 * protection plan with atleast 12 hours notice" and asks everyone else for 72, and o-lowcountrywatersports-com
 * sells its 12 hour window as Trip Protection. Not having bought it is not the same clause: o-hhiboatcharters-com
 * gives "Guests that have not purchased trip insurance ... up to 72 hours to cancel", which is the free one.
 */
const PAID_COVER = /\bwith (?:the )?purchase of\b|\bpurchasing\b|\bwith [^.;]{0,24}(?:protection|insurance)\b/i;
/** The shop telling the guest, which is no window anyone can cancel in: "you will be notified 2 hours prior". */
const TOLD = /\byou\b[^.;]{0,12}?\b(?:notified|informed|advised|told)\b[^.;]{0,20}$/i;

/** Every length of time in the text, with the shop's own no-refund side of the window left out. */
function spansOf(text: string): { at: number; len: number; n: number; unit: string }[] {
  return [...text.matchAll(SPAN)].flatMap((m) => {
    const at = m.index ?? 0;
    const after = text.slice(at + m[0].length, at + m[0].length + 48);
    const before = text.slice(Math.max(0, at - 24), at);
    if (TOLD.test(before)) return [];
    if (TOO_LATE.test(before) && !(STILL_FREE.test(after) && !DENIAL.test(after) && !LOSS.test(after))) return [];
    const n = WORD_COUNT[m[1].toLowerCase()] ?? Number(m[1]);
    if (!Number.isFinite(n) || n <= 0) return [];
    const u = m[2].toLowerCase();
    const unit = /^hr|^hour/.test(u) ? "hour" : /^day/.test(u) ? "day" : /^week/.test(u) ? "week" : "month";
    return [{ at, len: m[0].length, n, unit }];
  });
}

/** Whether this clause is the shop's own call rather than the guest's, so its clock is not the guest's. */
function shopsOwn(s: string): boolean {
  return THEIRS.test(s) && !GUEST_ACTS.test(s);
}

/**
 * The window the badge prints, out of the clause that actually makes the promise.
 *
 * It used to be the first number anywhere in the policy, whichever clause it sat in and whichever side of it
 * the number was on, so o-baysidejetskirentals-com's "Cancellations within 48 hours of the reservation are
 * non-refundable. Customers will receive a full refund or credit with 24 hours notice of cancellation."
 * advertised the shop's no-refund window as its free one, o-archangelcharters-com promised a guest who
 * cancels at 30 hours a refund the shop only gives at 48, and o-blazenh-com's badge read "up to 3 hours
 * before" off a $15 late-cancellation penalty. 141 of the 1,303 shipped badges printed a number from a
 * clause that was not the promise.
 *
 * The promise owns the number, and within its clause the one before it wins: "Cancellations 24 hrs or more
 * before departure time - Full refund Cancellations 6 hrs to 23 hrs ... - 50% refund" puts the guest's own
 * number to the left and the half-refund window nearer on the right.
 *
 * Where no promise names one, the first window a guest could actually cancel in does, as long as it is not
 * the shop's own call: o-bassonline-com says "Cancel at least 48 hours before trip to avoid forfeiting
 * payment" and promises the refund in another line, while o-hhiboatcharters-com's captain "will make the
 * call on weather ... up to an hour prior", which is no window at all.
 */
export function cancelWindow(text: string): { n: number; unit: string } | null {
  const strong = new RegExp(PROMISE, "i");
  // Whole sentences here: `SPLIT` breaks before "Refund", so o-japowersportsfl-com's "You may cancel a
  // booking 3 days or more out for a FULL Refund." would lose its number to the split.
  for (const sentence of text.split(/(?<=[.;!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean)) {
    const m = sentence.match(strong);
    // A refund the shop pays for its own call is not the guest's, judged the way `onlyOperatorCancels` judges
    // the same words, so "48 hours notice of cancellation due to weather at customer's request" stays theirs.
    if (!m || PAID_COVER.test(sentence) || (THEIRS.test(sentence) && !yours(sentence))) continue;
    const spans = spansOf(sentence);
    const promiseAt = m.index ?? 0;
    const pick = spans.filter((s) => s.at < promiseAt).pop() || spans.find((s) => s.at >= promiseAt);
    if (pick) return { n: pick.n, unit: pick.unit };
  }
  // Failing that, the first window a guest could actually cancel in, one claim at a time so that a span in
  // the shop's own weather line is judged by that line and not by whatever sits 45 characters away.
  for (const clause of text.split(SPLIT).map((s) => s.trim()).filter(Boolean)) {
    if (shopsOwn(clause) || PAID_COVER.test(clause) || !/cancel|refund|reschedul/i.test(clause)) continue;
    const [first] = spansOf(clause);
    if (first) return { n: first.n, unit: first.unit };
  }
  return null;
}

/** "48 hours", "2 weeks", "1 day": the window as a guest reads it. */
export function windowLabel(w: { n: number; unit: string }): string {
  return `${w.n} ${w.unit}${w.n === 1 ? "" : "s"}`;
}


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
  const w = cancelWindow(text);
  return w ? `Free cancellation up to ${windowLabel(w)} before` : "Free cancellation";
}

/**
 * The badge itself, for every surface that draws one: the feed card, the listing page, the venue rows, the
 * booking sheet and the "Free cancellation" filter.
 *
 * `fc` was read off this same policy text by the sync, with an older reading of it, so where the text is here
 * it is read again rather than trusted, and the fresh reading wins. It used only to be reached when the file
 * carried no badge at all, which is 22 of the 1,303 shipped ones, so every later fix to the rule stopped at
 * the catalog and waited on a sync to reach a guest. A listing whose own text does not carry the promise, and
 * whose badge the sync therefore read off lines that are not on the file, keeps the published badge.
 */
export function freeCancelBadge(item: { fc?: string; cancellation?: string; policies?: string[] }): string | null {
  const corpus = [item.cancellation || "", ...(item.policies || [])].join(" ").trim();
  if (corpus && onlyOperatorCancels(corpus)) return null;
  return freeCancel(item.cancellation, corpus) || item.fc || null;
}
