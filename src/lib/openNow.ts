import type { Unclaimed } from "../data/types";
import { contactFor } from "./catalog";

/**
 * "Open now" from the operator's own published hours. Reads lines like "Mon-Fri 9am-5pm", "Daily 10:00 AM to 6:00 PM",
 * "Sat: 8-4", "Closed Sunday". Returns null when the hours are unknown or unreadable, never a guess.
 */

const DAY_RE: [RegExp, number[]][] = [
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
const DAY_IDX: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
/** "Tue-Fri", "Mon, Wed & Fri", "Thu to Sun": any day range or list, expanded to day numbers. Null when the line names no day. */
function genericDays(line: string): number[] | null {
  const l = line.toLowerCase();
  const range = l.match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?\s*(?:-|–|—|to|through|thru)\s*(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/);
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
  for (const m of head.matchAll(/\b(sun|mon|tue|wed|thu|fri|sat)(?:day|sday|nesday|rsday|urday)?s?\b/g)) days.add(DAY_IDX[m[1]]);
  return days.size ? [...days].sort() : null;
}

const TIME_RE = /(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*(?:-|–|—|to|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i;

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

/** The hour lines an item publishes that are actually opening hours. */
export function hourLines(item: Unclaimed): string[] {
  return (item.hoursText || []).filter(isTradingHoursLine);
}

export type DaySpan = { open: number; close: number };
export type Week = (DaySpan | null)[];

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
  return line
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
 */
function coversWholeDay(open: number, close: number): boolean {
  return open === 0 && close >= 24 * 60 - 1;
}

/**
 * The first range on the line that could be opening hours, in minutes since midnight. A candidate no clock
 * could show, or one that spans less than half an hour or more than a day, is stepped over rather than taken,
 * so "Open House November 7, 2026 - 10:00 AM - 5:00 PM" gives up the 10 to 5 behind the date instead of
 * opening at 26 o'clock.
 */
function firstSpan(line: string): DaySpan | null {
  for (const t of normalizeClock(line).matchAll(TIME_SCAN)) {
    if (!onTheClock(t[1], t[2], t[3]) || !onTheClock(t[4], t[5], t[6])) continue;
    let open = mins(Number(t[1]), Number(t[2] || 0), t[3], false);
    let close = mins(Number(t[4]), Number(t[5] || 0), t[6], true);
    if (!t[6] && !t[3] && close <= open) close += 12 * 60;
    open = sharedMarker(open, close, t[1], t[3], t[4]);
    if (close <= open) close += 24 * 60;
    if (close - open < 30 || close - open > 24 * 60 || coversWholeDay(open, close)) continue;
    return { open, close };
  }
  return null;
}

/** Parse published hour lines into a 7-day schedule (Sunday first). Unknown days stay null. */
/** OpenStreetMap opening_hours ("Tu-Fr 16:00-21:00; Sa 10:00-22:00; Su off; PH 10:00-21:00") to plain lines the day parser reads. */
export function osmToLines(raw: string): string[] {
  if (!/\b(Mo|Tu|We|Th|Fr|Sa|Su)\b/.test(raw) || !/\d{1,2}:\d{2}|\boff\b/.test(raw)) return [];
  const FULL: Record<string, string> = { Mo: "Mon", Tu: "Tue", We: "Wed", Th: "Thu", Fr: "Fri", Sa: "Sat", Su: "Sun" };
  const out: string[] = [];
  // Rules are separated by a semicolon, by "||" for a fallback rule, and by a comma once the rule before it
  // has stated its hours: in "Mo-Fr 05:45-19:00, Sa 07:00-12:00, Su 07:00-18:00" the commas separate three
  // rules, while in "Fr,Sa 12:00-19:00" the comma separates two days of one. Reading only the semicolon left
  // a pilates studio open one day a week out of five and a gallery with no Sunday at all.
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

export function parseWeek(input: string[]): Week | null {
  const lines = input.flatMap((l) => { const o = osmToLines(l); return o.length ? o : [l]; });
  const week: Week = [null, null, null, null, null, null, null];
  let any = false;
  for (const raw of lines) {
    if (!isTradingHoursLine(raw)) continue;
    // The phone number goes before anything is read off the line, not just before the time: glued on with no
    // space it also hides the day, so "3132Tuesday - Friday" left a theatre open on Friday alone.
    const line = raw.replace(/\s+/g, " ").replace(PHONE_RE, " ").trim();
    if (!line) continue;
    const closed = /\bclosed\b/i.test(line);
    const span = firstSpan(line);
    let days: number[] | null = null;
    for (const [re, d] of DAY_RE) {
      if (re.test(line)) {
        days = d;
        break;
      }
    }
    // Specific phrases first (weekdays, daily); otherwise any explicit day range or list on the line.
    if (!days || days.length === 1) days = genericDays(line) || days;
    if (!days && span) days = [0, 1, 2, 3, 4, 5, 6];
    if (!days) continue;
    for (const d of days) {
      if (closed && !span) {
        week[d] = { open: 0, close: 0 };
        any = true;
      } else if (span) {
        week[d] = { open: span.open, close: span.close };
        any = true;
      }
    }
  }
  return any ? week : null;
}

/**
 * `label` is the sentence ("Open now, closes 7 PM"); `line` is the Google Maps / Uber Eats header form
 * ("Open · closes 7 PM", "Closes soon · 6:45 PM", "Closed · opens 9 AM tomorrow", "Closed today · opens Sat 9 AM").
 * `soon` is set while open with under an hour left.
 */
export type OpenState = { open: boolean; label: string; line: string; soon?: boolean; closesAt?: string; opensAt?: string };
const SOON_MIN = 60;

function fmt(m: number): string {
  const h = Math.floor((m % (24 * 60)) / 60);
  const mm = m % 60;
  const ap = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return hh + (mm ? ":" + String(mm).padStart(2, "0") : "") + " " + ap;
}

/** Whether the operator is open at `now` (local time of the browser). Null when hours are not published. */
export function openState(week: Week | null, now = new Date()): OpenState | null {
  return openStateAt(week, { day: now.getDay(), minutes: now.getHours() * 60 + now.getMinutes() });
}

export function openStateAt(week: Week | null, clock: { day: number; minutes: number }): OpenState | null {
  if (!week) return null;
  const day = clock.day;
  const cur = clock.minutes;
  const today = week[day];
  const yesterday = week[(day + 6) % 7];
  const openTill = (close: number, left: number): OpenState => {
    const soon = left <= SOON_MIN;
    return { open: true, label: "Open now, closes " + fmt(close), line: soon ? "Closes soon · " + fmt(close) : "Open · closes " + fmt(close), soon, closesAt: fmt(close) };
  };
  // Late closers: yesterday's 6 PM to 2 AM still counts at 1 AM.
  if (yesterday && yesterday.close > 24 * 60 && cur + 24 * 60 < yesterday.close) return openTill(yesterday.close, yesterday.close - (cur + 24 * 60));
  if (today === null) return null;
  const closedToday = today.close === 0;
  if (!closedToday && cur >= today.open && cur < today.close) return openTill(today.close, today.close - cur);
  if (!closedToday && cur < today.open) return { open: false, label: "Opens today at " + fmt(today.open), line: "Closed · opens " + fmt(today.open), opensAt: fmt(today.open) };
  // Find the next open day.
  for (let i = 1; i <= 7; i += 1) {
    const d = week[(day + i) % 7];
    if (d && d.close > 0) {
      const when = i === 1 ? "tomorrow" : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][(day + i) % 7];
      const line = (closedToday ? "Closed today" : "Closed") + " · opens " + (i === 1 ? fmt(d.open) + " tomorrow" : when + " " + fmt(d.open));
      // The sentence form stays as it was for the assistant and the phone sheet: "Closed today" carries no opensAt.
      if (closedToday) return { open: false, label: "Closed today", line };
      return { open: false, label: "Closed now, opens " + when + " at " + fmt(d.open), line, opensAt: fmt(d.open) };
    }
  }
  return closedToday ? { open: false, label: "Closed today", line: "Closed today" } : { open: false, label: "Closed", line: "Closed" };
}

/* ---------- the operator's clock, not the guest's ---------- */

const REGION_TZ: Record<string, string> = {
  // United States
  CT: "America/New_York", DE: "America/New_York", FL: "America/New_York", GA: "America/New_York", ME: "America/New_York", MD: "America/New_York", MA: "America/New_York", NH: "America/New_York", NJ: "America/New_York", NY: "America/New_York", NC: "America/New_York", OH: "America/New_York", PA: "America/New_York", RI: "America/New_York", SC: "America/New_York", VT: "America/New_York", VA: "America/New_York", WV: "America/New_York", DC: "America/New_York", MI: "America/Detroit", IN: "America/Indiana/Indianapolis", KY: "America/New_York", TN: "America/Chicago",
  AL: "America/Chicago", AR: "America/Chicago", IL: "America/Chicago", IA: "America/Chicago", KS: "America/Chicago", LA: "America/Chicago", MN: "America/Chicago", MS: "America/Chicago", MO: "America/Chicago", NE: "America/Chicago", ND: "America/Chicago", OK: "America/Chicago", SD: "America/Chicago", TX: "America/Chicago", WI: "America/Chicago",
  AZ: "America/Phoenix", CO: "America/Denver", ID: "America/Boise", MT: "America/Denver", NM: "America/Denver", UT: "America/Denver", WY: "America/Denver",
  CA: "America/Los_Angeles", NV: "America/Los_Angeles", OR: "America/Los_Angeles", WA: "America/Los_Angeles", AK: "America/Anchorage", HI: "Pacific/Honolulu",
  // Canada
  ON: "America/Toronto", QC: "America/Toronto", NS: "America/Halifax", NB: "America/Moncton", PE: "America/Halifax", NL: "America/St_Johns", MB: "America/Winnipeg", SK: "America/Regina", AB: "America/Edmonton", BC: "America/Vancouver", YT: "America/Whitehorse", NT: "America/Yellowknife", NU: "America/Iqaluit",
};

/**
 * The state or province an area line names. Usually the code after the comma ("Clearwater Beach, FL"), but an
 * operator whose town was never read publishes the code on its own ("ON"), which is an honest gap rather than
 * a missing region: 4,736 rows in the shipped catalog, 1,030 of them Canadian. Every candidate is checked
 * against the table, so a two letter word inside a place name cannot stand in for a region, and the town is
 * never read, so the catalog's "Mt, NJ" stays in New Jersey instead of moving to Montana.
 */
export function regionOf(area: string | undefined | null): string | undefined {
  const parts = String(area || "").split(",");
  for (const part of parts.slice(parts.length > 1 ? 1 : 0)) {
    const code = part.trim().toUpperCase();
    if (code.length === 2 && REGION_TZ[code]) return code;
  }
  return undefined;
}

/** IANA zone for the operator from its state or province, with a longitude nudge for split states. Null when unknown. */
export function zoneFor(item: Unclaimed): string | null {
  const region = regionOf(item.area);
  const lon = item.lon;
  if (region === "FL" && lon != null && lon < -85.1) return "America/Chicago";
  if (region === "TX" && lon != null && lon < -105) return "America/Denver";
  if (region === "KY" && lon != null && lon < -86.4) return "America/Chicago";
  if (region === "TN" && lon != null && lon > -85.3) return "America/New_York";
  if ((region === "ND" || region === "SD" || region === "NE" || region === "KS") && lon != null && lon < -101) return "America/Denver";
  // Mountain time in Oregon is Malheur County, the south east corner, so it is the east of the state that
  // moves and not the west: Portland, Salem and the whole coast are Pacific.
  if (region === "OR" && lon != null && lon > -118.3 && item.lat != null && item.lat < 44.3) return "America/Boise";
  if (region === "ID" && item.lat != null && item.lat > 45.6) return "America/Los_Angeles";
  if (region === "MI" && lon != null && lon < -88.5) return "America/Chicago";
  if (region === "BC" && lon != null && lon > -116) return "America/Edmonton";
  if (region && REGION_TZ[region]) return REGION_TZ[region];
  if (lon == null) return null;
  // No region: fall back to longitude bands across North America.
  if (lon < -140) return "America/Anchorage";
  if (lon < -114) return "America/Los_Angeles";
  if (lon < -102) return "America/Denver";
  if (lon < -87) return "America/Chicago";
  if (lon < -67) return "America/New_York";
  return "America/Halifax";
}

/** Day of week and minutes since midnight in the given zone. */
export function clockIn(zone: string | null, now = new Date()): { day: number; minutes: number } {
  if (!zone) return { day: now.getDay(), minutes: now.getHours() * 60 + now.getMinutes() };
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
    const hour = Number(get("hour")) % 24;
    return { day: day < 0 ? now.getDay() : day, minutes: hour * 60 + Number(get("minute")) };
  } catch {
    return { day: now.getDay(), minutes: now.getHours() * 60 + now.getMinutes() };
  }
}

/** The calendar date where the operator stands, as a YYYY-MM-DD key. The guest's own date when the zone is unknown. */
export function dayKeyIn(zone: string | null, now = new Date()): string {
  const local = () => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (!zone) return local();
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
    const y = get("year");
    const m = get("month");
    const d = get("day");
    return y && m && d ? `${y}-${m}-${d}` : local();
  } catch {
    return local();
  }
}

/** A start time is bookable only once it is this far out. Mirrors the notice the API applies to an unclaimed listing. */
const LEAD_MIN = 60;

/**
 * Whether a published start time is still far enough out to book, asked on the shop's clock rather than the
 * guest's. Both are wall clock times where the business stands, so comparing them to the browser's clock is
 * comparing two different zones: a guest in New York looking at a Los Angeles shop at 8 PM was cutting off
 * everything before 9 PM Pacific, so the 6 PM Pacific start the API was still offering vanished, and the
 * picker's "land on a day with departures" then moved them to tomorrow. It reads the other way too, a guest
 * west of the shop being offered times that have already gone there. The picker's own note says "Times shown
 * in the business's local time", which is exactly the promise this keeps.
 */
export function bookableStart(item: Unclaimed, now = new Date()): (dateKey: string, time: string) => boolean {
  const zone = zoneFor(item);
  const today = dayKeyIn(zone, now);
  const cutoff = clockIn(zone, now).minutes + LEAD_MIN;
  return (dateKey, time) => {
    if (dateKey > today) return true;
    if (dateKey < today) return false;
    const m = /^(\d{1,2}):(\d{2})/.exec(time);
    return m ? Number(m[1]) * 60 + Number(m[2]) >= cutoff : true;
  };
}

/** Convenience for a catalog item: its week (compact on lite records, or parsed from hour lines) at the operator's local time. */
/** The week an item publishes: compact on lite records, else parsed from its hour lines. Sunday first. */
/**
 * One compact day, or null when no clock could show it. `catalog.json` carries weeks encoded before the hour
 * parser could tell a phone number from a time, and those outlive the fix until the next sync writes the file
 * again, so a shop that opens at 36:00 is read as a shop that has not published its hours. It then falls back
 * to its own hour lines, which the fixed parser reads correctly.
 */
function compactDay(d: [number, number] | null): DaySpan | null {
  if (!d) return null;
  const [open, close] = d;
  if (open === 0 && close === 0) return { open, close };
  if (coversWholeDay(open, close)) return null;
  return open >= 0 && open < 24 * 60 && close > open && close - open <= 24 * 60 ? { open, close } : null;
}

export function itemWeek(item: Unclaimed): Week | null {
  // A compact week in `catalog.json` was encoded from the item's own hour lines by an earlier parser, so when
  // none of those lines are opening hours at all, the compact week is that misreading baked in and outliving
  // the fix until the next sync writes the file again. The 37 campgrounds whose only line is their quiet
  // hours ship one, and it is their opening hours turned inside out.
  if (item.hoursText?.length && !hourLines(item).length) return null;
  const compact = item.hrs?.length ? item.hrs.map(compactDay) : null;
  if (compact && compact.some((d) => d)) return compact;
  return parseWeek(hourLines(item).length ? hourLines(item) : contactFor(item)?.hours || []);
}

export function itemOpenState(item: Unclaimed, now = new Date()): OpenState | null {
  return openStateAt(itemWeek(item), clockIn(zoneFor(item), now));
}
