import assert from "node:assert/strict";
import test from "node:test";
import { addonPrice, priceUnclaimed, serviceFee } from "../pricing";

/**
 * The money the booking box shows a guest, which has to be the money the server charges them
 * (priceBooking in backend/src/payments/money.ts). A price is money: only a positive number is one.
 *
 * The dashboard's price box saved whatever was typed, and `min={0}` marks a typed "-20" invalid without
 * anyone reading it, so a stray minus reached the guest listing. An extra at -20 came off the bill, an extra
 * at -500 put the total below zero, and an experience typed at -50 read "Confirm and pay -$100" on the
 * button while the server, which is held to "positive or no price", stored the booking with no price at all.
 */

const sail = (price: number | null) => ({ name: "Sunset sail", detail: "2 hours", price, per: "/person" });
const extra = (name: string, price: number | null) => ({ name, detail: "", price });

test("an extra priced below zero takes nothing off the bill", () => {
  const p = priceUnclaimed(sail(100), 2, [extra("Beer package", -20)]);
  assert.equal(p.add, 0);
  assert.equal(p.sub, 200);
  assert.equal(p.total, 200 + serviceFee(200));
});

test("no pile of negative extras can make a trip cost less than nothing", () => {
  const p = priceUnclaimed(sail(100), 1, [extra("Discount", -500), extra("More off", -500)]);
  assert.equal(p.total, 100 + serviceFee(100));
});

test("a free extra is free and a priced one still counts", () => {
  assert.equal(priceUnclaimed(sail(100), 1, [extra("Photo pack", 0), extra("Wetsuit", 30)]).add, 30);
  assert.equal(priceUnclaimed(sail(100), 1, [extra("Photo pack", null)]).add, 0);
});

/**
 * "Pay on site" is what a zero total reads as on every screen, so an experience with no real price must land
 * on zero rather than on a number nobody will be charged.
 */
test("an experience priced at or below zero has no total, the same as one with no price", () => {
  for (const price of [null, 0, -50]) {
    const p = priceUnclaimed(sail(price), 2, [extra("Wetsuit", 30)]);
    assert.equal(p.total, 0, "price " + price);
    assert.equal(p.add, 30, "price " + price);
  }
});

test("addonPrice is the one rule both the lines and the total are read through", () => {
  assert.equal(addonPrice({ price: 30 }), 30);
  assert.equal(addonPrice({ price: 0 }), 0);
  assert.equal(addonPrice({ price: null }), 0);
  assert.equal(addonPrice({ price: -20 }), 0);
});
