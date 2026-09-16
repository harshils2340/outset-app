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

export const TIME_RE = /(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*(?:-|–|—|to|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i;

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
 * The first range on the line that could be opening hours, in minutes since midnight. A candidate no clock
 * could show, or one that spans less than half an hour or more than a day, is stepped over rather than taken,
 * so "Open House November 7, 2026 - 10:00 AM - 5:00 PM" gives up the 10 to 5 behind the date instead of
 * opening at 26 o'clock.
 */
export function firstSpan(line: string): [number, number] | null {
  for (const t of normalizeClock(line).matchAll(TIME_SCAN)) {
    if (!onTheClock(t[1], t[2], t[3]) || !onTheClock(t[4], t[5], t[6])) continue;
    const open = mins(Number(t[1]), Number(t[2] || 0), t[3], false);
    let close = mins(Number(t[4]), Number(t[5] || 0), t[6], true);
    if (!t[6] && !t[3] && close <= open) close += 12 * 60;
    if (close <= open) close += 24 * 60;
    if (close - open < 30 || close - open > 24 * 60) continue;
    return [open, close];
  }
  return null;
}

export type WeekEnc = ([number, number] | null)[];

/** OpenStreetMap opening_hours ("Tu-Fr 16:00-21:00; Sa 10:00-22:00; Su off; PH 10:00-21:00") to plain lines the day parser reads. */
export function osmToLines(raw: string): string[] {
  if (!/\b(Mo|Tu|We|Th|Fr|Sa|Su)\b/.test(raw) || !/\d{1,2}:\d{2}|\boff\b/.test(raw)) return [];
  const FULL: Record<string, string> = { Mo: "Mon", Tu: "Tue", We: "Wed", Th: "Thu", Fr: "Fri", Sa: "Sat", Su: "Sun" };
  const out: string[] = [];
  for (const rule of raw.split(/\s*;\s*/)) {
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

export function encodeWeek(input: string[]): WeekEnc | null {
  const lines = input.flatMap((l) => { const o = osmToLines(l); return o.length ? o : [l]; });
  const week: WeekEnc = [null, null, null, null, null, null, null];
  let any = false;
  for (const raw of lines) {
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
        week[d] = [0, 0];
        any = true;
      } else if (span) {
        week[d] = [span[0], span[1]];
        any = true;
      }
    }
  }
  return any ? week : null;
}
