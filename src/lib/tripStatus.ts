/**
 * What the Trips tab remembers about one booking, and when it asks again.
 *
 * The guest's own device knows only that it sent a booking; what the operator did with it is read back from
 * the API, once per booking, and kept in a cache that outlives the tab being closed and reopened. That cache
 * used to be written with the answer `?? ""`, and `bookingStatus` answered a plain `null` whether the API had
 * said "there is no such booking" or had never answered at all. So one read that timed out, or one that the
 * per-caller limit refused, replaced a confirmed trip's "accepted" with an empty answer: the pill vanished
 * from the card on the next visit to the tab, and the empty answer stopped the code from ever being asked
 * again. A guest who had paid read their trip with no word on it at all.
 *
 * The rule is the one `apiConfig` and `guessPlace` already keep: a real answer is remembered, a failure is
 * not. An answer of "nothing here" is a real answer, because a trip on one of the hand-built listings has no
 * API row and asking after it again every time the tab opens spends a limit the paid-return path needs.
 */

/** A booking the operator has settled does not change again. */
const SETTLED = ["declined", "cancelled", "completed"];

/** What the cache should hold after one read. `undefined` leaves the booking unasked, so it is asked again. */
export function rememberStatus(cached: string | undefined, read: { status: string | null; unanswered: boolean }): string | undefined {
  if (read.unanswered) return cached;
  return read.status || "";
}

/**
 * Whether to spend a call on this booking. The first pass trusts anything already cached; a later pass, which
 * is the tab coming back into focus, re-asks everything the operator has not settled.
 */
export function askStatus(cached: string | undefined, pass: number): boolean {
  if (pass === 0) return cached === undefined;
  return !SETTLED.includes(cached || "");
}
