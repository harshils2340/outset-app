export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * How many days the booking window covers, and so how many days of a shop's own calendar anything on a
 * listing asks its booking system for.
 *
 * One number, because two surfaces asking for different windows answer differently out of the same code. The
 * operator's test chat asked for the `fetchAvailability` default of 14 while every guest surface asked for
 * this, so a shop with nothing in the next ten days but a departure on the twelfth had Otto telling the
 * operator its next opening and telling their guest the calendar was empty, on a page whose whole promise is
 * that the test chat runs what guests get. Differing windows also miss the shared request cache, which is
 * keyed by window, so the same answer was fetched twice.
 */
export const BOOKING_WINDOW_DAYS = 10;

export function makeDates(count = BOOKING_WINDOW_DAYS): Date[] {
  const today = startOfToday();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    return d;
  });
}

export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * The inverse of `dateKey`: "2026-09-20" as midnight local, or null when it is not a date.
 *
 * Split by hand rather than handed to `new Date`, because a bare "YYYY-MM-DD" is parsed as UTC and read back
 * as the day before anywhere west of Greenwich. The vendors' dates are their own wall calendar and carry no
 * zone, so a round trip through UTC is a day lost for every guest in the Americas, which is most of them.
 */
export function dateFromKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || "").trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const out = new Date(y, mo - 1, d);
  // Rejects the days a month does not have: JavaScript rolls 31 February forward to 3 March without complaint.
  return out.getMonth() === mo - 1 && out.getDate() === d ? out : null;
}

/**
 * The booking window every guest surface picks a day out of, rebuilt when the local day rolls over.
 *
 * It used to be one `const` computed when the module loaded, which is correct for exactly as long as the tab
 * stays on the day it opened on. A tab left open overnight kept yesterday's window: measured in a real
 * Chromium on a listing page with the clock moved on, a tab opened at 23:50 on Friday 2 October still offered
 * Saturday 3, Sunday 4 and Monday 5 as bookable days at 00:50 on Tuesday 6, and struck 12 to 15 October
 * through as "not available" though they sit inside the shop's real ten days. Picking one of the past days
 * sends `POST /bookings` a date it refuses outright ("date out of range"), so the guest reads an error on the
 * last press of the flow; with no API behind it the past date is simply stored.
 *
 * Cached between rolls rather than rebuilt per call, because the array is a `useMemo` and `useEffect`
 * dependency on both booking surfaces and a fresh array every render would refetch the shop's calendar on
 * every keystroke. One date key is all the check costs.
 */
let windowDays: Date[] | null = null;
let windowFrom = "";

export function bookingDates(): Date[] {
  const today = dateKey(startOfToday());
  if (!windowDays || today !== windowFrom) {
    windowDays = makeDates(BOOKING_WINDOW_DAYS);
    windowFrom = today;
  }
  return windowDays;
}

/** Milliseconds until the next local midnight, so a surface can redraw itself on the roll. */
export function msToNextDay(now: Date = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return Math.max(1000, next.getTime() - now.getTime());
}

/**
 * Which month a calendar should be drawn on, given the month it is showing and the day that is picked.
 *
 * Both booking surfaces seed their month from the picked day when they mount, and then two things move that
 * day without anybody clicking the grid: the phone sheet lands the guest on the first day that has start
 * times, and the booking window rebuilds itself on the local day roll (see `bookingDates`). A grid that does
 * not follow draws a month the selection is not in, so no day looks picked and the start times beside it
 * belong to a month that is not on screen.
 *
 * `shown` is returned unchanged when the picked day is already in view, so a guest who paged forward keeps
 * the month they paged to. `span` is how many months the grid draws from `shown`: one for the phone sheet's
 * single grid, two for the desktop page's pair.
 */
export function anchorMonth(shown: Date, selected: Date, span = 1): Date {
  for (let i = 0; i < Math.max(1, span); i++) {
    const m = new Date(shown.getFullYear(), shown.getMonth() + i, 1);
    if (selected.getFullYear() === m.getFullYear() && selected.getMonth() === m.getMonth()) return shown;
  }
  return new Date(selected.getFullYear(), selected.getMonth(), 1);
}
