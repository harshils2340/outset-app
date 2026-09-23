import { test } from "node:test";
import assert from "node:assert/strict";
import { depositNotPrice } from "../contacts.ts";

/**
 * A deposit is a fraction of the price, so a menu row that publishes one is telling a guest a number the shop
 * never charged. 27 shipped rows did: Fin & Fly's $950 half day read "$200" with "Deposit (up to 6 passengers)"
 * under it, Skydive Chelan's tandem read "$70" against a detail that shouts "NOT A TOTAL PAYMENT. A Tandem
 * Skydive is $289 per person", and Phoenix Skydive's tandem read "$9.95", which was its booking fee. Those rows
 * are the cheapest on their menus, so each one was also the from price on the card, the rail and the search
 * result. The number goes and the page says "Price on request".
 *
 * The word itself proves nothing: a keg comes "with a refundable deposit", a track rental wants "50%
 * non-refundable deposit", a jet ski advertises "no deposit required", and every one of those prices is real. So
 * the rule reads where the word sits, not whether it is there.
 */

const drops = (name: string, detail: string | null) => depositNotPrice(name, detail) != null;

test("a detail that opens with the word is the number's own description", () => {
  assert.ok(drops("33ft Boat Deep Sea Charter - Half Day - $950", "Deposit (up to 6 passengers)"));
  assert.ok(drops("Full Day Inshore Charter", "Deposit"));
  assert.ok(drops("Offshore Southern Tile", "Deposit paid up front"));
  assert.ok(drops("3 1/2 Hour Private Charter Flounder Special", "Each deposit"));
  assert.ok(drops("6-Hour Private morning fishing charter Seattle", "Each person deposit"));
  assert.ok(drops("Tandem Skydive Reservation", "Non-Refundable Deposit. NOT A TOTAL PAYMENT. A Tandem Skydive is $289 per person."));
  assert.ok(drops("AFF First Jump Course Deposit", "Nonrefundable deposit covering first jump course and jump levels 1-2"));
  assert.ok(drops("Boat Rental Deposit", "Deposit required on all boats"));
});

test("a booking fee is not the price of the jump either", () => {
  assert.ok(drops("Tandem Skydive-PHX", "Booking fee only"));
});

test("a row whose name calls itself a deposit needs no detail at all", () => {
  assert.ok(drops("Charter Tour Initial Deposit", ""));
  assert.ok(drops("Fishing Deposit", null));
  assert.ok(drops("Birthday Party Deposit", "Non-refundable deposit to reserve birthday parties."));
  // All nine of Jersey Nutz's rows, whose details are durations, so only the name says what the number is.
  assert.ok(drops("Spring Seabass Open Boat Deposit - 53' Jersey Nutz", "6 hours"));
  assert.ok(drops("Seabass or Fluke Fishing Deposit(6 Hours) - 53' Jersey Nutz", "6 hours"));
  assert.ok(drops("Offshore Canyon Overnighter Deposit- 61' Jersey Nutz", "26 hours"));
});

test("the word as a condition on a real price leaves the price alone", () => {
  assert.ok(!drops("Personal Keg Rental - Year Round", "1/6 barrel kegs of year round beers with refundable deposit"));
  assert.ok(!drops("Go-Kart Track Rental 1 Hour", "Private track rental Monday through Thursday only, 50% non-refundable deposit required"));
  assert.ok(!drops("Jet Ski Rentals Miami", "Jet ski rentals with no speed restrictions and no deposit required"));
  assert.ok(!drops("Custom Booking Pontoon Rental", "Custom booking pontoon rental at $100 per hour with $200 refundable deposit"));
  assert.ok(!drops("Paintball session reservation", "Reservation with $5 deposit per player to guarantee equipment"));
  assert.ok(!drops("Escape Room", "Escape room experience per player with age-based pricing and damage deposit."));
  assert.ok(!drops("Party Room Booking", "Booking of large or party rooms requiring deposit"));
  assert.ok(!drops("Additional Player Ticket", "Additional ticket per person after first 2 included in booking fee"));
  assert.ok(!drops("Helicopter Training Elite Price", "Hourly helicopter training with enrollment, minimum 2 hours/week, and $10,000 deposit."));
});

test("a hold against the equipment is a real charge and says what it is", () => {
  assert.ok(!drops("Damage Deposit", "Refundable damage deposit for escape room booking."));
  assert.ok(!drops("Security Deposit", "Deposit against damage to the boat"));
});

test("a row that calls itself a fee is priced as a fee", () => {
  assert.ok(!drops("Facility Rental Fees and Deposits", "Fridays, Saturdays, and Sundays"));
  assert.ok(!drops("Room Clean-up Fee (Deposit)", "Required deposit for room clean-up"));
});

test("a menu with no deposit anywhere is untouched", () => {
  assert.ok(!drops("Tandem Skydive", "Jump from 13,000 feet with an instructor"));
  assert.ok(!drops("Half Day Inshore Charter", "4 hours, up to 4 anglers"));
});
