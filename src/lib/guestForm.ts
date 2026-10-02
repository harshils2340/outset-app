/**
 * How long the three fields a guest types about themselves may be.
 *
 * These are `POST /bookings`'s own caps, not stricter ones, and they belong on the inputs because the route
 * applies them silently: it cuts the field and then validates what is left. The operator's own fields have
 * carried a `maxLength` since they were written (`OpListing`, `OpMore`, `OpLogin`); the three that take every
 * real guest booking never did, on any of the four surfaces that draw them.
 *
 * The one that bit is the mobile. A number written with an extension is longer than it looks, so a guest
 * typing "+1 (813) 555-0100 ext. 301" had it cut inside the extension and the operator was handed a number
 * nobody can ring. The cap is 40 characters, which is what `POST /claims/:id/request` already takes an
 * owner's mobile at and long enough for any number with a desk on the end of it; with the attribute on the
 * field a guest can see the cut happen rather than find out afterwards.
 *
 * `maxLength` is a cap, never a validator: the reserve button is still gated on the name, the number and
 * `guestEmailOk`, and a field at its limit is not thereby a field that is filled in.
 */

export { GUEST_EMAIL_MAX } from "./guestEmail";

/** The route's cap on the name. Nothing a person is called comes near it. */
export const GUEST_NAME_MAX = 80;

/** The route's cap on the mobile, with room for the "ext. 301" an operator needs to ask for a desk. */
export const GUEST_PHONE_MAX = 40;
