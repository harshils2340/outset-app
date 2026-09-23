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
 * A line can carry days and a time range and still not be when the door is open. Two subjects turn up in the
 * shipped catalog and both read backwards.
 *
 * A campground's quiet hours: "Quiet hours are from 11:00pm - 8:00am" is the only hours line 37 of them
 * publish, so every one of those said "Closed, opens 11 PM" at lunchtime and "Open now, closes 8 AM" at two
 * in the morning, and Otto answered "their hours say: quiet hours are from 11:00pm - 8:00am" when a guest
 * asked whether they were open. The hours a campground states are the hours nobody may make a noise.
 *
 * A bar's happy hour: "Happy Hour Wednesday-Friday 12-6 PM" came after the same site's real "Wed 12:00 PM -
 * 10:00 PM", and the later line wins, so the brewery shut four hours early three days a week. One shop's only
 * hours line was "Happy Hour is Sunday 2:00-5:00PM, Mon-Fri 3:00-6:00PM", which read as opening at 2 AM.
 */
const NOT_TRADING_HOURS = /\b(?:quiet|happy)\s*hours?\b/i;

/** Whether a published line is about when the shop is open, rather than about quiet hours or happy hour. */
export function isTradingHoursLine(line: string): boolean {
  return !NOT_TRADING_HOURS.test(line);
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
/** A day name the crawl ran onto the end of the time before it, with no space in between. */
const GLUED_DAY = /(\d(?:\s?[ap]\.?m\.?)?)(Mon|Tues|Tue|Wednes|Wed|Thurs|Thur|Thu|Fri|Satur|Sat|Sun)(day)?\b/g;
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

/** The published hour lines as a guest should read them. One line in can be two out when it names two days. */
export function displayHours(lines: string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    if (!raw || !isTradingHoursLine(raw)) continue;
    const osm = osmLines(raw.replace(INVISIBLE, "").trim());
    // "||" is the syntax's own separator and never a shop's own punctuation, so it starts a new line. A
    // semicolon is left alone: plenty of shops separate a real sentence with one, and a line that names its
    // days once ("Monday to Sunday 9am-7pm; holidays vary") means something different once it is cut in two.
    const plain = raw.replace(GLUED_DAY, "$1\n$2$3").split(/\n|\s*\|\|\s*/);
    for (const part of osm || plain) {
      const line = tidyHours(part);
      if (line && !WHOLE_DAY.test(line) && !out.includes(line)) out.push(line);
    }
  }
  return out;
}
