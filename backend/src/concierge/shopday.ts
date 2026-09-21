/**
 * What day it is where the shop is.
 *
 * Every reader in here turns the guest's window into calendar dates with `d.getFullYear()` and friends, under
 * a comment saying local dates are used rather than `toISOString()` because UTC rolls the evening into
 * tomorrow. That is true on a laptop in Toronto and false on the host this runs on: `render.yaml` sets no TZ
 * for `outset-api`, so the container's clock is UTC and "local" is UTC to the letter. From eight in the
 * evening Eastern, five in the afternoon Pacific, every reader asked every shop about tomorrow. "Escape room
 * tonight, 4 of us" is the sentence this product exists for, and it was the one sentence the window could not
 * answer: the 9pm slot the shop still has free was never asked for, and "tomorrow" fetched the day after.
 *
 * `src/lib/zone.ts` carries the same story for the claimed side, where it cost every North American shop the
 * back half of its day. This is that fix, for the shops we read rather than the ones we host.
 *
 * A window is an instant plus a number of days (`windowFor` in `plan.ts`), so the day a guest means is the
 * day that instant falls on where the shop is, which is what `zonedYmd` returns.
 */

/** The date on this machine's own calendar. The fallback for a shop whose zone we do not know. */
export function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The calendar day this instant falls on where the shop is. `Intl` rather than any offset arithmetic, so a
 * date in March lands on the right side of whatever that zone does about daylight saving.
 */
export function zonedYmd(d: Date, timezone?: string | null): string {
  if (timezone) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
      const [y, mo, da] = [get("year"), get("month"), get("day")];
      if (y && mo && da) return `${y}-${mo}-${da}`;
    } catch {
      /* an unrecognised zone name is not worth failing a read over */
    }
  }
  return ymdLocal(d);
}

/**
 * The date and the time of day where the shop is, for the one decision every reader makes with it: whether a
 * slot has already started. Six readers carry their own copy of this against a zone their vendor publishes;
 * this one is for the vendors that publish no zone at all, which until now compared a shop's wall clock
 * against the host's.
 */
export function zonedNow(timezone?: string | null, now: Date = new Date()): { date: string; minutes: number } {
  if (timezone) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
      }).formatToParts(now);
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
      const [y, mo, da, h, mi] = [get("year"), get("month"), get("day"), get("hour"), get("minute")];
      if (y && mo && da && h && mi) return { date: `${y}-${mo}-${da}`, minutes: (Number(h) % 24) * 60 + Number(mi) };
    } catch {
      /* an unrecognised zone name is not worth failing a read over */
    }
  }
  return { date: ymdLocal(now), minutes: now.getHours() * 60 + now.getMinutes() };
}

/**
 * A day either side of a calendar date, on the calendar rather than the clock. Walking a window by adding
 * 86,400,000 milliseconds is a day of elapsed time, not a day of the week: the night a zone springs forward
 * it steps over a date, and the night it falls back it repeats one.
 */
export function addDays(date: string, n: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}
