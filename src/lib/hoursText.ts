/**
 * The hour lines a guest reads, from whatever the shop's site published.
 *
 * Two surfaces print this block, the desktop listing's "Where you'll be" and the phone sheet's contact rows,
 * and a third, "Plan your visit" on a walk-in listing, printed the synced contact record with no tidying at
 * all. Across the 14,812 listings that show an Hours block, 126 published OpenStreetMap's own syntax
 * ("Mo-Tu 10:00-18:00; We off; Su off; PH off") and a guest read it as written, 226 printed the quote marks
 * around "by appointment", 361 opened on punctuation the crawl brought with it (") (6am-4pm", "& Location
 * 8am-8pm", a calendar emoji), 29 carried a zero-width space, one of them inside "Monday t​o Friday", and
 * 21 ran a day onto the end of the time before it ("Sun - Thur: 11am - 11pmFri - Sat: 11am - 1am").
 *
 * Case is left alone. A shop that shouts its hours is still stating its hours, the same way a shouted review
 * is still a review.
 *
 * A fourth surface, the static `/l/<id>.html` page a search engine indexes, printed the published lines with no
 * tidying at all until it was pointed here. Nothing in this module imports anything, which is what lets
 * `backend/src/sync/listingPages.ts` read the same rule the app reads.
 */

/**
 * A line can carry days and a time range and still not be when the door is open. Four subjects turn up in the
 * shipped catalog and every one of them reads backwards.
 *
 * A campground's quiet hours: "Quiet hours are from 11:00pm - 8:00am" is the only hours line 37 of them
 * publish, so every one of those said "Closed, opens 11 PM" at lunchtime and "Open now, closes 8 AM" at two
 * in the morning, and Otto answered "their hours say: quiet hours are from 11:00pm - 8:00am" when a guest
 * asked whether they were open. The hours a campground states are the hours nobody may make a noise. Four
 * more word it without the word "hours": an RV park by Daytona says "Quiet time is observed from 10:00 PM -
 * 7:00 AM", two hot springs "Quiet time is from 10:00 PM to 8:00 AM", and a lake park "Quiet to be maintained
 * from 11:00PM to 8:00AM". Every one of those four is the shop's whole Hours block, so all four told a guest
 * they were shut all day and open all night. "Times" is left out of the "time" spelling on purpose: Quiet
 * Times Golf Course is a real business and its name is not a noise rule.
 *
 * A bar's happy hour: "Happy Hour Wednesday-Friday 12-6 PM" came after the same site's real "Wed 12:00 PM -
 * 10:00 PM", and the later line wins, so the brewery shut four hours early three days a week. One shop's only
 * hours line was "Happy Hour is Sunday 2:00-5:00PM, Mon-Fri 3:00-6:00PM", which read as opening at 2 AM.
 *
 * An entry from a shop's event calendar: "Open Studio November 21 @ 11:00 am - 2:00 pm", "Pinned Butterflies
 * September 10 @ 5:30 PM - 7:00 PM", "OPEN PRIVATE TESTING September 18 @ 4:00 pm - 10:00 pm". One date and
 * one time, which is one afternoon, and The Events Calendar writes the "@" between them. 29 listings publish
 * one and for every one of the 29 it is the whole Hours block, so the line was printed to a guest as the shop's
 * opening hours and, naming no weekday, became all seven days of its week: a railroad museum open 9 to 5 every
 * day and a dragway open 4 to 10 every day, on the strength of a single event. Nothing is lost by refusing it,
 * because no shop in the catalog publishes one beside hours of its own.
 *
 * The last thing a shop sells, which is not when its door shuts. "Last rental 2:30 - 3:30 pm" is the only
 * hours line a county park publishes beyond one open house, so a guest read a whole parks department as open
 * for one hour a day, seven days a week. A skydive centre publishes two lines, "First appointment at 8 am" and
 * "Last appointment 3 to 5 pm depending on season", and only the second carries a range, so the centre opened
 * at 3 PM. Refused only when a range hangs off the subject: the 14 other lines in the catalog that open this
 * way state one time rather than a range ("Last ticket sold at 3 p.m.", "Last entry into the park for Day Pass
 * Holders is 4:30 pm"), they never built a week, and they stay printed beside the real hours they belong to.
 * The nouns are listed one at a time rather than taken as whatever follows "last", because 16 businesses in
 * the catalog are named Last something, from Last Cast Charters to Last Wave Brewing Company, and a shop's own
 * name in front of its hours is still its hours.
 */
const NOT_TRADING_HOURS = /\b(?:quiet|happy)\s*hours?\b|\bquiet\s+time\b|\bquiet\s+(?:is\s+)?(?:to\s+be\s+)?(?:maintained|observed|enforced)\b/i;

/** The last thing sold, as the subject the line opens on. */
const LAST_SOLD = /^[^\p{L}\p{N}]*last\s+(?:admission|appointment|boat|booking|call|cart|class|departure|entrance|entry|jump|launch|rental|ride|seating|session|slot|tee|ticket|tour|trip|wash)s?\b/iu;
/** A time range, however a shop writes one. The words are whole words, so "entry into the park" is not one. */
const A_RANGE = /\d(?::\d{2})?\s*(?:[ap]\.?m\.?)?\s*(?:[-\u2013\u2014]|\b(?:to|until|till)\b)\s*\d/i;

/** The Events Calendar's own line: a single date, then "@", then the time of one event. */
const DATED_EVENT = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?\s*@/i;

/**
 * The same thing without the "@", which is how most shops write it. 245 listings publish an hour line naming
 * a calendar date, and for 181 of them it is the whole Hours block, so whatever that line says became all
 * seven days of the shop's week. Two shapes hide in those 245 and they mean opposite things.
 *
 * A season is a run of days, and its line is the shop's real week: "May 1 - November 1: 11am - 6pm", "April 1
 * - September 30 Mon-Sun: 11am - 8pm", "WINTER HOURS NOV 17-MAR 1: 8am-5pm", "10am till sunset starting June
 * 18th 2026". Those stay, and so does a run of dates written any other way: a second month ("May through
 * August 9"), a second day hung off the first ("Sept. 7-11", "Sept 11th & 12th"), or a word that opens or
 * closes the run rather than closing the date ("until", "through", "starting", "Memorial Day to Oct. 1").
 *
 * One closed date is one afternoon: "Open House September 30, 2026 4:00pm - 6:00pm", "Sunday, August 16, 2026
 * - 1:00 pm - 3:00 pm", "Open Mic Night Sep 11 7 pm - 9 pm", "Thursday, May 8: 11AM - 8PM", "July 4th Hours:
 * 11 AM - 7:00 PM", "December 25th: closed". A gallery's open studio, a brewery's open mic, a golf club's
 * Christmas Day and a museum's one Saturday, every one of them printed to a guest as the hours of the shop and
 * spread over a week it never stated. 103 lines on 92 listings, 86 of which publish nothing else and now keep
 * an honest gap, which is what the "@" rule already settled for the same shape written The Events Calendar's
 * way.
 *
 * OpenStreetMap's own syntax names a date too, as an exception clause on a week it has already stated ("Fr-Sa
 * 12:00-18:00; Dec 25 off"). That is a machine-written week with a shop's Christmas Day on the end of it, not
 * one afternoon, so a line carrying the syntax's two-letter day codes is left to the reader that understands
 * them.
 *
 * A day number may not be a clock ("October 11:00AM - 4:00PM" is a month and an opening time, not the 11th)
 * and may not be a year ("August 16, 2026" is one date, not two).
 */
const MONTH_NAME = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DAY_NUM = "\\d{1,2}(?:st|nd|rd|th)?(?!\\d)(?!:\\d)";
const DATED_DAY = new RegExp("\\b" + MONTH_NAME + "\\b\\.?\\s*" + DAY_NUM, "gi");
const MONTH_ANYWHERE = new RegExp("\\b" + MONTH_NAME + "\\b", "gi");
/** A second day of the month hung off the first by a range or a list, which makes the two of them a run. */
const RUN_OF_DAYS = new RegExp("^\\s*(?:-|\u2013|\u2014|to|thru|through|&|and|,)\\s*" + DAY_NUM + "(?!\\s*[ap]\\.?m)", "i");
/** A range word left hanging in front of the date, so the date closes a run that opened before it. */
const RUN_ENDS_HERE = /\b(?:to|thru|through|until|till|after|and)\s*$|&\s*$/i;
/** The two-letter day codes that mark a line out as OpenStreetMap's syntax rather than a shop's sentence. */
const OSM_DAY_CODE = /\b(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/;
/** A word that makes the date one end of a run of days rather than the whole of it. */
const RUN_WORD = /\b(?:start(?:s|ing)?|begin(?:s|ning)?|until|till|thru|through|after|onward|resumes?|effective|season|reopens?)\b/i;

/** Whether a line names one calendar date and nothing wider, which is one day rather than a week. */
function namesOneDay(line: string): boolean {
  if (OSM_DAY_CODE.test(line)) return false;
  const dates = [...line.matchAll(DATED_DAY)];
  if (dates.length !== 1) return false;
  if ((line.match(MONTH_ANYWHERE) || []).length !== 1) return false;
  if (RUN_WORD.test(line)) return false;
  const at = dates[0].index;
  if (RUN_ENDS_HERE.test(line.slice(0, at))) return false;
  return !RUN_OF_DAYS.test(line.slice(at + dates[0][0].length));
}

/** Whether a published line is about when the shop is open, rather than one day, a noise rule or a last sale. */
export function isTradingHoursLine(line: string): boolean {
  if (NOT_TRADING_HOURS.test(line) || DATED_EVENT.test(line)) return false;
  if (LAST_SOLD.test(line) && A_RANGE.test(line)) return false;
  return !namesOneDay(line);
}

const DAY_CODE: Record<string, string> = { Mo: "Mon", Tu: "Tue", We: "Wed", Th: "Thu", Fr: "Fri", Sa: "Sat", Su: "Sun", PH: "Public holidays" };
const DAY_SPEC = "(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)(?:\\s*-\\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))?";
const OSM_CLAUSE = new RegExp("^(" + DAY_SPEC + "(?:\\s*,\\s*" + DAY_SPEC + ")*)(?![A-Za-z])\\s*(.*)$");
/**
 * The span a rule opens with, and whatever the shop said after it.
 *
 * Reading only a rest that is exactly a clock span left 22 listings printing the syntax at a guest: the golf
 * courses and driving ranges open "Mo-Su 07:00-sunset", where one end of the span is a time no clock shows, and
 * the galleries and libraries open "Su 13:30-16:00 or by appointment", where the shop said more after the span.
 * Neither was read, so neither had its day codes or its 24 hour clock turned into words. The span has to sit at
 * the front of the rest for this to be a rule at all: "We are open 09:00-17:00 daily" is a sentence that happens
 * to start with a day code, and it stays the shop's own line.
 */
const OSM_CLOCK = "(?:\\d{1,2}:\\d{2}|sunrise|sunset|dawn|dusk)";
const OSM_SPAN = new RegExp("^(" + OSM_CLOCK + ")\\s*-\\s*(" + OSM_CLOCK + ")(?![\\d:])", "i");
/** One rule can carry more than one span, separated by a comma: "Mo-Fr 10:00-17:00,17:00-19:00". */
const OSM_SPAN_MORE = new RegExp("^\\s*,\\s*(" + OSM_CLOCK + ")\\s*-\\s*(" + OSM_CLOCK + ")(?![\\d:])", "i");
/**
 * The months or the date a rule applies to, which the syntax writes in front of the days: "May-Oct Mo-Sa
 * 09:00-16:00", "Jan off", "Dec 25 off". Peeled off first and put back in front of the words, so a museum's
 * summer week and a mead hall's Christmas Day read as the shop's own season rather than as the syntax's own
 * keyword ("Jan off", "Nov-Mar closed", "May-Oct Mo-Sa 09:00-16:00" all went to a guest as written).
 */
const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)";
const OSM_WHEN = new RegExp("^(" + MONTH + "(?:\\s+\\d{1,2})?(?:\\s*-\\s*" + MONTH + "(?:\\s+\\d{1,2})?)?)\\s*:?\\s+(?=\\S)", "i");
/**
 * The crawl glues the next thing on a page straight on to the last word of the thing before it, and an hours
 * line is where that costs a guest a day. A range whose closing day carries the clock is read anyway, because
 * the reader stopped asking for a word boundary there, but nothing else on the line is: 250 listings publish
 * an hour line with a day name glued to a heading in front of it or to the clock behind it, and for 63 of them
 * the line named no day a reader could see, which a week reads as every day of it. A park's "Public Visiting
 * Hours Friday10AM - 4:30PM" opened seven days, a dance studio's "Monday6:00PM-9:00PM Tuesday6:00PM-9:00PM"
 * the same, and a bowling alley's "of Operation Thursday12:00PM - 6:00PM" the same again. Twelve more write
 * their day off that way, which hid both the day and the word: "MondayClosedTuesday2:00PM to 7:00PM",
 * "THURSDAYCLOSEDFRIDAY to SUNDAY11:00 AM - 7:00 PM", "MondayClosedTuesdayClosedWednesday11:00 am - 4:00 pm".
 *
 * Every break here is a shape no shop writes on purpose, so each is the crawl's own seam:
 * a full day name is never the end or the start of another word, a day name never carries a digit, a short day
 * spelling in capitals never sits inside a lowercase word, and "Closed" in capitals never ends one. A word
 * ending in "mon" or "sat" keeps its letters, because the short spellings are only broken out of a word when
 * the crawl's own capital is there to prove the seam.
 *
 * Then the line is cut into the rules it turned out to be holding: a day name behind a clause that has already
 * said what happens on its days starts the next day's rule, which is what makes "Monday Closed" and "Tuesday
 * 2:00PM to 7:00PM" two rules rather than one line that says a shop is both.
 */
const FULL_DAY = "(?:sun|mon|tue|wed|thu|fri|sat)(?:day|sday|nesday|rsday|urday)s?";
const ANY_DAY = "(?:sun|mon|tue|wed|thu|fri|sat)(?:day|sday|nesday|rsday|urday|rs?)?s?";/**
 * A day written as a code rather than a word, the way a shop's own sign writes it: "M-F", "Mo-Fr", "M - Th",
 * "M, Tu, We, Sa", "Sa-Sun". Only the codes that can mean one day. "T" is Tuesday or Thursday and "S" is
 * Saturday or Sunday, so "M-T" and "S-S" name no day here rather than a guessed one. And a code counts only
 * inside a group of two or more days, which is what keeps the "W" of a street address and the "F" of a
 * temperature out of a week: 72 listings write their days this way and every one of them was misread. A
 * weekday-only shop ("M-F 9am-5pm") named no day at all, which a week reads as every day of it, and a shop
 * that wrote its Saturday out in full beside them ("M - F 10am - 6pm Saturday 10am - 3pm") stood closed all
 * week with its weekday clock on the Saturday.
 */
const CODE_DAY = "(?:mo|tu|we|th|fr|sa|su|m|w|f)";
/** A day token in any spelling, word or code. */
const GROUP_DAY = "(?:" + ANY_DAY + "|" + CODE_DAY + ")";
const DAY_JOIN = "\\s*(?:-|\u2013|\u2014|to|thru|through|&|and|,|/)\\s*";
/** Two or more days in any spelling, joined as a range or a list: one subject, however the shop separates it. */
const DAY_SUBJECT = GROUP_DAY + "(?:" + DAY_JOIN + GROUP_DAY + ")+";
const CODE_GROUP = new RegExp("\\b" + DAY_SUBJECT + "\\b", "gi");
const DAY_PART = /(-|\u2013|\u2014|to|thru|through|&|and|,|\/)/i;
const RANGE_JOIN = /^(?:-|\u2013|\u2014|to|thru|through)$/i;
const CODE_IDX: Record<string, number> = { su: 0, mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6, m: 1, w: 3, f: 5 };
const DAY_TOKEN = new RegExp("^(?:(sun|mon|tue|wed|thu|fri|sat)(?:day|sday|nesday|rsday|urday|rs?)?s?|(mo|tu|we|th|fr|sa|su|m|w|f))\\.?$", "i");

/** The day a token names, in any spelling. Undefined when the word is not a day, or is a code that means two. */
function dayOfToken(token: string): number | undefined {
  const m = DAY_TOKEN.exec(token.trim());
  return m ? CODE_IDX[(m[1] || m[2]).toLowerCase().slice(0, 2)] : undefined;
}

/**
 * The days a group holding at least one code names, a range where its days are joined by a dash or a "to" and
 * a list otherwise. Null when the line writes no such group. A group where any one token does not resolve
 * names nothing at all, so "M-T" hands back no Monday: half a range is not a shop's week.
 */
export function codeDays(line: string): number[] | null {
  const days = new Set<number>();
  for (const m of line.matchAll(CODE_GROUP)) {
    const parts = m[0].split(DAY_PART).map((p) => p.trim()).filter(Boolean);
    const tokens = parts.filter((_, i) => i % 2 === 0);
    // A group of words alone is the word reader's, not this one's.
    if (!tokens.some((t) => t.replace(/\.$/, "").length <= 2)) continue;
    const idx = tokens.map(dayOfToken);
    if (idx.some((d) => d === undefined)) continue;
    let prev = -1;
    for (let i = 0; i < idx.length; i += 1) {
      const d = idx[i] as number;
      if (prev >= 0 && RANGE_JOIN.test(parts[i * 2 - 1] || "")) {
        for (let x = prev; ; x = (x + 1) % 7) {
          days.add(x);
          if (x === d) break;
        }
      } else days.add(d);
      prev = d;
    }
  }
  return days.size ? [...days].sort((a, b) => a - b) : null;
}

/** The spellings a shop shortens a day to, as the crawl's own capital leaves them. */
const SHORT_DAY = "(?:Sun|Mon|Tues|Tue|Wednes|Wed|Thurs|Thur|Thu|Fri|Satur|Sat)";
const SHORT_CAPS = "(?:SUN|MON|TUES|TUE|WEDNES|WED|THURS|THUR|THU|FRI|SATUR|SAT)";
const SEAM = "\u0000";
/**
 * Every seam is looked for where it sits rather than by eating the letter in front of it, because a shop can
 * write four days with no space anywhere in them: "Mon - TueWed - ThuFriSatSun" is six seams in one word, and
 * a rule that consumed the letter before each day found every other one.
 */
const GLUED_FULL_BEFORE = new RegExp("(?<=[A-Za-z\\d])(?=" + FULL_DAY + ")", "gi");
const GLUED_FULL_AFTER = new RegExp("(?<=" + FULL_DAY + ")(?=[A-Za-z])", "gi");
const GLUED_SHORT = new RegExp("(?<=[a-z\\d])(?=" + SHORT_DAY + "(?![a-z]))", "g");
/** A day shouted in capitals has to end the word it is stuck to, or "SATISFYING" would name a Saturday. */
const GLUED_SHORT_CAPS = new RegExp("(?<=[a-z\\d])(?=" + SHORT_CAPS + "(?![A-Za-z]))", "g");
/** A day name the crawl ran onto the end of the time before it, with no space in between. */
const GLUED_TIME = new RegExp("(?<=\\d\\s?[ap]\\.?m\\.?|\\d)(?=" + SHORT_DAY + "|" + SHORT_CAPS + ")", "gi");
const GLUED_CLOCK = new RegExp("\\b(" + ANY_DAY + ")(?=\\d)", "gi");
const GLUED_CLOSED = /(?<=[A-Za-z])(?=Closed|CLOSED)/g;
/** A day name whose plural a seam would otherwise leave behind: "Tuesdays" and "MONDAYS10" are one word each. */
const LOST_PLURAL = new RegExp(SEAM + "(s)(?![a-z])", "gi");
/** Whether a clause has already said what happens on its days, which is what makes the next day a new rule. */
const RULE_SAID = /\d\s*(?::\d{2})?\s*(?:[ap]\.?m\.?)?\s*(?:-|\u2013|\u2014|to|until|till)\s*\d|\bclosed\b/i;
const OPENS_ON_DAY = new RegExp("^\\s*(?:" + ANY_DAY + ")\\b", "i");

/** The rules a published line is holding, once the crawl's seams are opened. One line in, one or more out. */
export function gluedRules(line: string): string[] {
  const seams = line
    .replace(GLUED_FULL_BEFORE, SEAM)
    .replace(GLUED_FULL_AFTER, SEAM)
    // The plural goes back on the day it belongs to before the clock is looked for behind it.
    .replace(LOST_PLURAL, "$1")
    .replace(GLUED_SHORT, SEAM)
    .replace(GLUED_SHORT_CAPS, SEAM)
    .replace(GLUED_TIME, SEAM)
    .replace(GLUED_CLOCK, "$1" + SEAM)
    .replace(GLUED_CLOSED, SEAM)
    .split(SEAM);
  const out: string[] = [];
  for (const part of seams) {
    const last = out.length ? out[out.length - 1] : null;
    if (last === null) out.push(part);
    else if (OPENS_ON_DAY.test(part) && RULE_SAID.test(last)) out.push(part);
    else out[out.length - 1] = last + " " + part;
  }
  return out.map((p) => p.trim()).filter(Boolean);
}

/**
 * A shop can write two days' hours on one line with nothing between them but a space, and the reader gave
 * every day the first span it found: "Mon-Sat 10am - 5pm Sunday 12pm - 5pm" opened the museum at ten on a
 * Sunday it opens at noon, "Tuesday - Friday 10 am - 4 pm Saturday 10 am - 3 pm" kept a museum open an hour
 * past its Saturday closing time, and "Mon - Fri 4:00pm - 10:00pm Sat & Sun 12:00pm - 7:00pm" left a climbing
 * gym's weekend unstated altogether. 558 lines on 485 listings state two or more rules that way, and the week
 * a guest reads changes on 154 of them: every one of those was a day standing open at an hour the shop never
 * claimed, or a day it states hours for reading as no day at all.
 *
 * The crawl's own seams are cut above because no shop writes them on purpose. A space is a shop's own
 * punctuation, so a cut there has to be sure, and only one shape is: a day name behind a clause that has
 * already said which days it is about and what happens on them, where the day name carries a span of its own.
 * Nothing else is cut, which is what leaves the shapes that cannot be told apart alone.
 *
 * Three of them, each a line this rule deliberately does not touch. A span that comes before the days it
 * belongs to keeps them, because "open from 11am - 7pm Monday-Friday and 9am-8pm" names no day in front of its
 * first clock, and cutting at Monday would hand the weekend an 11 to 7 the shop never stated. A day off owns
 * the day behind it, so "Open daily 10AM-7:30PM, closed Wednesdays" and "Mon - Fri: Closed Saturday: 10am -
 * 5pm" are left for the closed-day reader in openNow.ts, which already reads both correctly. And a day name
 * that states neither a clock nor a day off of its own is not a rule: "Friday 6:00 pm - 10:00 pm Saturday"
 * states one span for two days, which is what the shop wrote.
 */
/** What a shop leaves between the parts of a rule: punctuation, or a zero-width space the crawl swept up. */
const GAP = "[\\s:;.,&=/\\-\u2013\u2014]*";
/** The days a rule opens on, as a range or a list: one subject, however the shop separates it. */
/** The days a rule may open on: two or more in any spelling, or one written as a word. A lone code is not
 * one of them, because a single letter by itself is as likely to be a street direction as a day. */
const RULE_DAYS = "(?:" + DAY_SUBJECT + "|" + ANY_DAY + ")";
/** A span, both ends written out. Stricter than A_RANGE above, which only has to find a range to refuse a line. */
const A_SPAN = "\\d{1,2}(?::\\d{2})?\\s*(?:[ap]\\.?m\\.?)?\\s*(?:-|\u2013|\u2014|to|until|till)\\s*\\d{1,2}(?::\\d{2})?\\s*(?:[ap]\\.?m\\.?)?";
const A_SPAN_RE = new RegExp(A_SPAN, "i");
/** Whether a clause has already named a day, which the days behind a cut have to sit behind. A lone code
 * counts here: "M 4:30PM - 9PM tu - su 11:30AM - 9PM" is a Monday and then the rest of the week, and the
 * rule behind the cut names its own days whatever this one turns out to hold. */
const A_DAY_RE = new RegExp("\\b" + GROUP_DAY + "\\b", "i");
const EVERY_DAY_RE = new RegExp("\\b" + GROUP_DAY + "\\b", "gi");
/** The next rule, whole: its own days, then whatever the shop puts in front of the clock, then its own span. */
const NEXT_RULE = new RegExp("^" + RULE_DAYS + GAP + "(?:from\\s+|open\\s+|at\\s+)?" + A_SPAN, "i");
/**
 * A day off with no day in front of it owns the day written behind it, so the clause in front of a cut may not
 * end on one: "Open daily 10AM-7:30PM, closed Wednesdays" is six open days and a Wednesday off, whatever the
 * cut would make of it. A day off that already names its own day is finished, and the rule behind it is the
 * next one: `o-peecnature-org` writes "Mon 10:00 am - 4:00 pm Tues CLOSED Wed 10:00 am - 6:00 pm" and had its
 * Wednesday closing at four, two hours before it does, and Rev's Georgetown taproom opened at eleven on a
 * Tuesday it opens at four. Which day the word is about is read the same way `closedDays` in openNow.ts reads
 * it: the days in front of it where the line names any, the days behind it where it does not.
 */
const SAID_CLOSED = /\bclosed[\s:;.,&=/\-\u2013\u2014]*$/i;
const CLOSED_HAS_DAY = new RegExp("\\b" + RULE_DAYS + GAP + "(?:(?:and\\s+|&\\s*)?holidays?" + GAP + ")?(?:(?:is|are)" + GAP + ")?closed" + GAP + "$", "i");
/** The next rule can be a day off of its own, which is what makes that line above three rules rather than two. */
const NEXT_CLOSED = new RegExp("^" + RULE_DAYS + GAP + "(?:(?:is|are)" + GAP + ")?closed\\b", "i");

/** One rule per day group, where a shop wrote several with only a space between them. */
function spacedRules(rule: string): string[] {
  for (const m of rule.matchAll(EVERY_DAY_RE)) {
    const at = m.index;
    if (!at) continue;
    const said = rule.slice(0, at);
    const rest = rule.slice(at);
    const span = said.search(A_SPAN_RE);
    const day = said.search(A_DAY_RE);
    // The days have to own the span in front of the cut, and the day behind it a rule of its own, or the line
    // is one rule written in an order this cannot read.
    if (span < 0 || day < 0 || day > span) continue;
    if (SAID_CLOSED.test(said) && !CLOSED_HAS_DAY.test(said)) continue;
    if (!NEXT_RULE.test(rest) && !NEXT_CLOSED.test(rest)) continue;
    return [said.trim(), ...spacedRules(rest)].filter(Boolean);
  }
  return [rule];
}

/**
 * A shop that writes the clock in front of the days it belongs to, over and over: "Ferndale: 12pm - 9pm
 * Mon-Tue, 12pm - 10pm Wed-Thu, 12pm - 8pm Fri-Sun". Every rule on such a line is the same shape back to
 * front, and the reader above cannot cut it, because a cut there needs the days to come first. So the whole
 * week was one rule and every day of it took the first span: District Brew Co's three taprooms opened their
 * Saturday four hours early and shut it two hours late, Third Window Brewing closed at nine on the five
 * nights it closes at ten or eleven, and Terravita's Saturday ran to five instead of half past four.
 *
 * A cut here is only safe where the whole line is that one shape and nothing else: from the first clock to
 * the end, a span, then the days it belongs to, again and again, with nothing left over. A span with no days
 * behind it is what makes a line ambiguous rather than back to front, because it is usually a rule the crawl
 * cut the front off: Coldstream Clear's "Antigonish: 12pm-7pm, Thursday-Saturday 10am-10pm, Monday-Wednesday
 * 10am-8pm" is a lost Sunday in front of two ordinary rules, and reading it back to front would hand Thursday
 * to Saturday the missing day's clock. 36 of the 40 lines written in this order are that, or carry a word
 * between the parts, and every one of them is left exactly as it was.
 */
/** The days behind a span, and whatever the shop puts between the two of them. */
const POSTFIX_PAIR = new RegExp("^" + A_SPAN + GAP + "(?:on\\s+)?" + RULE_DAYS + "\\b", "i");
/** Between one rule and the next: the shop's own punctuation, a bracketed aside ("(Seasonal)"), or "and". */
const POSTFIX_SEP = /^[\s,;./&-]*(?:\([^)]*\)[\s,;./&-]*)?(?:and\s+)?/i;

/** One rule per span, where a shop wrote each one's days behind its clock. Null when the line is not that shape. */
function postfixRules(rule: string): string[] | null {
  const at = rule.search(A_SPAN_RE);
  // A day in front of the first clock is a line the reader above already understands.
  if (at < 0 || A_DAY_RE.test(rule.slice(0, at))) return null;
  const out: string[] = [];
  let rest = rule.slice(at);
  while (rest.trim()) {
    const pair = POSTFIX_PAIR.exec(rest);
    if (!pair) return null;
    out.push(pair[0].trim());
    rest = rest.slice(pair[0].length).replace(POSTFIX_SEP, "");
  }
  if (out.length < 2) return null;
  // Whatever the shop wrote in front of the first clock, a venue name most often, stays with the first rule.
  const head = rule.slice(0, at).trim();
  if (head) out[0] = head + " " + out[0];
  return out;
}

/** Every rule a published line holds: the crawl's glued seams opened, then the shop's own spaced-out rules. */
export function hourRules(line: string): string[] {
  return gluedRules(line).flatMap((rule) => postfixRules(rule) || spacedRules(rule));
}

/** Zero-width joiners, spaces and marks, a byte order mark, and the control characters a bad decode leaves. */
const INVISIBLE = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(31) + "​-‏  ﻿]", "g");

function hour12(h: number, m: string): string {
  const hh = Number(h) % 24;
  return ((hh % 12) || 12) + ":" + m + " " + (hh >= 12 ? "PM" : "AM");
}

/** One end of a span: a 24 hour clock read out, or one of the syntax's own variable times left as a word. */
function clockWord(t: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  return m ? hour12(Number(m[1]), m[2]) : t.toLowerCase();
}

/** The spans a rule opens with, in words, and whatever the shop wrote after them. Null when it opens with none. */
function spanRun(rest: string): { said: string; tail: string } | null {
  const first = OSM_SPAN.exec(rest);
  if (!first) return null;
  const said = [clockWord(first[1]) + " - " + clockWord(first[2])];
  let tail = rest.slice(first[0].length);
  for (let more = OSM_SPAN_MORE.exec(tail); more; more = OSM_SPAN_MORE.exec(tail)) {
    said.push(clockWord(more[1]) + " - " + clockWord(more[2]));
    tail = tail.slice(more[0].length);
  }
  // A comma or semicolon left in front of the shop's own words is the syntax's separator, not their punctuation.
  return { said: said.join(", "), tail: tail.replace(/^\s*[,;]\s*/, "").trim() };
}

/**
 * The months or the date a rule applies to, taken off the front so the days behind it can be read. Peeled only
 * when one rule is left: "May Mo[-1] -2 days-Sep Mo[1] Sa,Su 09:00-18:30" is one date range written around
 * another, and it stays the whole clause the day-code guard below drops rather than half of one.
 */
function peelSeason(clause: string): { season: string; rest: string } {
  const when = OSM_WHEN.exec(clause);
  if (!when) return { season: "", rest: clause };
  const left = clause.slice(when[0].length);
  const m = OSM_CLAUSE.exec(left);
  if (m && /\b(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/.test(m[2])) return { season: "", rest: clause };
  return { season: when[1] + " ", rest: left };
}

/**
 * One OpenStreetMap rule per line, in words. A clause may open with the months it applies to, then its day
 * codes, then a span, "off", or a note, and it may say more of the shop's own words after the span: what a
 * clause may not do is open with a sentence, so "We work daily from 10 am to 9 pm" opens with a day code, is a
 * sentence, and is left exactly as the shop wrote it.
 */
function osmLines(line: string): string[] | null {
  if (!/\b(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/.test(line)) return null;
  // A comma separates two rules once the rule before it has stated its hours ("Mo-Fr 05:45-19:00, Sa
  // 07:00-12:00"); before that it separates two days of one rule ("Fr,Sa 12:00-19:00").
  const clauses = line
    .split(/\s*(?:;|\|\|)\s*/)
    .flatMap((c) => c.split(/(?<=\d{1,2}:\d{2}|\boff)\s*,\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)\b)/i))
    .map((c) => c.trim())
    .filter(Boolean);
  const out: string[] = [];
  let rules = 0;
  let skipped = 0;
  // "Mo-Su || by appointment": the days are stated in one clause and what happens on them in the next.
  let pending = "";
  for (const whole of clauses) {
    const { season, rest: clause } = peelSeason(whole);
    const m = OSM_CLAUSE.exec(clause);
    const days = m ? m[1].split(/\s*,\s*/).map((d) => d.split(/\s*-\s*/).map((x) => DAY_CODE[x] || x).join("-")).join(", ") : pending;
    const rest = (m ? m[2] : clause).trim().replace(/^["'‘“]+|["'’”]+$/g, "").trim();
    if (!rest) {
      pending = days;
      continue;
    }
    pending = "";
    const span = spanRun(rest);
    const prefix = season + (days ? days + " " : "");
    // A day code left in the tail would be a second rule this clause never separated, which is not a shape the
    // syntax writes and not one to print half read.
    if (span && !/\b(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/.test(span.tail)) {
      out.push(prefix + span.said + (span.tail ? " " + span.tail : ""));
      rules += 1;
    } else if (/^(off|closed)$/i.test(rest)) {
      out.push(prefix + "Closed");
      rules += 1;
    } else if (m || days) {
      out.push(prefix + rest);
    } else if (!/\b(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/.test(rest)) {
      // A note on the end of the rules with no days of its own: "|| by appointment".
      out.push(prefix + rest);
    } else skipped += 1;
  }
  // A clause the syntax does not cover ("May Mo[-1] - Oct Mo[2]") is dropped, the way the week parser drops
  // it, but only once another clause has been read as a real rule: that is what keeps an ordinary English
  // sentence starting "We" or "Sat" from being taken for this syntax at all.
  if (!rules) return clauses.length > 1 && !skipped && out.length ? out : null;
  return out.length ? out : null;
}

/** "of OperationsMon - Fri8:00 am" is a heading and a day glued to a time by the crawl: "Mon - Fri 8:00 am". */
export function tidyHours(text: string): string {
  return text
    .replace(INVISIBLE, "")
    // Whatever the crawl swept up in front of the first word: a bullet, a stray bracket, an ampersand, an emoji.
    // Before the headings, not after: a calendar emoji in front of "Schedule Mon: 9:00 AM" is what kept that
    // heading on the line, and o-3palmszoo-org then printed its Monday twice, once with the heading and once
    // without.
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/^\s*(?:hours\s+)?of\s+operations?:?\s*/i, "")
    // A heading in front of the days that names nothing, on 38 shipped lines: "Schedule Mon: 9:00 AM - 3:00 PM",
    // "Open Hours Mon-Thu 8am-5pm", "Store Hours Mon Closed", "Time: 5:00pm - 7:30pm". A shop's own "Office
    // hours" and "Park hours" do name something and stay, because the office and the park are not the same door
    // as the boats, and "Opening Friday 10:00 am" is a sentence about opening rather than a heading.
    // Only when the days or the clock come straight after it: "open hours on Wednesdays and Saturdays from 1 PM"
    // is the shop's own sentence, and taking its first two words off leaves it starting on "on".
    .replace(/^(?:schedule|(?:open(?:ing)?|business|store|regular|operating)\s+hours|hours)\s*:?\s*(?=(?:\d|mon|tue|wed|thu|fri|sat|sun|daily|every ?day|weekday|weekend|closed|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\b)/i, "")
    .replace(/^times?\s*:\s*(?=[\p{L}\p{N}])/iu, "")
    // And again after them, because a heading can be followed by punctuation as well as preceded by it: the
    // crawl stored o-alhambragolf-com's line as "of operation? The course is open 6:00 AM - 11:00 PM".
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/["“”]/g, "")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * A span that covers the whole day is not opening hours. "12:00 AM - 11:59 PM" and "12:00 AM - 12:00 AM" are
 * what a site builder writes into the markup when the owner never set any, and `coversWholeDay` in openNow.ts
 * refuses to read one as hours for exactly that reason, so the open-or-closed line says nothing at all for the
 * 166 operators in the shipped catalog that publish one. This block said the opposite on the same screen: 182
 * lines across those same 166 listings, helicopter tours and jet ski rentals reading "Mon-Sun 12:00 AM - 11:59
 * PM", a closing time none of them ever stated. Same rule, same answer, so the day keeps its honest gap.
 *
 * A shop that says "24 Hours" or "Open 24/7" in words is stating something and keeps its line: what is refused
 * is a clock face that stands for nothing.
 */
const WHOLE_DAY = /(?:^|[^\d:])(?:12:00\s*AM|0?0:00)\s*(?:-|–|—|to)\s*(?:12:00\s*AM|11:59\s*PM|24:00|23:59|0?0:00)(?![\d:])/i;

/**
 * The same placeholder written from somewhere other than midnight: a range whose two ends name the same clock
 * face. An airboat ride published "Mon-Sun 1:00 AM - 1:00 AM", a brewery "Sat 12:00 PM - 12:00 PM", a bowling
 * alley "Sun 11:00 AM - 11:00 AM", a yoga studio "Wed 8:00 AM - 8:00 AM". `coversWholeDay` in openNow.ts
 * refuses to read one as hours, so this block keeps the same answer and the day keeps its honest gap: 5 lines
 * across 5 shipped listings.
 */
const SAME_ENDS = /(?:^|[^\d:])(\d{1,2}:\d{2}\s*(?:AM|PM))\s*(?:-|–|—|to)\s*\1(?![\d:])/i;

/** The published hour lines as a guest should read them. One line in can be two out when it names two days. */
export function displayHours(lines: string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    if (!raw || !isTradingHoursLine(raw)) continue;
    const osm = osmLines(raw.replace(INVISIBLE, "").trim());
    // "||" is the syntax's own separator and never a shop's own punctuation, so it starts a new line. A
    // semicolon is left alone: plenty of shops separate a real sentence with one, and a line that names its
    // days once ("Monday to Sunday 9am-7pm; holidays vary") means something different once it is cut in two.
    const plain = gluedRules(raw).flatMap((r) => r.split(/\s*\|\|\s*/));
    for (const part of osm || plain) {
      const line = tidyHours(part);
      if (line && !WHOLE_DAY.test(line) && !SAME_ENDS.test(line) && !out.includes(line)) out.push(line);
    }
  }
  return out;
}
