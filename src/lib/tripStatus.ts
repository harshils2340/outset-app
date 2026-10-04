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

/**
 * A booking the operator has settled does not change again.
 *
 * All four of these can in fact be reopened from the booking drawer ("Reinstate as confirmed", "Undo
 * no-show"), which is why `accepted` and `new` are not here: those are the two the operator is still
 * expected to move, and a guest watching the tab should see it when they do. A settled one is a verdict,
 * and re-asking after it on every window activation spends the 60 reads an hour that the guest's own return
 * from Stripe needs. `noshow` was the one missing, so a guest whose operator had marked them absent paid a
 * call for it on every focus pass, for an answer that had already been given.
 */
const SETTLED = ["declined", "cancelled", "completed", "noshow"];

/**
 * The shortest gap between two reads of the same booking.
 *
 * The tab re-asks on every window focus, and `/bookings/paid/:listing/:code` is capped at 60 calls an hour
 * for the whole address. The guest's own return from Stripe reads that same route, through `confirmPaid`, and
 * it is the one call here that must not come back refused: at 429 the confirmation screen tells a guest whose
 * card was charged that their payment is not finished. So a flurry of window activations, which is what
 * clicking between this tab and the shop's own site looks like, now costs one read of a booking rather than
 * one each. Fifteen seconds, because an ordinary switch away and back should still show an operator's answer.
 */
export const RE_ASK_MS = 15000;

/** What the cache should hold after one read. `undefined` leaves the booking unasked, so it is asked again. */
export function rememberStatus(cached: string | undefined, read: { status: string | null; unanswered: boolean }): string | undefined {
  if (read.unanswered) return cached;
  return read.status || "";
}

/**
 * Whether to spend a call on this booking. The first pass trusts anything already cached; a later pass, which
 * is the tab coming back into focus, re-asks what the operator has not settled and nobody has just asked
 * after. `sinceMs` is how long ago this booking was last read, so a booking never read is always re-asked.
 *
 * An answer of "there is no such booking" is settled too, which is the rule stated at the top of this file
 * and the one the focus pass used to break. Nothing ever creates that row later: `POST /bookings` writes it
 * before the device is told the code, and a trip the device kept because the API refused the booking (a
 * concierge-only host answers 404 for `/bookings`) never gets one at all. So those trips were asked after
 * again on every single window focus, for an answer that cannot change, out of the same hourly allowance the
 * guest's return from Stripe reads.
 */
export function askStatus(cached: string | undefined, pass: number, sinceMs = Infinity): boolean {
  if (pass === 0) return cached === undefined;
  if (cached === "" || SETTLED.includes(cached || "")) return false;
  return sinceMs >= RE_ASK_MS;
}
