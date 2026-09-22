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
