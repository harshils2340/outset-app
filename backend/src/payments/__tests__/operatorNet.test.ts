import { test } from "node:test";
import assert from "node:assert/strict";
import { OPERATOR_FEE_RATE, operatorShare, splitBooking, serviceFee } from "../money.ts";
import { moneyOf } from "../../api/bookingMail.ts";
import { operatorNet } from "../../../../src/lib/pricing.ts";
import type { StoredBooking } from "../../api/bookings.ts";

/**
 * An operator is told what they receive in three places: the booking email, the Payouts page in the dashboard,
 * and the Stripe transfer that actually moves the money. They have to agree to the cent.
 *
 * They did not. The email and the page took 5% off in dollars (`subtotal * 0.95`, rounded to the cent) while
 * the transfer took the commission in whole cents, and a half cent rounds the other way between the two. Over
 * every price from $1.00 to $2,000.00 in cent steps they disagreed 7,214 times, always by a cent, and always
 * with the promise above the transfer: $12.50 promised $11.88 and sent $11.87, $37.50 promised $35.63 and sent
 * $35.62, and so on through $99.50, $112.50 and $187.50.
 */

const booking = (subtotal: number): StoredBooking =>
  ({ total: Math.round((subtotal + serviceFee(subtotal)) * 100) / 100, pricing: { subtotal } }) as unknown as StoredBooking;

test("the email, the Payouts page and the transfer name the same cent, on every price from $1 to $2,000", () => {
  const disagreed: number[] = [];
  for (let sub = 100; sub <= 200000; sub++) {
    const dollars = sub / 100;
    const transfer = splitBooking(booking(dollars).total as number, "usd", dollars).net;
    const email = Math.round((moneyOf(booking(dollars))?.net ?? 0) * 100);
    const page = Math.round(operatorNet(dollars) * 100);
    if (email !== transfer || page !== transfer) disagreed.push(dollars);
  }
  assert.deepEqual(disagreed, []);
});

test("the prices that used to disagree", () => {
  // Every one of these is a half cent of commission: the dollar rounding kept it for the operator, the cent
  // rounding gives it to the commission, and only the second is what Stripe transfers.
  for (const [price, net] of [[12.5, 11.87], [37.5, 35.62], [99.5, 94.52], [112.5, 106.87], [187.5, 178.12], [1249.5, 1187.02]] as const) {
    assert.equal(operatorShare(Math.round(price * 100)).operatorNet, Math.round(net * 100), `${price} nets ${net}`);
    assert.equal(moneyOf(booking(price))?.net, net, `the email for ${price}`);
    assert.equal(operatorNet(price), net, `the Payouts page for ${price}`);
  }
});

test("the commission and the net are whole cents that add back up to the price", () => {
  for (const sub of [1, 33, 250, 1999, 2500, 12345, 99999, 200000]) {
    const { commissionCents, operatorNet: net } = operatorShare(sub);
    assert.ok(Number.isInteger(commissionCents) && Number.isInteger(net));
    assert.equal(commissionCents + net, sub);
    assert.equal(commissionCents, Math.round(sub * OPERATOR_FEE_RATE));
  }
});
