import { strict as assert } from "node:assert";
import { test } from "node:test";
import { liteDealTitle } from "../deals.ts";

/**
 * The deal line a card draws before the detail file lands. The sync cuts the title on a whole word at 48
 * characters and marks what it cut; the card used to cut again at 40, a cap the sync does not use, so a badge
 * that had arrived whole was shortened and given an ellipsis it had not earned. Three of the twelve shipped
 * badges on 25 September 2026 were in that band, and one of them lost a day the shop is offering.
 */

test("a title the sync published whole is drawn whole", () => {
  assert.equal(liteDealTitle("1,2|$25 off your rental on Mondays and Tuesdays"), "$25 off your rental on Mondays and Tuesdays");
  assert.equal(liteDealTitle("2|20% off general admission tickets on Tuesdays"), "20% off general admission tickets on Tuesdays");
  assert.equal(liteDealTitle("0|Buy one, get one: e-bike rentals on Sundays"), "Buy one, get one: e-bike rentals on Sundays");
  assert.equal(liteDealTitle("2|Half-price Tuesdays"), "Half-price Tuesdays");
});

test("a title the sync cut keeps the mark the sync put on it", () => {
  assert.equal(liteDealTitle("1,2,3,4|4th hour free on boat rentals, Monday…"), "4th hour free on boat rentals, Monday…");
});

test("nothing to draw", () => {
  assert.equal(liteDealTitle(undefined), null);
  assert.equal(liteDealTitle(""), null);
  // A record with no pipe is not a deal line, and a pipe with nothing after it is not a title.
  assert.equal(liteDealTitle("Half-price Tuesdays"), null);
  assert.equal(liteDealTitle("2|"), null);
  assert.equal(liteDealTitle("2|   "), null);
});
