/**
 * Which fares a guest can actually buy, and which are somebody else's price.
 *
 * A headline price has to be a price the person reading it could pay. Quoting "$20.14 · Infant" to somebody
 * arranging a ten-person offsite, or "$115.54 · Child" to an adult, is a lie of omission: they cannot buy
 * that ticket, and the number they were shown is not the number they would pay. It is also the cheapest row
 * in the list, so a naive "from" price picks it every single time.
 *
 * The rule lived in `src/concierge/live.ts`, where it was written for FareHarbor's customer types, and
 * nowhere else. `src/enrich/availability.ts`, which is what the guest listing page's own time-and-price
 * picker reads, had no concession handling at all and would quote an infant fare as the price of a slot.
 * Two readers of the same kind of data disagreeing about what a price means is how a guest sees one number
 * on the listing page and another at checkout, so the rule lives here now and both should use it.
 *
 * Age words only. Deliberately not "group", "private", "resident" or "member": those are real tickets an
 * ordinary guest may well be able to buy, and excluding them would push the headline price up and be its own
 * kind of lie.
 */
const CONCESSION = /\b(child|children|kid|kids|infant|baby|babies|toddler|youth|junior|student|senior|pensioner|veteran)\b/i;

/**
 * Some shops price by age in numbers rather than words, and the word list cannot see them.
 *
 * Channel Islands sells "Adults 18+ $285 / Wise Ones 65+ $275 / Little Ones 5-17 $255", and a sea-cave trip
 * for two adults was headlined at the children's fare. Two numeric shapes, both narrow on purpose:
 *
 * - a hyphenated range ending at seventeen or below, which is a child or youth fare: "5-17", "8-16". The
 *   hyphen is required, because "Group from 1 to 2" is a party size.
 * - a plus-form at fifty-five or above, which is a senior fare: "65+" counts and "18+" is an adult one.
 *
 * A number on a menu line is almost never an age, though, and this rule used to believe every one of them.
 * Excluding a fare can only push the headline up, so each false positive over-quotes a guest by dropping the
 * shop's own cheapest bookable row: a fishing charter went out at $600 for three anglers because its $550
 * line said "1-2 anglers", and a riverboat's $25 public cruise became a $1,600 private charter because the
 * $25 row read "River Tour: 1-2:30 pm". Over all 212,052 shipped menu rows, 206 of them were misread, in
 * five shapes that are not ages at all:
 *
 * - a clock, a date, a price and a decimal: "CrossFit 5:30-6:30 AM", "Open 11-7 pm", "Session 2 Dates: July
 *   5-10, 2026", "Early Season (5/1 - 6/15)", "$7-9 each", "Drills Level 2.5-3.5". The character on either
 *   side says so, a month name in front says so, and so does an am or a pm behind.
 * - a span of something countable behind it: "1-2 Hour Rental", "Offshore Fishing 0-15 Miles Trip",
 *   "Private Instruction 1-2 sessions", "60+ minutes", "70+ balls", "Antipasto Salad (10-12 servings)".
 * - a numbered thing in front of it: "Alpine Racing Series Rounds 2-4", "AFF Training Levels 2-7",
 *   "Classical Ballet Exams Grades 1-2", "Back-in sites 1-16", "#23 - 16' Dolphin Slide".
 * - a party the price is for, where "for", "of" or "serves" does the work `CAPACITY` does elsewhere: "VIP
 *   Flight for 3-4" is a helicopter with four seats and not a child's ticket.
 *
 * An age cue ("ages 5-12", "3-15 ans", "7-11 y/o", "80+ years") overrides all of it, because a shop that
 * says the word means it.
 */
const AGE_RANGE = /\b(\d{1,2})\s*[-\u2013]\s*(\d{1,2})\b/g;
const AGE_PLUS = /\b(?:5[5-9]|[6-9]\d)\s*\+/g;
const AGE_CUE = /\b(age|ages|aged|yr|yrs|year|years|y\/o|yo|ans)\b/i;
const NOT_A_NUMBER_BEFORE = /[.:/$#]\s*$/;
const NOT_A_NUMBER_AFTER = /^\s*(?:[:/]|,?\s*(?:19|20)\d{2}\b)/;
const MONTH_BEFORE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*$/i;
const SPAN_AFTER =
  /^[-+]?\s*(?:[ap]\.?m\b|(?:hour|hr|minute|min|day|night|week|month|year|session|class|lesson|round|jump|time|foot|feet|ft|inch|mile|km|kilometre|kilometer|lb|pound|kg|quart|angler|seater|boat|board|car|room|site|lane|bay|horse|dog|beer|wine|tap|game|ticket|pass|acre|hole|level|grade|course|serving|load|ball|photo|stone|rental)s?\b)/i;
const PARTY_BEFORE = /\b(?:for|of|up to|max|maximum|min|minimum|party|family|holds|fits|sleeps|serves)\s*$/i;
const COUNTED_BEFORE =
  /\b(?:level|grade|round|jump|site|session|class|lesson|sleeps|week|day|no|number|lane|stage|step|part|unit|phase|size|exam|series|rate|option|package|tier)s?\s*$/i;

/**
 * A range of people is not a range of ages. "2-8 Players", "Group from 1 to 2" and "4-6 guests" all describe
 * how many may come, and reading them as a child fare would drop a room's real price out of the headline.
 */
const CAPACITY = /\b(player|people|ppl|person|guest|pax|participant|rider|seat|spot|passenger|group|team|angler)s?\b/i;

/** Whether one number shape on this label really names an age, rather than a clock, a span or a party. */
function readsAsAge(label: string, at: number, length: number): boolean {
  const before = label.slice(0, at);
  const after = label.slice(at + length);
  if (AGE_CUE.test(before.slice(-12)) || AGE_CUE.test(after.slice(0, 12))) return true;
  if (NOT_A_NUMBER_BEFORE.test(before) || NOT_A_NUMBER_AFTER.test(after)) return false;
  if (MONTH_BEFORE.test(before) || SPAN_AFTER.test(after)) return false;
  return !COUNTED_BEFORE.test(before) && !PARTY_BEFORE.test(before);
}

function isAgeInNumbers(label: string): boolean {
  for (const re of [AGE_RANGE, AGE_PLUS]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(label))) {
      if (re === AGE_RANGE && Number(m[2]) > 17) continue;
      if (readsAsAge(label, m.index, m[0].length)) return true;
    }
  }
  return false;
}

export function isConcessionFare(label: string | null | undefined): boolean {
  if (!label) return false;
  if (CONCESSION.test(label)) return true;
  if (!CAPACITY.test(label) && isAgeInNumbers(label)) return true;
  /**
   * And the plural, because the rule is word-anchored: "Seniors" slipped straight past "senior" and put
   * $51.95 on a cruise whose adult fare is $54.95. Trimming a trailing s is enough for every label seen.
   */
  return CONCESSION.test(label.replace(/\b([A-Za-z]{3,})s\b/g, "$1"));
}

/**
 * The cheapest fare an ordinary adult could buy, from labelled fares.
 *
 * Falls back to the cheapest of everything when every fare is a concession, or when none of them is named:
 * plenty of booking systems publish prices with no labels at all, and a price with an unknown name is more
 * use to a guest than no price. Returns null when there is nothing priced.
 */
export function openFarePrice<T>(fares: T[], priceOf: (f: T) => number | null | undefined, labelOf: (f: T) => string | null | undefined): number | null {
  const priced = fares.filter((f) => {
    const p = priceOf(f);
    return typeof p === "number" && Number.isFinite(p) && p > 0;
  });
  if (!priced.length) return null;
  const open = priced.filter((f) => !isConcessionFare(labelOf(f)));
  const pool = open.length ? open : priced;
  return Math.min(...pool.map((f) => priceOf(f) as number));
}
