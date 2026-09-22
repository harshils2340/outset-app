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
 * 3. The answer used to come back as start times alone, so a date the vendor covered and answered nothing for
 *    was indistinguishable from a date it never mentioned. Both pickers read "no times anywhere" as "no live
 *    feed" and fell back to our published nine, eleven and one, which is how a shop with an empty fortnight
 *    came to show a guest three departures a day it does not sell. The API has always said which case it is:
 *    every date in the window comes back, an empty `slots` means the vendor covered that date and named
 *    nothing bookable, and a lone `timeUnknown` row means the date is open and the call budget never reached
 *    its clock times. So the reader answers all three states, and the guessed times are only for a vendor
 *    that did not answer at all.
 *
 * So: one chip per start time, a departure whose clock time we never read is not a start time at all, and an
 * empty answer is an answer. A booking on Outset carries a time and a service, never a vendor departure id,
 * so collapsing a shared time into one chip says exactly what we can promise.
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
 * What one `GET /availability` answer says, date by date.
 *
 * `live` is the only thing that decides whether a picker may guess: false means no API, an unsupported
 * booking system, or a vendor that did not answer, and the caller keeps showing whatever it had. True means
 * these dates are the shop's own calendar, and a date with no chips has no chips because the shop has nothing
 * there, not because we failed to look.
 */
export type LiveRead = {
  live: boolean;
  /**
   * The vendor answered, but the call budget stopped us short of their whole catalog or window. An empty date
   * is then only empty as far as we looked, so nothing may say the shop has nothing on.
   */
  partial: boolean;
  /** Start-time chips per date key, for the dates whose clock times we actually read. */
  chips: Map<string, TimeChip[]>;
  /** Dates the vendor covered and named nothing bookable on: shut, or sold out. */
  closed: Set<string>;
  /** Dates the vendor says are open and whose times we never read. Peek's call budget, mostly. */
  unread: Set<string>;
};

/** Chips only, for a caller that has no use for the empty dates. */
export function liveChipsByDate(avail: LiveAvailability | null | undefined): Map<string, TimeChip[]> {
  return liveRead(avail).chips;
}

export function liveRead(avail: LiveAvailability | null | undefined): LiveRead {
  const out = new Map<string, TimeChip[]>();
  const closed = new Set<string>();
  const unread = new Set<string>();
  if (!avail?.live) return { live: false, partial: false, chips: out, closed, unread };
  for (const day of avail.days || []) {
    if (!day?.date) continue;
    /**
     * Why a date ended up empty. A marker row, or a row whose clock we could not read at all, means the shop
     * has something on and we do not know when; no rows, or none with a seat left, means it has nothing.
     */
    let lost = false;
    const byTime = new Map<string, { label: string; count: number; price?: number; seats?: number; seatsEverywhere: boolean }>();
    for (const s of day.slots || []) {
      // A row that only marks the date as open states no time, so it is not a time a guest may pick.
      if (s.timeUnknown) {
        lost = true;
        continue;
      }
      // A departure the vendor says has no seats left is not offered at all. The three readers already drop
      // them, so this is the belt on the braces rather than a case seen in the wild.
      if (typeof s.seatsLeft === "number" && s.seatsLeft <= 0) continue;
      const time = clockOf(s.startsAt);
      if (!time) {
        // A departure we cannot put a clock on is a vendor shape we do not understand, not a closed shop.
        lost = true;
        continue;
      }
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
    else if (lost) unread.add(day.date);
    else closed.add(day.date);
  }
  return { live: true, partial: !!avail.partial, chips: out, closed, unread };
}

/**
 * The line under a picker with nothing in it, when the times are the vendor's own. "No departures on this
 * date" is only true of a date they covered: on a date whose times we never read it tells a guest the shop is
 * shut when its calendar says the opposite, and on a shop with an empty window it sends them through a
 * fortnight of dates one at a time to find out there is nothing behind any of them.
 */
export function liveEmptyNote(read: LiveRead, date: string): string {
  if (read.unread.has(date) || (!read.closed.has(date) && !read.chips.has(date))) {
    return "Their booking system has not listed times for this date. Pick another day.";
  }
  const window = read.closed.size + read.unread.size + read.chips.size;
  // Only a read that covered the shop's whole catalog may speak for the shop's whole fortnight.
  if (!read.chips.size && !read.unread.size && !read.partial && window > 1) {
    return "Nothing open in the next " + window + " days on their booking system.";
  }
  return "No departures on this date. Pick another day.";
}
