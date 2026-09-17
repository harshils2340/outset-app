import { test } from "node:test";
import assert from "node:assert/strict";
import { perPerson, priceBooking, serviceFee } from "../money.ts";

/**
 * Whether the card is multiplied by the party. The unit the operator's own site prints settles it, and it is
 * read before the option's words, because those words carry the party a service holds at least as often as the
 * party it is priced for: a capacity ("for up to 200 guests"), a ratio ("2:1 guest to guide") and a seat count
 * ("seating 12-19 passengers") all read as a price per person. 1,726 priced options across 808 operators in the
 * shipped catalog were multiplied that way. Every row below is a real one from public/o.
 */

test("a capacity in the words does not turn a group price into a price per guest", () => {
  // o-sandpipergolf-com. A party of four was charged 4 x 18,500.
  const venue = { name: "Event Venue Rental Riviera Lawn", detail: "Event space for up to 200 guests with ocean and mountain views", per: "/group", price: 18500 };
  assert.equal(perPerson(venue), false);
  assert.equal(priceBooking([venue], [], venue.name, venue.detail, 4, [])?.subtotal, 18500);
});

test("a guide ratio and a seat count read the same way", () => {
  // o-aleutianadventures-com and o-theflightking-com.
  assert.equal(perPerson({ name: "Sapsuk River Camp Fly Fishing Package", detail: "6 nights guided fishing with 2:1 guest to guide ratio", per: "/group", price: 9325 }), false);
  assert.equal(perPerson({ name: "Extra Large Jet Charter", detail: "Jets seating 12-19 passengers", per: "/hr", price: 9600 }), false);
});

test("a person in the name never overrides the unit the site printed", () => {
  // o-30ainshorecharters-com, o-kelownakarting-com, o-bostonharbormarina-com.
  assert.equal(perPerson({ name: "Kid Friendly Trip", detail: "2-hour private fishing charter", per: "/group", price: 375 }), false);
  assert.equal(perPerson({ name: "Adult Karting Party Bronze", detail: "Party package with 2 adult karting races for up to 8 participants", per: "/group", price: 499 }), false);
  assert.equal(perPerson({ name: "Child Sit On Top Kayak Rental", detail: "For kids 7 y/o and up to paddle alone", per: "/trip", price: 35 }), false);
});

test("a night, a vehicle, a jet ski and a half hour are things, not people", () => {
  // o-alongtherivernh-com, o-epic4x4adventures-com, o-goldengatekarateschool-com.
  assert.equal(perPerson({ name: "RV site", price: 48, per: "/night" }), false);
  assert.equal(perPerson({ name: "Poison Spider Mesa Tour", detail: "Polaris RZR Pro R 2-seater", per: "/vehicle", price: 419 }), false);
  assert.equal(perPerson({ name: "Private Instructor Lessons", price: 50, per: "/30 min" }), false);
  assert.equal(perPerson({ name: "Jet ski rental", price: 199, per: "/jet ski" }), false);
});

test("a unit that names a person still multiplies the card", () => {
  const adult = { name: "Museum entry", detail: "Standard", per: "/adult", price: 14 };
  assert.equal(perPerson(adult), true);
  assert.equal(perPerson({ name: "Sunset sail", detail: "2 hours", per: "/person", price: 29 }), true);
  const p = priceBooking([adult], [], adult.name, adult.detail, 3, []);
  assert.equal(p?.subtotal, 42);
  assert.equal(p?.total, 42 + serviceFee(42));
});

test("the operator's own switch still beats every unit", () => {
  assert.equal(perPerson({ name: "Whole boat", price: 400, per: "/boat", perGuest: true }), true);
  assert.equal(perPerson({ name: "Tasting", price: 25, per: "/person", perGuest: false }), false);
});

test("a unit nobody stated is still read from the words", () => {
  // "each" is what Resova writes for a per-person price, and 17 options in the catalog carry it.
  assert.equal(perPerson({ name: "Escape room", detail: "60 minutes", per: "each", price: 32 }), true);
  assert.equal(perPerson({ name: "Adult ticket", price: 20 }), true);
  assert.equal(perPerson({ name: "Pontoon rental", detail: "4 hour rental", price: 350 }), false);
});
