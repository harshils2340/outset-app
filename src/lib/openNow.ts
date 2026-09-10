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
export function parseWeek(lines: string[]): Week | null {
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
  if (!week) return null;
  const day = now.getDay();
  const cur = now.getHours() * 60 + now.getMinutes();
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

/** Convenience for a catalog item: its published hours lines, from the detail file or the contact record. */
export function itemOpenState(item: Unclaimed, now = new Date()): OpenState | null {
  const lines = item.hoursText?.length ? item.hoursText : contactFor(item)?.hours || [];
  return openState(parseWeek(lines), now);
}
