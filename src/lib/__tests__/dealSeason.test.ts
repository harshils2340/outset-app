import { strict as assert } from "node:assert";
import { test } from "node:test";
import { monthsStated, runsInMonth } from "../dealSeason.ts";
import { currentDeals, todaysDeals } from "../companyAgent.ts";
import type { Unclaimed } from "../../data/types.ts";

/**
 * Deals that date themselves. Every sentence here is a shipped one or a near neighbour of one: on 25 September
 * 2026 the catalog was advertising "$5 off regular priced tickets" that the shop's own sentence limits to July
 * and August, and "50% off bay cruises" it limits to the summer.
 */

const shop = (promos: NonNullable<Unclaimed["promos"]>): Unclaimed =>
  ({
    id: "o-test",
    title: "Test Charters",
    area: "Sarasota, FL",
    metro: "tampa",
    includes: [],
    promos,
  }) as unknown as Unclaimed;

const promo = (text: string, days: number[] = []) => ({ text, days, detail: text, title: "Deal" });

test("a range of months is read from end to end, wrapping past December", () => {
  assert.deepEqual(monthsStated("20% off every Wednesday from May 1 through September 1."), [4, 5, 6, 7, 8]);
  assert.deepEqual(monthsStated("Winter special: 30% off weekday rentals December through February."), [0, 1, 11]);
  assert.deepEqual(monthsStated("Nov thru Mar: 15% off midweek rentals."), [0, 1, 2, 10, 11]);
  // The dash a shop's own page uses is usually the long one, which the app's own copy rule forbids us writing.
  assert.deepEqual(monthsStated("Half-price Tuesdays, June – August."), [5, 6, 7]);
  assert.deepEqual(monthsStated("Half-price Tuesdays, June — August."), [5, 6, 7]);
});

test("a list of months the sentence names as the window", () => {
  assert.deepEqual(monthsStated("$5 off tickets every Monday during the months of July and August."), [6, 7]);
  assert.deepEqual(monthsStated("Half price tickets on Tuesdays in June and July."), [5, 6]);
  assert.deepEqual(monthsStated("Valid during the month of August only."), [7]);
});

test("a season the offer claims for itself", () => {
  assert.deepEqual(monthsStated("Enjoy 50% off bay cruises every Monday this summer."), [5, 6, 7]);
  assert.deepEqual(monthsStated("20% off rentals Tuesday to Thursday this fall."), [8, 9, 10]);
});

test("an offer that names no window runs all year", () => {
  assert.equal(monthsStated("30% Off Cabin and Boat Rentals Sunday - Wednesday."), null);
  assert.equal(monthsStated("Kids (15 and under) fish for free with each paid adult, weekdays only."), null);
  // A season in the offer's name is branding, not a window, and "may" is usually the ordinary word.
  assert.equal(monthsStated("Summer Splash: $10 off jet skis on Mondays."), null);
  assert.equal(monthsStated("Prices may vary by season."), null);
  assert.equal(monthsStated("Mayo tours to the lighthouse, 10% off Fridays."), null);
  // A deadline to book by is not the window the offer runs in.
  assert.equal(monthsStated("Book by June 1 and save 20%."), null);
});

test("runsInMonth needs one of the lines that name a window to name this month", () => {
  assert.equal(runsInMonth(["10% off Tuesdays"], 8), true);
  assert.equal(runsInMonth(["$5 off during the months of July and August", undefined], 8), false);
  assert.equal(runsInMonth(["$5 off during the months of July and August"], 6), true);
});

test("the listing stops advertising an offer whose own months have passed", () => {
  const item = shop([
    promo("Monday Morning Madness - $5 off regular priced tickets every Monday Morning during the months of July and August.", [1]),
    promo("30% off cabin and boat rentals Sunday to Wednesday.", [0, 1, 2, 3]),
  ]);
  const september = new Date("2026-09-21T15:00:00Z");
  assert.deepEqual(currentDeals(item, september).map((p) => p.days), [[0, 1, 2, 3]]);
  // Monday 21 September: the day is right, the month is not, so it is not today's deal either.
  assert.deepEqual(todaysDeals(item, september).map((p) => p.days), [[0, 1, 2, 3]]);
});

test("the same offer is back when its months come round again", () => {
  const item = shop([promo("$5 off regular priced tickets every Monday during the months of July and August.", [1])]);
  const july = new Date("2026-07-20T15:00:00Z");
  assert.equal(currentDeals(item, july).length, 1);
  assert.equal(todaysDeals(item, july).length, 1);
});

test("an offer with no stated months is untouched", () => {
  const item = shop([promo("Half price on tickets on Tuesdays.", [2])]);
  assert.equal(currentDeals(item, new Date("2026-09-21T15:00:00Z")).length, 1);
});
