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

/** Parse published hour lines into a 7-day schedule (Sunday first). Unknown days stay null. */
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

export function parseWeek(input: string[]): Week | null {
  const lines = input.flatMap((l) => { const o = osmToLines(l); return o.length ? o : [l]; });
  const week: Week = [null, null, null, null, null, null, null];
  let any = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const closed = /\bclosed\b/i.test(line);
    const t = TIME_RE.exec(line);
    let days: number[] | null = null;
    for (const [re, d] of DAY_RE) {
      if (re.test(line)) {
        days = d;
        break;
      }
    }
    // Specific phrases first (weekdays, daily); otherwise any explicit day range or list on the line.
    if (!days || days.length === 1) days = genericDays(line) || days;
    if (!days && t) days = [0, 1, 2, 3, 4, 5, 6];
    if (!days) continue;
    for (const d of days) {
      if (closed && !t) {
        week[d] = { open: 0, close: 0 };
        any = true;
      } else if (t) {
        const open = mins(Number(t[1]), Number(t[2] || 0), t[3], false);
        let close = mins(Number(t[4]), Number(t[5] || 0), t[6], true);
        if (!t[6] && !t[3] && close <= open) close += 12 * 60;
        if (close <= open) close += 24 * 60;
        week[d] = { open, close };
        any = true;
      }
    }
  }
  return any ? week : null;
}

export type OpenState = { open: boolean; label: string; closesAt?: string; opensAt?: string };

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
  // Late closers: yesterday's 6 PM to 2 AM still counts at 1 AM.
  if (yesterday && yesterday.close > 24 * 60 && cur + 24 * 60 < yesterday.close) return { open: true, label: "Open now, closes " + fmt(yesterday.close), closesAt: fmt(yesterday.close) };
  if (today === null) return null;
  if (today.close === 0) return { open: false, label: "Closed today" };
  if (cur >= today.open && cur < today.close) return { open: true, label: "Open now, closes " + fmt(today.close), closesAt: fmt(today.close) };
  if (cur < today.open) return { open: false, label: "Opens today at " + fmt(today.open), opensAt: fmt(today.open) };
  // Find the next open day.
  for (let i = 1; i <= 7; i += 1) {
    const d = week[(day + i) % 7];
    if (d && d.close > 0) return { open: false, label: "Closed now, opens " + (i === 1 ? "tomorrow" : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][(day + i) % 7]) + " at " + fmt(d.open), opensAt: fmt(d.open) };
  }
  return { open: false, label: "Closed" };
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

/** IANA zone for the operator from its state or province, with a longitude nudge for split states. Null when unknown. */
export function zoneFor(item: Unclaimed): string | null {
  const region = (item.area.match(/,\s*([A-Z]{2})\b/) || [])[1];
  const lon = item.lon;
  if (region === "FL" && lon != null && lon < -85.1) return "America/Chicago";
  if (region === "TX" && lon != null && lon < -105) return "America/Denver";
  if (region === "KY" && lon != null && lon < -86.4) return "America/Chicago";
  if (region === "TN" && lon != null && lon > -85.3) return "America/New_York";
  if ((region === "ND" || region === "SD" || region === "NE" || region === "KS") && lon != null && lon < -101) return "America/Denver";
  if (region === "OR" && lon != null && lon < -117.1) return "America/Boise";
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

/** Convenience for a catalog item: its week (compact on lite records, or parsed from hour lines) at the operator's local time. */
export function itemOpenState(item: Unclaimed, now = new Date()): OpenState | null {
  const week: Week | null = item.hrs?.length
    ? item.hrs.map((d) => (d ? { open: d[0], close: d[1] } : null))
    : parseWeek(item.hoursText?.length ? item.hoursText : contactFor(item)?.hours || []);
  return openStateAt(week, clockIn(zoneFor(item), now));
}
