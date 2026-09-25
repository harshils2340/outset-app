import { strict as assert } from "node:assert";
import { test } from "node:test";
import { consolidateDeals } from "../dealText.ts";

/**
 * The sync's half of the same rule: an offer that dates itself is not published outside the months it names.
 * A past holiday was already dropped here; a stated season was not, so "during the months of July and August"
 * was published as an ordinary weekly offer and stayed on the page all year.
 */

const SEPTEMBER = new Date("2026-09-25T12:00:00Z");
const JULY = new Date("2026-07-25T12:00:00Z");

test("an offer limited to months that have passed is not published", () => {
  const promos = [{ text: "Monday Morning Madness - $5 off regular priced tickets every Monday Morning for the 9:30 cruise only during the months of July and August.", days: [] }];
  assert.deepEqual(consolidateDeals(promos, SEPTEMBER), []);
  const july = consolidateDeals(promos, JULY);
  assert.equal(july.length, 1);
  assert.equal(july[0].title, "$5 off regular priced tickets on Mondays");
});

test("a season the offer claims for itself is read the same way", () => {
  const promos = [{ text: "Enjoy 50% off bay cruises every Monday this summer using promo code BAYDAY50.", days: [] }];
  assert.deepEqual(consolidateDeals(promos, SEPTEMBER), []);
  assert.equal(consolidateDeals(promos, JULY).length, 1);
});

test("a winter offer is off in September and back in December", () => {
  const promos = [{ text: "30% off weekday rentals December through February.", days: [] }];
  assert.deepEqual(consolidateDeals(promos, SEPTEMBER), []);
  assert.equal(consolidateDeals(promos, new Date("2026-12-10T12:00:00Z")).length, 1);
});

test("an offer that names no months is published all year, as almost all of them are", () => {
  const promos = [{ text: "30% Off Cabin and Boat Rentals Sunday - Wednesday.", days: [] }];
  assert.equal(consolidateDeals(promos, SEPTEMBER).length, 1);
  assert.equal(consolidateDeals(promos, JULY).length, 1);
});

test("a terms line that names a month cannot retire the offer it was joined to", () => {
  // The benefit is stated with no window; only the joined condition mentions July, and it is not the offer's own.
  const promos = [
    { text: "10% off all rentals on Tuesdays.", days: [] },
    { text: "Valid with each paid adult. Rates last changed in July and August of last year.", days: [2] },
  ];
  const out = consolidateDeals(promos, SEPTEMBER);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "10% off all rentals on Tuesdays");
});
