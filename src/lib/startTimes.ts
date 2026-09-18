/**
 * Which start times a listing that nobody has claimed offers on one date.
 *
 * A claimed shop sets its own hours, slot length, notice and days off in the dashboard, and the API builds its
 * calendar from those. An unclaimed listing has nobody to ask, so it offered the same six fixed times, every
 * day of the year, whatever the shop's own website said. On the same screen: "Closed today" in the hours row,
 * and 7 AM, 9 AM, 11 AM, 1 PM, 3 PM and 5 PM in the picker under it.
 *
 * In the shipped catalog that is 13,386 listings offering a time on a day they publish hours for that falls
 * outside them, 67,083 day-slots in all, and 1,014 offering all six on 1,737 days they say they are closed: a
 * brewery that opens at 4 PM taking a 7 AM request, a motocross track shut six days a week taking one on every
 * one of them. The operator can only decline, and "never invent availability" is the first rule in AGENTS.md.
 *
 * So the fixed times are filtered by what the shop itself published for that weekday:
 *
 * - The site says nothing about this day: the fixed times stand, unchanged. A "Mon-Fri 9-5" shop has said
 *   nothing about Saturday, and the listing page prints no hours row for it, so neither of us may call it shut.
 * - The site says it is closed: no start times, and the picker moves the guest to the next day that has some.
 * - The site states hours: the fixed times inside them. When none are inside, the shop's own opening time
 *   starts a run on the same two hour grid, so a karate school open 6 PM to 9 PM offers 6 PM and 8 PM rather
 *   than nothing at all. 626 listings would otherwise have lost every start time they had.
 *
 * Hours that run past midnight are read up to midnight only. The tail belongs to the next date, which is how
 * the claimed calendar treats it, and an unclaimed listing has no dashboard to say which service runs then.
 *
 * `backend/src/api/openSlots.ts` calls this for the public slot route, and the phone sheet and the desktop
 * listing page call it for the times they show when there is no API, so all three offer the same day.
 */

/** One weekday as the operator's site states it: minutes from midnight, `close === open` for a stated closed
 *  day, and null when the site says nothing about that day at all. */
export type StatedDay = { open: number; close: number } | null;

const DAY_MIN = 24 * 60;
/** The gap between the fixed start times, kept for a run generated from a shop's own opening time. */
const STEP_MIN = 120;
/** No more starts than the fixed list itself offers. */
const MAX_STARTS = 6;

function minutesOf(t: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

function hhmm(m: number): string {
  return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
}

/** Whether the operator's site states this weekday as one they are shut. */
export function closedOnDay(day: StatedDay): boolean {
  return !!day && day.close <= day.open;
}

/**
 * The line under a picker with nothing in it. "No more start times today" is the right answer when the notice
 * period has eaten the rest of today, and the wrong one under a Saturday five days out that the shop is simply
 * closed on, which is now 1,737 days across 1,014 listings. `weekday` is the day's own name ("Saturday").
 */
export function noStartTimesNote(day: StatedDay, weekday: string): string {
  return closedOnDay(day) ? "They are closed on " + weekday + "s. Pick another day." : "No more start times today. Pick another day.";
}

/** The start times `fixed` leaves standing on a day the operator's site states, in the order given. */
export function startTimesOn(day: StatedDay, fixed: string[]): string[] {
  if (!day) return fixed;
  const close = Math.min(day.close, DAY_MIN);
  if (close <= day.open) return [];
  const inside = fixed.filter((t) => {
    const m = minutesOf(t);
    return Number.isFinite(m) && m >= day.open && m < close;
  });
  if (inside.length) return inside;
  const out: string[] = [];
  for (let m = day.open; m < close && out.length < MAX_STARTS; m += STEP_MIN) out.push(hhmm(m));
  return out;
}
