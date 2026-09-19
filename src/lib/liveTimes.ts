import type { LiveAvailability } from "./api";
import { fmtTime } from "./format";

/**
 * The start times a guest may pick, built from the operator's own booking system.
 *
 * Three surfaces draw these: the desktop booking card, the phone booking sheet and Otto. Each had its own
 * copy of the same twelve lines, so they had already drifted apart, and both pickers had the same two faults.
 *
 * 1. A company calendar is every trip that company sells, so two departures share a start time whenever a
 *    shop runs two boats at nine. Both were drawn as their own chip, keyed on the start time they share, so
 *    React saw one key twice, the phone drew "9:00 AM" twice in a row, and picking either one lit both up,
 *    because a pick is a time and nothing else. The seats and the price beside the second chip were the first
 *    one's on the phone, which is how a 40 seat boat came to read "2 left".
 * 2. Peek answers which dates are open in one call and a date's times in another, and the request budget
 *    stops after the first two or three, so most open dates arrive carrying a placeholder that marks the date
 *    and states no time. The pickers read its "T00:00" as a real departure and offered midnight, which the
 *    shop never sells and the guest could book.
 *
 * So: one chip per start time, and a departure whose clock time we never read is not a start time at all.
 * A booking on Outset carries a time and a service, never a vendor departure id, so collapsing a shared time
 * into one chip says exactly what we can promise.
 */

export type TimeChip = {
  /** Unique per day: the start time itself, now that a time is drawn once. */
  key: string;
  /** "09:00", the shop's own wall clock. */
  time: string;
  label: string;
  price?: number;
  seatsLeft?: number;
};

/** Seats left at or under this are worth telling a guest about. One number, so both pickers say it alike. */
export const FEW_SEATS = 4;

export function fewSeats(seatsLeft?: number): boolean {
  return seatsLeft != null && seatsLeft > 0 && seatsLeft <= FEW_SEATS;
}

/**
 * The wall clock time in "YYYY-MM-DDTHH:MM", read out of the string rather than through `new Date`. These are
 * the vendor's own local times and carry no zone, so parsing them into a Date and reading the hours back is a
 * round trip through the browser's zone for no gain, and one the older Safaris get wrong.
 */
export function clockOf(startsAt: string): string | null {
  const m = /T(\d{2}):(\d{2})/.exec(String(startsAt || ""));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h > 23 || min > 59 ? null : `${m[1]}:${m[2]}`;
}

/**
 * Start-time chips per date key, from one `GET /availability` answer. Empty when the vendor did not answer,
 * so the caller keeps whatever it was showing.
 */
export function liveChipsByDate(avail: LiveAvailability | null | undefined): Map<string, TimeChip[]> {
  const out = new Map<string, TimeChip[]>();
  if (!avail?.live) return out;
  for (const day of avail.days || []) {
    if (!day?.date) continue;
    const byTime = new Map<string, { label: string; count: number; price?: number; seats?: number; seatsEverywhere: boolean }>();
    for (const s of day.slots || []) {
      // A row that only marks the date as open states no time, so it is not a time a guest may pick.
      if (s.timeUnknown) continue;
      // A departure the vendor says has no seats left is not offered at all. The three readers already drop
      // them, so this is the belt on the braces rather than a case seen in the wild.
      if (typeof s.seatsLeft === "number" && s.seatsLeft <= 0) continue;
      const time = clockOf(s.startsAt);
      if (!time) continue;
      const price = s.priceCents != null && s.priceCents > 0 ? s.priceCents / 100 : undefined;
      const seats = typeof s.seatsLeft === "number" ? s.seatsLeft : undefined;
      const had = byTime.get(time);
      if (!had) {
        byTime.set(time, { label: s.label || fmtTime(time), count: 1, price, seats, seatsEverywhere: seats != null });
        continue;
      }
      had.count += 1;
      // Two trips at one time can no longer be named by one chip, so the chip is the clock and nothing else.
      had.label = fmtTime(time);
      // The lowest stated price, the way every other "from" figure on the page is picked.
      if (price != null) had.price = had.price != null ? Math.min(had.price, price) : price;
      // The roomiest trip at that time is what a party can still get into. One trip with no count of its own
      // leaves the whole time without one: a number that covers only some of the departures is not the truth.
      if (seats == null) had.seatsEverywhere = false;
      else had.seats = had.seats != null ? Math.max(had.seats, seats) : seats;
    }
    const chips: TimeChip[] = [];
    for (const [time, v] of byTime) {
      chips.push({
        key: time,
        time,
        label: v.label,
        ...(v.price != null ? { price: v.price } : {}),
        ...(v.seatsEverywhere && v.seats != null ? { seatsLeft: v.seats } : {}),
      });
    }
    chips.sort((a, b) => a.time.localeCompare(b.time));
    if (chips.length) out.set(day.date, chips);
  }
  return out;
}
