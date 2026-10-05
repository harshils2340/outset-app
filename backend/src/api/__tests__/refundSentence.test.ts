import { test } from "node:test";
import assert from "node:assert/strict";
import { refundSentence } from "../bookingMail.ts";
import type { StoredBooking } from "../bookings.ts";

/**
 * What a declined or cancelled booking's email tells the guest about their money.
 *
 * `refundBooking` has three outcomes, not two: the hold was released, the charge was refunded, or the card was
 * captured and the refund did not go through. Both emails only had words for the first two, and everything else
 * fell through to "Nothing was charged." So a guest who had paid in full and whose refund failed was told their
 * money had never been taken, and since nothing retries a failed refund, that sentence was the last they heard
 * about it. A twenty second timeout on a call Stripe may well have acted on is enough to get there.
 *
 * The declined email had the same hole one step earlier: it looked at the released state and never at
 * `refunded`, so an accepted booking that was captured and then declined said "Nothing was charged" even when
 * the refund worked. Both emails read one rule now.
 */

const bk = (over: Partial<StoredBooking> = {}): StoredBooking =>
  ({ code: "OS-1000", total: 121, pricing: { subtotal: 116, fee: 5 }, payment: { session: "cs_1", intent: "pi_1", state: "captured" }, ...over }) as unknown as StoredBooking;

const captured = (state: "authorized" | "captured" | "released") => bk({ payment: { session: "cs_1", intent: "pi_1", state } });

test("a refund that worked is named, with its amount", () => {
  assert.equal(
    refundSentence(captured("released"), "usd", { refunded: true }),
    "A refund of $121.00 USD is on its way back to your card. It usually shows within 5 to 10 business days.",
  );
  // The currency is the listing's own, not a hard-coded dollar.
  assert.match(refundSentence(captured("released"), "cad", { refunded: true }), /CA\$121\.00/);
});

test("a hold that was released says so", () => {
  assert.equal(refundSentence(captured("released"), "usd", { released: true }), "The hold on your card was released and nothing was charged.");
  // Recorded as released by an earlier pass, with no flag on this call.
  assert.equal(refundSentence(captured("released"), "usd", {}), "The hold on your card was released and nothing was charged.");
});

test("a refund that did not go through is never reported as nothing charged", () => {
  const said = refundSentence(captured("captured"), "usd", { owed: true });
  assert.ok(!/Nothing was charged/i.test(said), said);
  assert.match(said, /charged \$121\.00 USD/);
  assert.match(said, /could not put the refund through/i);
  // Something a guest can act on, since no job comes back for this money on its own.
  assert.match(said, /Reply to this email/i);
});

test("a booking with no money, and one that really was never charged", () => {
  // Pay on site, or a listing that publishes no price: there is nothing to say.
  assert.equal(refundSentence(bk({ total: null, pricing: undefined, payment: undefined }), "usd", {}), "");
  // A card was taken and this is the ordinary decline before any capture.
  assert.equal(refundSentence(captured("authorized"), "usd", {}), "Nothing was charged.");
  // `owed` cannot override the record: a payment that is not captured was not taken, whatever the flag says.
  assert.equal(refundSentence(captured("authorized"), "usd", { owed: true }), "Nothing was charged.");
  // And a refund that worked wins over a stale `owed`.
  assert.match(refundSentence(captured("released"), "usd", { owed: true, refunded: true }), /refund of \$121\.00 USD is on its way/);
});

test("no em dash in any sentence it can say", () => {
  for (const opts of [{}, { refunded: true }, { released: true }, { owed: true }]) {
    for (const state of ["authorized", "captured", "released"] as const) {
      assert.ok(!refundSentence(captured(state), "usd", opts).includes("—"));
    }
  }
});
