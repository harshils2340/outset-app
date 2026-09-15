import { test } from "node:test";
import assert from "node:assert/strict";
import { priceBooking, serviceFee } from "../money.ts";

/**
 * The guest sends a total, and the server re-derives the price from the listing so the card is charged what the
 * listing says. Two service tiers can share a label ("Sunset sail, 2 hours" at $9 for a child and $19 for an
 * adult); before the hint, the first match always won, so an adult was charged the child's price. The guest's
 * total says which tier they meant.
 */

const TIERS = [
  { name: "Sunset sail", detail: "2 hours", price: 9 }, // child
  { name: "Sunset sail", detail: "2 hours", price: 19 }, // adult, same label
];

test("a shared label resolves to the tier whose price matches the guest total", () => {
  // 2 adults: 19*2 = 38, plus the $2 service fee = $40.
  assert.equal(priceBooking(TIERS, [], "Sunset sail", "2 hours", 2, [], 40)?.subtotal, 38);
  // 2 children: 9*2 = 18, plus the $1 service fee = $19.
  assert.equal(priceBooking(TIERS, [], "Sunset sail", "2 hours", 2, [], 19)?.subtotal, 18);
});

test("with no hint the first tier still wins, so old clients are unchanged", () => {
  assert.equal(priceBooking(TIERS, [], "Sunset sail", "2 hours", 1, [])?.subtotal, 9);
});

test("a total that matches neither tier still prices, never returns null", () => {
  assert.equal(priceBooking(TIERS, [], "Sunset sail", "2 hours", 1, [], 999)?.subtotal, 9);
});

test("a single priced option is charged its own price whatever the total says", () => {
  const one = [{ name: "Snorkel trip", detail: "Standard", price: 25 }];
  const p = priceBooking(one, [], "Snorkel trip", "Standard", 2, [], 1);
  assert.equal(p?.subtotal, 50);
  assert.equal(p?.total, 50 + serviceFee(50));
});

/**
 * A listing that does not price an experience has no total for it, extras or not. The guest page used to add
 * the extras up on their own and call the sum the total, so a trip priced "on request" with a $30 wetsuit read
 * "Confirm and pay $32" while this, the side that decides the money, returned null and the booking was stored
 * with no price at all. src/lib/pricing.ts now answers the same way.
 */
test("an experience with no published price has no total, even beside a priced extra", () => {
  const menu = [{ name: "Private charter", detail: "", price: null }];
  const extras = [{ name: "Wetsuit", detail: "", price: 30 }];
  assert.equal(priceBooking(menu, extras, "Private charter", "", 2, ["Wetsuit"], 32), null);
});

test("a priced experience still carries its extras", () => {
  const menu = [{ name: "Sunset sail", detail: "", price: 40 }];
  const extras = [{ name: "Wetsuit", detail: "", price: 30 }];
  const p = priceBooking(menu, extras, "Sunset sail", "", 2, ["Wetsuit"]);
  assert.equal(p?.subtotal, 110);
  assert.equal(p?.total, 110 + serviceFee(110));
});
