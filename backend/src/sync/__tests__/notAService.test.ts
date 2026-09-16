import { test } from "node:test";
import assert from "node:assert/strict";
import { NOT_A_SERVICE } from "../contacts.ts";

/**
 * 1,484 published listings, a boat charter and a pool club among them, showed a card's "from" price off a
 * membership or a season pass, because `options` (the row a card's cheapest price is read from) kept every
 * menu line, while `services` (the row the listing page books from) already dropped these with the same
 * regex. A guest saw "From $10" on a charter whose real trips had no price at all, quoted by a $10 membership
 * tier nobody could book a slot for. Both rows filter on the same NOT_A_SERVICE test now.
 */
test("a membership, a season pass or a gift card is never a bookable option", () => {
  for (const name of [
    "Blue Water Club Membership - Tier 2",
    "Annual Membership",
    "Lifetime Membership",
    "ASPA Membership",
    "Season Pass",
    "Gift Card",
    "Gift Certificate",
    "Pay Parking Tickets Online",
  ]) {
    assert.equal(NOT_A_SERVICE.test(name), true, name + " should not be a bookable option");
  }
});

test("a real experience with a price is left alone", () => {
  for (const name of ["Vera Lee Private Charter", "Two Hour Kayak Rental", "Sunset Sailing Cruise", "Private Pilot License"]) {
    assert.equal(NOT_A_SERVICE.test(name), false, name + " should stay bookable");
  }
});
