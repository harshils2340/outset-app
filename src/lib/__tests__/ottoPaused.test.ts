import assert from "node:assert/strict";
import test from "node:test";
import { companyAnswer, type CompanyContext } from "../companyAgent";
import type { LiveAvailability } from "../api";
import type { Unclaimed } from "../../data/types";

/**
 * A shop that switched bookings off, or took its page down, in its own dashboard.
 *
 * `bookingPaused` is the rule both pickers read, and it is why such a listing shows "Not taking bookings right
 * now" where its Reserve button was. Otto read neither flag, so beside that panel it answered "Yes. Pick a
 * service and time on this page and they confirm it": the one thing on the page that was not true, and the
 * operator's own switch ignored. Now that Otto can see a booking calendar it would have gone further and named
 * a real departure to book here.
 *
 * The times are still true and the shop may still be selling them on their own site. "On this page" is what is
 * false, so that is what the answer says, and it hands the guest the shop.
 */

const HOURS = ["Monday: 9:00 AM - 5:00 PM", "Tuesday: 9:00 AM - 5:00 PM", "Wednesday: 9:00 AM - 5:00 PM", "Thursday: 9:00 AM - 5:00 PM", "Friday: 9:00 AM - 5:00 PM", "Saturday: 9:00 AM - 5:00 PM", "Sunday: 9:00 AM - 5:00 PM"];

const LIVE: LiveAvailability = {
  vendor: "fareharbor",
  live: true,
  days: [{ date: "2026-10-01", slots: [{ startsAt: "2026-10-01T14:00", label: "2:00 PM · Sunset Sail", bookUrl: "x" }] }],
};

const ctx = (extra: Partial<Unclaimed>, live: LiveAvailability | null = null): CompanyContext => ({
  item: {
    id: "o-example-com", title: "Gulf Coast Parasail", cat: "water", art: "jetski", area: "Clearwater Beach, FL",
    metroId: "tampa", src: "example.com", options: [{ name: "Flight", price: 85 }], specs: [], includes: [],
    hoursText: HOURS, claimed: true, ...extra,
  } as unknown as Unclaimed,
  contact: null,
  live,
});

const ASKS = ["can I book?", "do you have anything Saturday at 10am?", "when's the next opening?", "can you book it for me?"];

test("a shop that paused new bookings is not told to a guest as bookable on this page", () => {
  for (const q of ASKS) {
    const text = companyAnswer(ctx({ accepting: false }), q).text;
    assert.match(text, /paused new bookings on this page/, q + " -> " + text);
    assert.ok(!/on this page and they confirm|Pick a time on this page|Book it on this page/i.test(text), q + " -> " + text);
  }
});

test("a listing the operator took down says that instead, in the page's own words", () => {
  const text = companyAnswer(ctx({ offline: true }), "can I book?").text;
  assert.match(text, /taken this page down/);
  assert.ok(!/paused new bookings/.test(text), text);
});

test("a real departure is not offered for booking here at a paused shop either", () => {
  for (const q of ["can I book?", "when's the next opening?"]) {
    const text = companyAnswer(ctx({ accepting: false }, LIVE), q).text;
    assert.ok(!/2:00 PM/.test(text), q + " -> " + text);
    assert.match(text, /paused new bookings/);
  }
});

test("a shop taking bookings answers exactly as it always did", () => {
  assert.match(companyAnswer(ctx({}), "can I book?").text, /Pick a service and time on this page/);
  assert.match(companyAnswer(ctx({ accepting: true }), "can I book?").text, /Pick a service and time on this page/);
  assert.match(companyAnswer(ctx({}, LIVE), "when's the next opening?").text, /2:00 PM/);
});

/** A booking a guest already holds is not affected by the shop pausing new ones, and is still answered. */
test("a paused shop still says it cannot look up a booking the guest already has", () => {
  const text = companyAnswer(ctx({ accepting: false }), "did my booking go through?").text;
  assert.match(text, /can't look up a booking you already have/);
});
