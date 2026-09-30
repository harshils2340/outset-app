/**
 * Published hour lines to a compact week: seven entries, Sunday first, each [openMinutes, closeMinutes],
 * [0, 0] for a stated closed day, null when the site says nothing for that day. Mirrors src/lib/openNow.ts.
 */
export const DAY_RE: [RegExp, number[]][] = [
  [/\b(daily|every ?day|7 days|open daily)\b/i, [0, 1, 2, 3, 4, 5, 6]],
  [/\bmon(?:day)?\s*(?:-|–|to|through|thru)\s*fri(?:day)?\b/i, [1, 2, 3, 4, 5]],
  [/\bmon(?:day)?\s*(?:-|–|to|through|thru)\s*sat(?:urday)?\b/i, [1, 2, 3, 4, 5, 6]],
  [/\bmon(?:day)?\s*(?:-|–|to|through|thru)\s*sun(?:day)?\b/i, [0, 1, 2, 3, 4, 5, 6]],
  [/\btue(?:s|sday)?\s*(?:-|–|to|through|thru)\s*sun(?:day)?\b/i, [0, 2, 3, 4, 5, 6]],
  [/\bwed(?:nesday)?\s*(?:-|–|to|through|thru)\s*sun(?:day)?\b/i, [0, 3, 4, 5, 6]],
  [/\bthu(?:rs|rsday)?\s*(?:-|–|to|through|thru)\s*sun(?:day)?\b/i, [0, 4, 5, 6]],
  [/\bfri(?:day)?\s*(?:-|–|to|through|thru)\s*sun(?:day)?\b/i, [0, 5, 6]],
  [/\bsat(?:urday)?\s*(?:-|–|to|through|thru|&|and|\/)\s*sun(?:day)?\b/i, [0, 6]],
  [/\bweekends?\b/i, [0, 6]],
  [/\bweekdays?\b/i, [1, 2, 3, 4, 5]],
  [/\bsun(?:day)?s?\b/i, [0]],
  [/\bmon(?:day)?s?\b/i, [1]],
  [/\btue(?:s|sday)?s?\b/i, [2]],
  [/\bwed(?:nesday)?s?\b/i, [3]],
  [/\bthu(?:rs|rsday)?s?\b/i, [4]],
  [/\bfri(?:day)?s?\b/i, [5]],
  [/\bsat(?:urday)?s?\b/i, [6]],
];
export const DAY_IDX: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
/**
 * How a day of the week may be spelled, prefix and ending. Only the endings a real day name takes, because
 * every one of those prefixes is also the front of a word that is not a day at all: a golf course open "Mo-Su
 * 07:00-sunset" states no Sunday, a farm open "first Sunday of the month" no Monday, and a barn hired out for
 * a wedding no Wednesday. "Thur" and "Thurs" were missing, so a brewpub's "Sun, Mon, Tue, Wed, Thur 11:00 AM
 * - 9:00 PM" told a guest it was shut on Thursday, a skydive centre's "Mon, Wed, Thur, Fri - 9 AM to 5 PM"
 * the same, and a winery that wrote "THURS: 4PM-10PM" and nothing else named no day at all, which a week
 * reads as every day of it: 25 lines on 25 listings, every one of them a shop stating hours nobody read. A
 * range already read any spelling ("Thurs-Sun, 9am-4pm"); a list did not.
 */
const DAY_WORD = "(sun|mon|tue|wed|thu|fri|sat)(?:day|sday|nesday|rsday|urday|rs?)?s?";
const DAY_LIST = new RegExp("\\b" + DAY_WORD + "\\b", "g");
/** "Tue-Fri", "Mon, Wed & Fri", "Thu to Sun": any day range or list, expanded to day numbers. Null when the line names no day. */
function genericDays(line: string): number[] | null {
  const l = line.toLowerCase();
  // The day that closes a range is not asked to end on a word boundary, because the crawl glues the next thing
  // on the page straight on to it with no space for one to sit in: "Monday-Thursday9:00 AM - 5:00 PM", "Monday
  // - Sunday10am-10pm", "Tuesday - Saturdayfrom 9:00 am - 4:00 pm", "Monday - SaturdayOpen - 8:00 am to 5:00
  // pm", "Tuesday-SundayCLOSED MONDAYS10 am - 5 pm". None of those ranges was read at all, so the line named
  // its opening day alone or no day whatever, and a line naming no day is a week a guest reads as every day of
  // it. 186 listings state a range written that way, among them a museum open Tuesday to Saturday that said it
  // opened on Tuesday and nothing else, and an arts centre open all week that said Monday.
  const range = l.match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?\s*(?:-|–|—|to|through|thru)\s*(sun|mon|tue|wed|thu|fri|sat)[a-z]*/);
  const days = new Set<number>();
  if (range) {
    const a = DAY_IDX[range[1]];
    const b = DAY_IDX[range[2]];
    for (let d = a; ; d = (d + 1) % 7) {
      days.add(d);
      if (d === b) break;
    }
  }
  const head = range ? l.slice(0, range.index) + l.slice((range.index || 0) + range[0].length) : l;
  for (const m of head.matchAll(DAY_LIST)) days.add(DAY_IDX[m[1]]);
  // A shop that wrote its days as codes is read where the words name none, and where every day they do name is
  // inside the coded group, which is how "Sa-Sun" keeps the Saturday the word reader cannot see. Anything else
  // is a line the word reader has already understood, and it may not grow a day out of a stray letter.
  const coded = codeDays(line);
  if (coded && (!days.size || [...days].every((d) => coded.includes(d)))) for (const d of coded) days.add(d);
  return days.size ? [...days].sort() : null;
}

/**
 * The days a shop says it is shut, on a line that states hours as well.
 *
 * 111 lines on 106 listings write both on one line, and every one of them had the closed day standing open:
 * a brewery's "Mon Closed Tue 12pm-7pm Wed 12pm-7pm" opened on Monday at noon, a paintball field's "Mon -
 * Fri: Closed Saturday: 10am - 5pm" opened every weekday, an axe range's "MON: Closed TUES-THU: 4:30pm -
 * 9:00pm" the same, and a kayak shop's "Open daily 10AM-7:30PM, closed Wednesdays" ran seven days. The word
 * was read as a fact about the line rather than about a day, so it counted for nothing the moment the line
 * also carried a clock, and the shop stood in "Open right now near you" on the one day nobody is there.
 *
 * Which days the word is about is what the shop's own punctuation says. The days in front of it are the
 * subject where the line marks one ("Mon - Fri: Closed", "Mon - Closed", "Monday and Holidays Closed", "Sun
 * closed"), and so they are wherever the line names no day behind it. The days behind it are the subject when
 * nothing names one in front, which is how a bracketed aside is written ("Open Tuesday - Sunday (closed
 * Mondays)", "Monday - Friday (Closed Wednesday) 9 am - 4 pm") and how a line that opens on the word is
 * ("Closed Monday & Tuesday Wednesday: 4:00 pm - 8:00 pm"). When both sides name days and the two of them
 * cover the whole week, the closed day is the smaller side: "Tuesday-SundayCLOSED MONDAYS10 am - 5 pm" is six
 * days open and one shut, not the other way round.
 *
 * A closed day that carries a clock of its own is a shop shutting part of a day rather than all of it ("closed
 * Sundays after 3 PM for maintenance"), and the day keeps the hours it stated.
 */
const DAY_ANY = "(?:sun|mon|tue|wed|thu|fri|sat)(?:day|sday|nesday|rsday|urday|rs?)?s?";
/** A list or a range of days is one subject. A bare space is not a separator: "Monday & Tuesday Wednesday" is two. */
const DAY_SEP = "\\s*(?:-|\u2013|\u2014|to|thru|through|&|and|,|/)\\s*";
const DAY_GROUP = DAY_ANY + "(?:" + DAY_SEP + DAY_ANY + ")*";
/** What a shop writes between the days and the word: punctuation, a zero-width space the crawl swept up, "is" or "are". */
const CLOSED_GAP = "[\\s:;.,&=/\\-\u2013\u2014\u200b-\u200f]*";
/** A day group that ends where the word begins, which makes those days what the word is about. */
const CLOSED_BEFORE = new RegExp(
  "\\b(" + DAY_GROUP + ")" + CLOSED_GAP + "(?:(?:and\\s+|&\\s*)?holidays?\\b" + CLOSED_GAP + ")?(?:(?:is|are)\\b" + CLOSED_GAP + ")?$",
  "i",
);
/** A day group that starts where the word ends, unless it carries a clock of its own. */
const CLOSED_AFTER = new RegExp(
  "^" + CLOSED_GAP + "(?:on\\s+)?(" + DAY_GROUP + ")\\b(?!\\s*(?:after|from|until|till|before|at|past|@)\\b)",
  "i",
);
/** The same group with no limit lookahead, for the reader that wants the day a limited closure names. */
const CLOSED_AFTER_ANY = new RegExp("^" + CLOSED_GAP + "(?:on\\s+)?(" + DAY_GROUP + ")\\b", "i");

/**
 * A clock right behind the word is the hours a shop shuts for rather than the days: Page Lake Powell's
 * "Saturday & Sunday closed 8:30 a.m. to 9:30 a.m. for North & South Coyote Butte Orientation" is an hour out
 * of two mornings, and both days keep the hours they state elsewhere.
 */
const SHUT_CLOCK_GAP = "[\\s:;.,&=/\\-\u2013\u2014]*(?:from\\s+|between\\s+)?";
const CLOSED_SPAN = new RegExp("^" + SHUT_CLOCK_GAP + "\\d{1,2}(?::\\d{2})?\\s*(?:[ap]\\.?m|:)", "i");
/**
 * A closure a shop puts a clock on is part of a day rather than the whole of it: "Closed Monday until noon for
 * maintenance", "Range closed Monday mornings until 12:00 PM", "Closed Monday until 4:30 p.m.". Three
 * listings write one and every one of them had the whole day shut. What the closure is about decides what the
 * day then says. A closure with a subject of its own is not about the door, so Alhambra Golf Course, whose
 * driving range shuts for Monday morning, keeps the course's own "6:00 AM - 11:00 PM daily" on a Monday it
 * told a guest it was closed all day. A closure that is the door's own leaves the day with an honest gap
 * rather than hours, because the limit is not a closing time anybody can read and the shop has said the
 * morning is shut: Gleann Loch Farms publishes "Monday/Wednesday- 8:30am - 5:00pm" and "Closed Monday until
 * 4:30 p.m." on the same page, and a guest may be told neither that the gate is open at half past eight nor
 * that it is shut all day. "Closed Tuesday after Labor Day" names a date rather than a clock and is still a
 * day off. Only a closure that shuts the front of a day is read here: Beachwood Golf's range, "closed Sundays
 * after 3 PM for maintenance", opens when its line says it opens and shuts early, which the day-off reader
 * already keeps its hours for. And the limit has to sit beside the day it limits: a sentence may not be
 * crossed to reach one.
 */
const A_CLOCK = "(?:\\d{1,2}(?::\\d{2})?\\s*(?:[ap]\\.?m\\.?)?|noon|midnight)";
const CLOSED_LIMIT = new RegExp(
  "^" + CLOSED_GAP + "(?:on\\s+)?(?:" + DAY_GROUP + ")?(?:\\s+[a-z]+){0,2}\\s*\\b(?:until|till|before)\\b\\s*" + A_CLOCK + "\\b(?!\\d)",
  "i",
);
/** The last word in front of the closure, which is its subject where it names one. A clock is not a word. */
const CLOSED_SUBJECT = new RegExp("(?:^|[^a-z0-9])([a-z]+)[\\s:;.,&/()\\-\u2013\u2014]*$", "i");
const NOT_A_SUBJECT = new RegExp("^(?:" + DAY_ANY + "|is|are|and|or|but|also|open|hours?|holidays?|the|on|every|daily|weekdays?|weekends?)$", "i");
/** Whether the word is the door shutting rather than one thing the shop runs beside it. */
function closureIsTheDoor(head: string): boolean {
  const m = CLOSED_SUBJECT.exec(head);
  return !m || NOT_A_SUBJECT.test(m[1]);
}
/** The same shape read from the other side: the words that run from the word up to where a range starts. */
const CLOSED_LEAD = new RegExp("\\bclosed\\b" + SHUT_CLOCK_GAP + "$", "i");
const CLOSED_WORD = /\bclosed\b/gi;

/** The days a closure with a clock on it covers part of, where that closure is the door's own. */
function partlyShutDays(line: string): number[] {
  const partly = new Set<number>();
  for (const m of line.matchAll(CLOSED_WORD)) {
    const tail = line.slice(m.index + m[0].length);
    if (!CLOSED_LIMIT.test(tail)) continue;
    if (!closureIsTheDoor(line.slice(0, m.index))) continue;
    const before = genericDays(CLOSED_BEFORE.exec(line.slice(0, m.index))?.[1] || "");
    const after = genericDays(CLOSED_AFTER_ANY.exec(tail)?.[1] || "");
    for (const d of before || after || []) partly.add(d);
  }
  return [...partly];
}

function closedDays(line: string): number[] {
  const shut = new Set<number>();
  for (const m of line.matchAll(CLOSED_WORD)) {
    const tail = line.slice(m.index + m[0].length);
    if (CLOSED_SPAN.test(tail)) continue;
    if (CLOSED_LIMIT.test(tail)) continue;
    const before = genericDays(CLOSED_BEFORE.exec(line.slice(0, m.index))?.[1] || "");
    const after = genericDays(CLOSED_AFTER.exec(tail)?.[1] || "");
    const both = before && after ? new Set([...before, ...after]) : null;
    // Both sides named days and between them they name the week, so the shorter side is the day off.
    const side = both && both.size === 7 ? (before!.length <= after!.length ? before : after) : before || after;
    for (const d of side || []) shut.add(d);
  }
  return [...shut];
}

export const TIME_RE = /(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*(?:-|–|—|to|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i;

/**
 * A line can carry days and a time range and still not be when the door is open. Four subjects turn up in the
 * shipped catalog and every one reads backwards: a campground's quiet hours ("Quiet hours are from 11:00pm -
 * 8:00am", the only hours line 37 of them publish, so each said "Open now, closes 8 AM" at two in the
 * morning), and a bar's happy hour ("Happy Hour Wednesday-Friday 12-6 PM", written after the same site's real
 * "Wed 12:00 PM - 10:00 PM", and the later line wins). A third is an entry from the shop's own event calendar,
 * one date and one time with The Events Calendar's "@" between them ("Open Studio November 21 @ 11:00 am -
 * 2:00 pm"): 29 listings publish one, for all 29 it is the whole Hours block, and naming no weekday it became
 * all seven days of the week. The fourth is the last thing the shop sells ("Last rental 2:30 - 3:30 pm",
 * "Last appointment 3 to 5 pm depending on season"), which is refused only when a range hangs off it, so the
 * 14 lines that state one time rather than a range stay beside the real hours they belong to.
 *
 * Four campgrounds and hot springs word the noise rule without the word "hours" ("Quiet time is observed from
 * 10:00 PM - 7:00 AM", "Quiet to be maintained from 11:00PM to 8:00AM") and for all four it is the whole
 * block. "Times" is left out of the "time" spelling because Quiet Times Golf Course is a real business, and
 * the last-sold nouns are listed one at a time because 16 businesses are named Last something. The twin of
 * `isTradingHoursLine` in `src/lib/openNow.ts`; the two have to drop the same lines or a card and its listing
 * page disagree.
 */
export const NOT_TRADING_HOURS = /\b(?:quiet|happy)\s*hours?\b|\bquiet\s+time\b|\bquiet\s+(?:is\s+)?(?:to\s+be\s+)?(?:maintained|observed|enforced)\b/i;

/** The last thing sold, as the subject the line opens on. */
export const LAST_SOLD = /^[^\p{L}\p{N}]*last\s+(?:admission|appointment|boat|booking|call|cart|class|departure|entrance|entry|jump|launch|rental|ride|seating|session|slot|tee|ticket|tour|trip|wash)s?\b/iu;
/** A time range, however a shop writes one. The words are whole words, so "entry into the park" is not one. */
export const A_RANGE = /\d(?::\d{2})?\s*(?:[ap]\.?m\.?)?\s*(?:[-\u2013\u2014]|\b(?:to|until|till)\b)\s*\d/i;

/** The Events Calendar's own line: a single date, then "@", then the time of one event. */
export const DATED_EVENT = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?\s*@/i;

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

/**
 * The same date written in digits, which the month-name rule cannot see. Four shipped lines carry one, and for
 * three of them it is the shop's whole Hours block: a curling club's "Open House Fri, 2026-09-25 7:00 pm
 * -10:00 pm" became every Friday evening it keeps, a city's "Open Tour 09/13/2026 1:00 PM - 4:00 PM" and a
 * party centre's "Open Play- 8/22/26 11am-4pm" became every afternoon of their weeks, and a hall's "MONDAY
 * 9/7/26 1pm-5pm" became its Mondays. One open house, one tour, one open play and one Monday, each printed to
 * a guest as the hours of the business. A year is what tells a date from a season or a fraction, so only the
 * three-part spellings are read: "Early Season (5/30 - 6/12)" names two days of two months and keeps its hours.
 */
const NUMERIC_DATE = /\b\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2}(?:\d{2})?(?!\d)|\b\d{4}-\d{1,2}-\d{1,2}(?!\d)/g;
/** Whether a line names one date in digits and nothing wider, read by the same guards the written dates read. */
function namesOneNumericDate(line: string): boolean {
  const dates = [...line.matchAll(NUMERIC_DATE)];
  if (dates.length !== 1) return false;
  if (RUN_WORD.test(line)) return false;
  return !RUN_ENDS_HERE.test(line.slice(0, dates[0].index));
}

/** Whether a line names one calendar date and nothing wider, which is one day rather than a week. */
function namesOneDay(line: string): boolean {
  if (OSM_DAY_CODE.test(line)) return false;
  if (namesOneNumericDate(line)) return true;
  const dates = [...line.matchAll(DATED_DAY)];
  if (dates.length !== 1) return false;
  if ((line.match(MONTH_ANYWHERE) || []).length !== 1) return false;
  if (RUN_WORD.test(line)) return false;
  const at = dates[0].index;
  if (RUN_ENDS_HERE.test(line.slice(0, at))) return false;
  return !RUN_OF_DAYS.test(line.slice(at + dates[0][0].length));
}

/**
 * A price list is not a door. 22 shipped listings publish a line whose subject is money, and the reader took
 * the clock beside it for the shop's opening hours: Heritage Bluffs, a golf course, was open 11:00 AM to
 * 2:50 PM every day, which is its midday green fee band ("Open-10:50AM) $91 $115 $64 $84 Midday
 * (11AM-2:50PM"); Butterbrook was open from two until ten to four; Delbrook's whole weekend ran one to four.
 * Adventure Watersports opened at ten and shut at four on the strength of "$555All Day Special - Dana Hotel
 * M-F 10am-4pm", and Risen Tide Fishing, whose only line is "$749 1-4 Adults Book Now 7:30am to 12:30pm",
 * stood open from one until four because "1-4" reads as a range of hours. None of the 22 was right, so each
 * of them now keeps an honest gap rather than a rate card's hours, and the line stops being printed in the
 * Hours block a guest reads, where a dollar figure never belonged either.
 *
 * A shop that prints its admission beside its hours on one line would be refused with them. None does today,
 * and a price is the louder subject of the two, so the gap is the safer answer. The app's twin says the same.
 */
const PRICED = /\$\s?\d/;

/** Whether a published line is about when the shop is open, rather than one day, a noise rule or a last sale. */
export function isTradingHoursLine(line: string): boolean {
  if (NOT_TRADING_HOURS.test(line) || DATED_EVENT.test(line) || PRICED.test(line)) return false;
  if (LAST_SOLD.test(line) && A_RANGE.test(line)) return false;
  return !namesOneDay(line);
}

function mins(h: number, m: number, ap: string | undefined, afternoonHint: boolean): number {
  let hh = h;
  const a = (ap || "").replace(/\./g, "").toLowerCase();
  if (a === "pm" && hh < 12) hh += 12;
  if (a === "am" && hh === 12) hh = 0;
  if (!a && afternoonHint && hh < 12 && hh <= 8) hh += 12;
  return hh * 60 + m;
}

/**
 * A crawled hours line often carries the shop's own phone number glued on to it with no space between:
 * "(512) 436-3505Office Hours: 9am-6pm". Read left to right, "436-3505" is a perfectly good time range, so
 * the office hours behind it were never reached. That boat rental opened at 36:00 and closed at 47:00, which
 * a guest read as "Closed, opens 12 PM" at every hour of every day, and a balloon ride whose line was
 * ")Telephone505-293-6800 (7am to 9pm" took "05-293" and said it was open from 5 AM until 5 AM. Glued on,
 * the number hides the day as well: "3132Tuesday" has no word boundary in front of Tuesday.
 */
const PHONE_RE = /(?:\+?1[\s.\-–]*)?(?:\(\d{3}\)\s*|\d{3}[\s.\-–]+)\d{3}[\s.\-–]*\d{4}/g;
const TIME_SCAN = new RegExp(TIME_RE.source, "gi");

/**
 * An hour and minute a clock could show. 26, 36 and 52 turn up when digits from a date or a phone number are
 * read as a time. A marked hour stops at 23 rather than 24, because nobody writes midnight as "24am" but a
 * date can end in one: "4/14/2411am-1pm" offered "24am" before it offered the eleven o'clock behind it.
 */
function onTheClock(h: string | undefined, m: string | undefined, ap: string | undefined): boolean {
  return Number(h) <= (ap ? 23 : 24) && Number(m || 0) <= 59;
}

/**
 * The three ways a real shop writes a time that the hour and minute pattern cannot read, so the minutes get
 * left behind and the hour joins whatever number came before it: seconds on the clock ("9:30:00 AM"), a dot
 * for the colon ("6.30 am", "7.30am to 6pm"), and no separator at all ("Sun930am-11pm", "330pm-8pm").
 */
function normalizeClock(line: string): string {
  // The clock faces a shop wrote as words, written out here too and not only where a line is cut into rules,
  // because a span is read off the whole line as well.
  return clockFaceWords(line)
    .replace(/(\d{1,2}:[0-5]\d):[0-5]\d/g, "$1")
    .replace(/\b(\d{1,2})\.([0-5]\d)(?=\s*(?:[ap]\.?m\.?\b|[-–—]|\s+to\b))/gi, "$1:$2")
    // No space before the marker is what says the digits are one token: "1130am" is half past eleven, while
    // "October 317 am" is the thirty-first and seven o'clock.
    .replace(/\b(\d{1,2})([0-5]\d)([ap]\.?m\.?)\b/gi, "$1:$2 $3");
}

/**
 * "Mon-Thurs: 3:00 - 10:00 pm" is a brewery that opens in the afternoon, not one that opens at three in the
 * morning. A marker written once at the end of a range covers both ends of it, which is how a person reads
 * every hours line on every shop's site, unless the opening hour is the later of the two on a twelve hour
 * clock: "8:30-5" and "9-5" are mornings. An unmarked opening hour used to be read as AM whatever followed
 * it, so hundreds of breweries, tap rooms and dropzones said "Open, closes 10 PM" at three in the morning
 * and turned up in "Open right now near you" in the middle of the night.
 */
function sharedMarker(open: number, close: number, openH: string, openAP: string | undefined, closeH: string): number {
  // An hour of 0, or of 13 upward, is written on a twenty four hour clock, which carries no marker to share.
  if (openAP || Number(openH) < 1 || Number(openH) > 12 || Number(closeH) > 12) return open;
  if (close < 12 * 60 || close >= 24 * 60) return open;
  // Strictly earlier, so "8-8" stays a twelve hour day rather than becoming 8 PM to 8 PM the next morning.
  const openRel = (Number(openH) % 12) * 60 + (open % 60);
  return openRel < close - 12 * 60 ? openRel + 12 * 60 : open;
}

/**
 * A span that covers the whole day is not opening hours. "12:00 AM - 11:59 PM" and "12:00 AM - 12:00 AM" are
 * what a site builder writes into the markup when the owner never set any, and 166 operators in the shipped
 * catalog carry one, 132 of them on all seven days: helicopter tours, jet ski rentals and fishing charters
 * standing in "Open right now near you" at four in the morning under "Open, closes 11:59 PM", a closing time
 * none of them ever stated. A late closer still counts: "6pm-2am" opens at a stated hour.
 *
 * A range whose two ends name the same clock face is the same placeholder written from somewhere other than
 * midnight, and the rule read only the ones that started there. An airboat ride published "Mon-Sun 1:00 AM -
 * 1:00 AM", a brewery "Sat 12:00 PM - 12:00 PM", a yoga studio "Wed 8:00 AM - 8:00 AM": 6 shipped listings
 * and 12 day lines, each read as open around the clock, so the shop stood in the open-now rail at every hour
 * of that day and its picker offered every fixed start time. Nobody trades noon to noon, so the span is
 * measured rather than its opening end, and the day keeps its honest gap.
 */
function coversWholeDay(open: number, close: number): boolean {
  return close - open >= 24 * 60 - 1;
}

/**
 * The first range on the line that could be opening hours, in minutes since midnight, and where on the line it
 * sits. A candidate no clock could show, or one that spans less than half an hour or more than a day, is
 * stepped over rather than taken, so "Open House November 7, 2026 - 10:00 AM - 5:00 PM" gives up the 10 to 5
 * behind the date instead of opening at 26 o'clock. The twin of the guest side's reader, including where the
 * scan resumes after a refused candidate.
 *
 * Where it sits matters because a range can be the hour a shop shuts rather than the hour it opens, and only
 * the words in front of it say which.
 */
export function firstSpanAt(line: string): { span: [number, number]; at: number } | null {
  const text = normalizeClock(line);
  const scan = new RegExp(TIME_SCAN.source, "gi");
  for (let t = scan.exec(text); t; t = scan.exec(text)) {
    // A candidate no clock could show is usually a date or a phone number sitting on top of a real range, and
    // reading on from the end of it took the range with it: "2026 - 10am to 4pm" offers "26 - 10am" first, and
    // the ten o'clock behind it was never reached, so a museum stating its own hours stated none. Scanning
    // resumes just past the hour that failed rather than past the whole candidate. A range the clock can show
    // and the length rule then refuses is read on from as before: its digits are a real span, and half of one
    // is not opening hours either.
    if (!onTheClock(t[1], t[2], t[3]) || !onTheClock(t[4], t[5], t[6])) {
      scan.lastIndex = t.index + t[1].length;
      continue;
    }
    let open = mins(Number(t[1]), Number(t[2] || 0), t[3], false);
    let close = mins(Number(t[4]), Number(t[5] || 0), t[6], true);
    if (!t[6] && !t[3] && close <= open) close += 12 * 60;
    open = sharedMarker(open, close, t[1], t[3], t[4]);
    if (close <= open) close += 24 * 60;
    if (close - open < 30 || close - open > 24 * 60 || coversWholeDay(open, close)) continue;
    return { span: [open, close], at: t.index };
  }
  return null;
}

/** The first range alone, for the callers that do not care where it sits. */
export function firstSpan(line: string): [number, number] | null {
  return firstSpanAt(line)?.span ?? null;
}

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
/**
 * What a shop writes between two days, which can be more than one mark: New Jersey Repertory separates the
 * last of its five with a comma and an ampersand together ("Mo, Tu, Wed, Th, & Fr"), and one separator was
 * all a group could hold, so the group ended at Thursday.
 */
const DAY_JOIN = "\\s*(?:(?:-|\u2013|\u2014|to|thru|through|&|and|,|/)\\s*)+";
/** Two or more days in any spelling, joined as a range or a list: one subject, however the shop separates it. */
const DAY_SUBJECT = GROUP_DAY + "(?:" + DAY_JOIN + GROUP_DAY + ")+";
/**
 * A group ends where the letters do rather than where the word does, because the crawl glues the clock
 * straight on to the last day of it: New Jersey Repertory's "Mo, Tu, Wed, Th, & Fr12:00pm-4:00pm" ended its
 * group at Thursday, so a theatre open Monday to Friday said nothing at all about its Friday.
 */
const CODE_GROUP = new RegExp("\\b" + DAY_SUBJECT + "(?![a-z])", "gi");
/** One day of a group, wherever it sits in it. */
const DAY_PART = new RegExp("\\b" + GROUP_DAY + "\\.?(?![a-z])", "gi");
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
function codeDays(line: string): number[] | null {
  const days = new Set<number>();
  for (const m of line.matchAll(CODE_GROUP)) {
    // The days are read where they sit and what the shop wrote between two of them is whatever is left in
    // between, because a separator is not always one mark: counting the parts of a split assumes it is.
    const tokens = [...m[0].matchAll(DAY_PART)];
    // A group of words alone is the word reader's, not this one's.
    if (!tokens.some((t) => t[0].replace(/\.$/, "").length <= 2)) continue;
    const idx = tokens.map((t) => dayOfToken(t[0]));
    if (idx.some((d) => d === undefined)) continue;
    let prev = -1;
    for (let i = 0; i < idx.length; i += 1) {
      const d = idx[i] as number;
      const join = i ? m[0].slice(tokens[i - 1].index + tokens[i - 1][0].length, tokens[i].index).trim() : "";
      if (prev >= 0 && RANGE_JOIN.test(join)) {
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
 * Sunday it opens at noon. The whole story, and the three shapes this deliberately leaves alone, are in the
 * twin of this rule in src/lib/hoursText.ts.
 */
/** What a shop leaves between the parts of a rule: punctuation, or a zero-width space the crawl swept up. */
const GAP = "[\\s:;.,&=/\\-\u2013\u2014]*";
/** The days a rule opens on, as a range or a list: one subject, however the shop separates it. */
/** The days a rule may open on: two or more in any spelling, or one written as a word. A lone code is not
 * one of them, because a single letter by itself is as likely to be a street direction as a day. */
const RULE_DAYS = "(?:" + DAY_SUBJECT + "|" + ANY_DAY + ")";
/** A span, both ends written out. */
const A_SPAN = "\\d{1,2}(?::\\d{2})?\\s*(?:[ap]\\.?m\\.?)?\\s*(?:-|\u2013|\u2014|to|until|till)\\s*\\d{1,2}(?::\\d{2})?\\s*(?:[ap]\\.?m\\.?)?";
const A_SPAN_RE = new RegExp(A_SPAN, "i");
/** Whether a clause has already named a day, which the days behind a cut have to sit behind. A lone code
 * counts here: "M 4:30PM - 9PM tu - su 11:30AM - 9PM" is a Monday and then the rest of the week, and the
 * rule behind the cut names its own days whatever this one turns out to hold. */
const A_DAY_RE = new RegExp("\\b" + GROUP_DAY + "\\b", "i");
const EVERY_DAY_RE = new RegExp("\\b" + GROUP_DAY + "\\b", "gi");
/** The next rule, whole: its own days, then whatever the shop puts in front of the clock, then its own span. */
const NEXT_RULE = new RegExp("^" + RULE_DAYS + GAP + "\\(?" + GAP + "(?:from\\s+|open\\s+|at\\s+)?" + A_SPAN, "i");
/**
 * A day off with no day in front of it owns the day written behind it; one that already names its own day is
 * finished, and the rule behind it is the next one. See the twin for which lines those are.
 */
const SAID_CLOSED = /\bclosed[\s:;.,&=/\-\u2013\u2014]*$/i;
const CLOSED_HAS_DAY = new RegExp("\\b" + RULE_DAYS + GAP + "(?:(?:and\\s+|&\\s*)?holidays?" + GAP + ")?(?:(?:is|are)" + GAP + ")?closed" + GAP + "$", "i");
/** The next rule can be a day off of its own, which makes such a line three rules rather than two. */
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
    if (span < 0 || day < 0 || day > span) continue;
    if (SAID_CLOSED.test(said) && !CLOSED_HAS_DAY.test(said)) continue;
    if (!NEXT_RULE.test(rest) && !NEXT_CLOSED.test(rest)) continue;
    return [said.trim(), ...spacedRules(rest)].filter(Boolean);
  }
  return [rule];
}

/**
 * A shop that writes the clock in front of the days it belongs to, over and over ("Ferndale: 12pm - 9pm
 * Mon-Tue, 12pm - 10pm Wed-Thu, 12pm - 8pm Fri-Sun"), which the reader above cannot cut because a cut there
 * needs the days to come first. Which lines those are, and the ambiguous shape this deliberately leaves
 * alone, are in the twin of this rule in src/lib/hoursText.ts.
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

/**
 * A range word on either side of the clock face a shop wrote as a word.
 */
const RANGE_WORD = "(?:[-\u2013\u2014]|'?(?:to|till|til|until|through)\\b)";
/**
 * The two clock faces a shop writes as a word rather than as digits. "Fri-Sat: Noon - 10:00 pm" and "Sat:
 * Noon to 11PM" name a time the hour pattern cannot read, so the day named no span at all and kept an honest
 * gap: 68 shipped listings publish one, most of them the tap rooms and cider houses that open at noon at the
 * weekend and the bowling alleys and karting tracks that shut at midnight, and Main Street Beer, which writes
 * every one of its seven days that way, had no week at all. Any "12" in front is swallowed with the word so
 * "12 Noon" and "12:00 midnight" leave no stray hour behind, which is what made Fast Track Karting's "10AM -
 * 12midnight" a day ending at noon. The word only counts as a clock where it carries that "12" or sits
 * against a range word, because a business can be called one: Noon Whistle Brewing is in the catalog.
 *
 * It is written out before a line is cut into rules as well as before a span is read off one, because the
 * cut needs to see the span too: "Sunday: Noon - 5pm Tuesday-Saturday: 11am - 5pm" is two rules, and with
 * the first span unreadable it was one, so a museum open at eleven from Tuesday gave every day its Sunday.
 * The app's twin of this reader says the same.
 */
const CLOCK_WORD = new RegExp(
  "\\b12(?::00)?\\s*(noon|midnight)\\b" +
    "|(?<=" + RANGE_WORD + "\\s*)(noon|midnight)\\b" +
    "|\\b(noon|midnight)(?=\\s*(?:" + RANGE_WORD + "|&|and\\b))",
  "gi",
);

/** A published line with the clock faces its shop wrote as words written out as times. */
function clockFaceWords(line: string): string {
  return line.replace(CLOCK_WORD, (_m, a, b, c) => ((a || b || c).toLowerCase() === "noon" ? "12:00 pm" : "12:00 am"));
}

/** Every rule a published line holds: the crawl's glued seams opened, then the shop's own spaced-out rules. */
export function hourRules(line: string): string[] {
  const said = clockFaceWords(line);
  return gluedRules(said).flatMap((rule) => postfixRules(rule) || spacedRules(rule));
}

export type WeekEnc = ([number, number] | null)[];

/** OpenStreetMap opening_hours ("Tu-Fr 16:00-21:00; Sa 10:00-22:00; Su off; PH 10:00-21:00") to plain lines the day parser reads. */
export function osmToLines(raw: string): string[] {
  if (!/\b(Mo|Tu|We|Th|Fr|Sa|Su)\b/.test(raw) || !/\d{1,2}:\d{2}|\boff\b/.test(raw)) return [];
  const FULL: Record<string, string> = { Mo: "Mon", Tu: "Tue", We: "Wed", Th: "Thu", Fr: "Fri", Sa: "Sat", Su: "Sun" };
  const out: string[] = [];
  // Rules are separated by a semicolon, by "||" for a fallback rule, and by a comma once the rule before it
  // has stated its hours: in "Mo-Fr 05:45-19:00, Sa 07:00-12:00" the comma separates two rules, while in
  // "Fr,Sa 12:00-19:00" it separates two days of one. The app's twin of this reader says the same.
  for (const rule of raw.split(/\s*(?:;|\|\|)\s*/).flatMap((r) => r.split(/(?<=\d{1,2}:\d{2}|\boff)\s*,\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)\b)/i))) {
    const m = rule.match(/^\s*((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:\s*,\s*)?)+)\s*(.*)$/);
    if (!m) continue;
    const days = m[1].replace(/\s+/g, "").split(",").map((d) => d.split("-").map((x) => FULL[x] || x).join("-")).join(", ");
    const rest = m[2].trim();
    if (/^(off|closed)$/i.test(rest)) out.push(days + " Closed");
    else {
      const t = rest.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
      if (!t) continue;
      const to12 = (h: number, mm: string) => ((h % 12) || 12) + ":" + mm + " " + (h >= 12 && h < 24 ? "PM" : "AM");
      out.push(days + " " + to12(Number(t[1]), t[2]) + " - " + to12(Number(t[3]) % 24 || (Number(t[3]) === 24 ? 0 : Number(t[3])), t[4]));
    }
  }
  return out;
}

/** What one rule states: the days it names, the days it shuts, its span, and whether it says the word. */
type RuleRead = { days: number[] | null; shut: number[]; span: [number, number] | null; closed: boolean; partly: number[] };

function readRule(raw: string): RuleRead | null {
  // The phone number goes before anything is read off the line, not just before the time: glued on with no
  // space it also hides the day, so "3132Tuesday - Friday" left a theatre open on Friday alone.
  const line = raw.replace(/\s+/g, " ").replace(PHONE_RE, " ").trim();
  if (!line) return null;
  // An hour a shop shuts for is not an hour it opens. Page Lake Powell publishes its real week and then
  // "Saturday & Sunday closed 8:30 a.m. to 9:30 a.m. for North & South Coyote Butte Orientation", and that
  // line, being the last one written, gave Saturday and Sunday the hour of the orientation as their whole
  // opening hours: a guest read "8:30 AM - 9:30 AM" on a shop open until two. The days are already kept out of
  // the day-off list by CLOSED_SPAN; when the closure's own clock is also the first range the line carries,
  // the rule states no hours at all, and its "closed" is about that hour rather than about a day. The twin of
  // this rule is in src/lib/openNow.ts.
  const hit = firstSpanAt(line);
  const shutsForAnHour = !!hit && CLOSED_LEAD.test(normalizeClock(line).slice(0, hit.at));
  // A closure the shop put a clock on shuts part of a day, so the word itself shuts nothing: a line whose
  // every closure carries a limit states no day off, and where the closure is the door's own the day it names
  // is cleared below instead.
  const words = [...line.matchAll(CLOSED_WORD)];
  const limited = words.length > 0 && words.every((m) => CLOSED_LIMIT.test(line.slice(m.index + m[0].length)));
  const closed = !shutsForAnHour && !limited && /\bclosed\b/i.test(line);
  const shut = closedDays(line);
  // A closure the shop put a clock on is not a day off, and where it is the door's own the day it names says
  // nothing rather than saying hours: the shop has told a guest part of that day is shut.
  const partly = partlyShutDays(line).filter((d) => !shut.includes(d));
  const span = shutsForAnHour ? null : hit?.span ?? null;
  let days: number[] | null = null;
  for (const [re, d] of DAY_RE) {
    if (re.test(line)) {
      days = d;
      break;
    }
  }
  // Specific phrases first (weekdays, daily); otherwise any explicit day range or list on the line.
  if (!days || days.length === 1) days = genericDays(line) || days;
  // A stated day off can be the one day a phrase does not name, on either side: "Open daily 10AM-7:30PM,
  // closed Wednesdays" names six open days through "daily", and "Mon - Fri: Closed Saturday: 10am - 5pm"
  // names its open Saturday nowhere else, so the phrase and the days written out are read together.
  else if (shut.length) {
    const named = genericDays(line);
    if (named) days = [...new Set([...days, ...named])].sort((a, b) => a - b);
  }
  return { days, shut, span, closed, partly };
}

export function encodeWeek(input: string[]): WeekEnc | null {
  // Whether a published line is opening hours at all is read off the whole line, and what it states off each
  // rule it turns out to hold: "MondayClosedTuesday2:00PM to 7:00PM" is a day off and a day's hours, not one
  // line that is somehow both, and "Mon-Sat 10am - 5pm Sunday 12pm - 5pm" is six days and a Sunday that opens
  // two hours later, not one span for all seven.
  const lines = input
    .flatMap((l) => { const o = osmToLines(l); return o.length ? o : [l]; })
    .flatMap((l) => (isTradingHoursLine(l) ? hourRules(l) : []));
  const week: WeekEnc = [null, null, null, null, null, null, null];
  const read = lines.map(readRule).filter((r): r is RuleRead => !!r);
  // Which days a rule that named its own days has spoken for. A dayless rule may not overwrite one of those,
  // but it may still overwrite another dayless rule, so the last one a page states is still the one that wins.
  const spoken = [false, false, false, false, false, false, false];
  const apply = (r: RuleRead, days: number[], dayless: boolean) => {
    const set = (d: number, open: number, close: number) => {
      if (dayless && spoken[d]) return;
      week[d] = [open, close];
      if (!dayless) spoken[d] = true;
    };
    for (const d of days) {
      if (r.shut.includes(d)) continue;
      // The word is about the days it names, so the rest of the line is not shut with them: a spa's "Monday -
      // Saturday, closed Sunday" states no hours and had closed the six days it is open.
      if (r.closed && !r.span && !r.shut.length) set(d, 0, 0);
      else if (r.span) set(d, r.span[0], r.span[1]);
    }
    for (const d of r.shut) set(d, 0, 0);
  };
  for (const r of read) if (r.days) apply(r, r.days, false);
  // A span with no day in front of it is a fallback rather than a statement about any particular day, so it
  // fills the days nothing else names and leaves the rest alone. The twin of this rule, and the shops it puts
  // right, are in src/lib/openNow.ts.
  // A rule whose only named days are the days it shuts is telling a guest about the rest of the week, so its
  // span is read as one: "open six days a week (closed Tuesdays) 10:00am-5:00pm" named Tuesday and nothing
  // else, so the museum's Tuesday was shut and the six days it is open said nothing at all. The span joins the
  // fallback pass rather than the statements, so a line that does name one of those days still wins it, and
  // `apply` already steps over the days the rule shuts. The twin of this rule is in src/lib/openNow.ts.
  const onlyShut = (r: RuleRead) => !!r.days && r.days.length > 0 && r.days.every((d) => r.shut.includes(d));
  for (const r of read) if (r.span && (!r.days || onlyShut(r))) apply(r, [0, 1, 2, 3, 4, 5, 6], true);
  // A day the door itself is shut for part of is left with its honest gap, whatever any other line said about
  // it: neither the hours nor a day off is true of it, and a picker offering its morning sends a guest to a
  // locked gate. Read last, so the order the page states its lines in does not decide.
  for (const r of read) for (const d of r.partly) week[d] = null;
  return week.some(Boolean) ? week : null;
}
