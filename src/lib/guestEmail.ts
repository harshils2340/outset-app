/**
 * Whether the email a guest typed into a booking form is one the API will take.
 *
 * The field is optional on every surface, and that is the whole reason it was never checked: the booking box,
 * the phone review-and-pay sheet and the agent's own form all gate the Reserve button on the name and the
 * mobile, send the address exactly as typed, and let `POST /bookings` have the last word. That route refuses
 * an address it cannot parse with `{ error: "bad email" }` and a 400, so five ordinary typos lost the whole
 * booking: a missing TLD ("harshil@gmial"), a missing "@", a stray space, a comma for the dot, and a name
 * typed into the email box. What the guest then read was the API's own two words, "bad email.", under a
 * Reserve button whose label still said "Add your name and number", with nothing pointing at the field that
 * was wrong. The agent already had this rule for itself (`guestWords` in `lib/concierge.ts` exists to keep
 * exactly that string out of the thread), and the operator's own Listing page already checks its published
 * address the same way; only the two surfaces that take every real guest booking did not.
 *
 * It compounds, which is what makes it worth a check rather than better copy alone: both surfaces write the
 * form to `outset.guest` before they send it, and both read it back on the next listing. So one typo saved
 * once refuses every booking that device ever tries, with the same two words each time.
 *
 * The rule is the API's own regex and the API's own cap, deliberately not a stricter one: a client that
 * refuses what the server would take is a booking lost for no reason, and `validOwnerEmail` next door asks
 * for a two-letter TLD on an operator's own address, which is a different promise (booking alerts go there).
 * An empty box is still fine everywhere, because nobody is made to leave an address.
 */

/** The cap `POST /bookings` applies before it validates, so nothing is cut down to a different address. */
export const GUEST_EMAIL_MAX = 200;

/** True for an empty box, and for an address `POST /bookings` will accept. */
export function guestEmailOk(s: string | null | undefined): boolean {
  const t = (s || "").trim();
  if (!t) return true;
  return t.length <= GUEST_EMAIL_MAX && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

/** What every booking surface says under the field, so no two of them word it differently. */
export const BAD_EMAIL_LINE = "That does not look like an email address, so your confirmation would have nowhere to go.";

/** What the Reserve button says when the address is the only thing left to fix. */
export const BAD_EMAIL_CTA = "Check your email address";

/** The same thing in the agent's own voice, which speaks in the first person and offers the way out. */
export const BAD_EMAIL_ASK =
  "That email address does not look right to me. Fix it, or clear it and I will book the time without sending a confirmation.";
