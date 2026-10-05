import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cardNotCharged, type OpBooking } from "../operator";

/**
 * A confirmed booking whose card was never charged.
 *
 * Every path that confirms a booking captures the card right after writing the status: the Stripe webhook and
 * the guest's return from Stripe for an instant-book shop, and `PATCH /bookings/:listing/:code` for everybody
 * else. `captureBooking` logs a failure and carries on, and all three callers throw its answer away, so the
 * booking is confirmed with a payment still recorded as a live hold, no payout row is ever written, and the
 * payout run has nothing to find. The commonest reason is ordinary rather than exotic: Stripe releases an
 * uncaptured authorization after seven days, so a shop that answers its requests once a week is accepting a
 * hold that has already gone.
 *
 * The guest's own confirmation was already right about this ("You pay the business on the day", because
 * `mailDecision` reads the payment state after the capture attempt). The operator was told nothing at all, and
 * read "you receive $110.20" in the booking drawer for money no card had paid.
 */

const bk = (over: Partial<OpBooking> = {}): OpBooking => ({
  id: "r OS-1000",
  code: "OS-1000",
  guest: "Mia",
  service: "Sunset sail",
  variant: "2 hours",
  price: null,
  qty: 4,
  total: 121,
  subtotal: 116,
  date: "2026-10-09",
  slot: "16:00",
  status: "accepted",
  created: Date.now(),
  source: "remote",
  payment: "captured",
  ...over,
});

test("a confirmed booking still on a live hold is money the operator has not been paid", () => {
  assert.equal(cardNotCharged(bk({ status: "accepted", payment: "authorized" })), true);
  // The trip happened, or the guest did not turn up: the card was still never taken.
  assert.equal(cardNotCharged(bk({ status: "completed", payment: "authorized" })), true);
  assert.equal(cardNotCharged(bk({ status: "noshow", payment: "authorized" })), true);
  // "unpaid" survives on a row the checkout never finished authorizing.
  assert.equal(cardNotCharged(bk({ status: "accepted", payment: "unpaid" })), true);
});

test("an ordinary booking is not flagged", () => {
  // The capture went through, which is the normal case.
  assert.equal(cardNotCharged(bk({ payment: "captured" })), false);
  // A request still waiting on the operator is supposed to be sitting on a hold.
  assert.equal(cardNotCharged(bk({ status: "new", payment: "authorized" })), false);
  // Declined and cancelled gave the money back; the drawer has its own line for that.
  assert.equal(cardNotCharged(bk({ status: "declined", payment: "released" })), false);
  assert.equal(cardNotCharged(bk({ status: "cancelled", payment: "released" })), false);
  // Pay on site: no card was ever taken and none was promised. This is most of the catalog.
  assert.equal(cardNotCharged(bk({ payment: undefined })), false);
  // A booking made in this browser, or a sample row, has no API payment to read.
  assert.equal(cardNotCharged(bk({ source: "guest", payment: undefined })), false);
  assert.equal(cardNotCharged(bk({ source: "sample", payment: undefined })), false);
});

test("the drawer says it where the money is promised, and says what to do instead", () => {
  const src = readFileSync(new URL("../../components/operator/OpBookings.tsx", import.meta.url), "utf8");
  assert.match(src, /cardNotCharged\(b\)/, "the drawer reads the rule");
  assert.match(src, /collect payment from the guest on the day/i, "it says what the operator has to do");
  // The guest is only told by email, and the booking form does not require an address.
  assert.match(src, /guestHearsBack\(b\)/, "and whether the guest was told at all");
  assert.ok(!/—/.test(src), "no em dash");
});
