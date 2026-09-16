import { test } from "node:test";
import assert from "node:assert/strict";
import { compactDeal } from "../contacts.ts";

/**
 * Two published cards read "4th hour free on boat rentals, Monday to" and "30% off cabin and boat rentals,
 * Sunday to": the 48-character cut already stopped on a whole word, but a connector left dangling at the very
 * end still reads as an unfinished sentence, not a short one.
 */
test("a cut that lands on a connector drops it, not just the next word", () => {
  assert.equal(
    compactDeal([{ text: "Book any boat rental Monday through Thursday and get your 4th hour FREE when you book 3 hours.", title: "4th hour free on boat rentals, Monday to Thursday", days: [1, 2, 3, 4] }]),
    "1,2,3,4|4th hour free on boat rentals, Monday",
  );
  assert.equal(
    compactDeal([{ text: "30% off cabin and boat rentals, Sunday to Tuesday.", days: [0, 1, 2] }]),
    "0,1,2|30% off cabin and boat rentals, Sunday",
  );
});

test("a title that already fits is untouched", () => {
  assert.equal(compactDeal([{ text: "Half-price Tuesdays", title: "Half-price Tuesdays", days: [2] }]), "2|Half-price Tuesdays");
});

test("no day-specific promo is no deal", () => {
  assert.equal(compactDeal([]), undefined);
  assert.equal(compactDeal([{ text: "10% off every day", days: [] }]), undefined);
});
