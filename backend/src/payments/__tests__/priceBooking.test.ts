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

/**
 * The dashboard's price box took whatever was typed, and `min={0}` stops nothing, so an operator who meant $20
 * and typed -20 published an extra that took money off the guest's bill. The experience's own price was already
 * held to "positive or no price at all"; the extras were not, and enough of them drove a booking past zero:
 * subtotal -400, fee -0, and an operator email reading "you receive -$380".
 */
const SAIL = [{ name: "Sunset sail", detail: "", price: 100 }];

test("an extra priced below zero takes nothing off the bill", () => {
  const extras = [{ name: "Beer package", detail: "", price: -20 }];
  const p = priceBooking(SAIL, extras, "Sunset sail", "", 2, ["Beer package"]);
  assert.equal(p?.subtotal, 200);
  assert.equal(p?.total, 200 + serviceFee(200));
});

test("no pile of negative extras can make a booking cost less than nothing", () => {
  const extras = [{ name: "Discount", detail: "", price: -500 }];
  const p = priceBooking(SAIL, extras, "Sunset sail", "", 1, ["Discount"]);
  assert.equal(p?.subtotal, 100);
  assert.ok((p?.total ?? 0) > 0);
});

test("a free extra is still free, and a priced one still counts", () => {
  const extras = [{ name: "Photo pack", detail: "", price: 0 }, { name: "Wetsuit", detail: "", price: 30 }];
  assert.equal(priceBooking(SAIL, extras, "Sunset sail", "", 1, ["Photo pack"])?.subtotal, 100);
  assert.equal(priceBooking(SAIL, extras, "Sunset sail", "", 1, ["Photo pack", "Wetsuit"])?.subtotal, 130);
});

/**
 * The price unit is free text, because operators sell per cabin, per lane and per anything. The word therefore
 * cannot be what decides whether the card is multiplied by the party size: an unrecognised unit used to fall
 * through to per person, so "per cabin" at $400 would have billed a party of four $1,600. When the operator
 * says outright, that wins; only a scraped price still has to be read from the words.
 */

test("the operator's own answer decides, whatever the unit is called", () => {
  const flatCabin = [{ name: "Overnight", detail: "Cabin", price: 400, per: "/cabin", perGuest: false }];
  const p = priceBooking(flatCabin, [], "Overnight", "Cabin", 4, []);
  assert.equal(p?.subtotal, 400);

  // And the other way: a unit that reads like a whole-boat price, charged per head because they said so.
  const perHeadBoat = [{ name: "Charter", detail: "Standard", price: 50, per: "/boat", perGuest: true }];
  assert.equal(priceBooking(perHeadBoat, [], "Charter", "Standard", 4, [])?.subtotal, 200);
});

test("a scraped unit naming a thing is charged once, and an unknown one still falls back to the words", () => {
  // Nothing set perGuest on any of these, which is a scraped listing. A unit that names a thing decides on its
  // own now, so the cabin above is $400 whether or not the operator ever came and said so.
  const scraped = [{ name: "Overnight", detail: "Cabin", price: 400, per: "/cabin" }];
  assert.equal(priceBooking(scraped, [], "Overnight", "Cabin", 2, [])?.subtotal, 400);
  const byHour = [{ name: "Rental", detail: "Standard", price: 60, per: "/hour" }];
  assert.equal(priceBooking(byHour, [], "Rental", "Standard", 3, [])?.subtotal, 60);
  // A unit we have never seen says nothing either way, so the option's own words still decide.
  const unknown = [{ name: "Adult ticket", detail: "Standard", price: 20, per: "/wristband" }];
  assert.equal(priceBooking(unknown, [], "Adult ticket", "Standard", 3, [])?.subtotal, 60);
});
