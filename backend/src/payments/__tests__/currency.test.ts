import { test } from "node:test";
import assert from "node:assert/strict";
import { currencyForArea } from "../money.ts";

/**
 * Which country's dollars a booking is charged, emailed and paid out in.
 *
 * The province was read with a regex that wanted a comma in front of the code and the end of the string
 * behind it. An operator whose town the crawl never found publishes its area as the code alone ("ON"), which
 * is 1,030 Canadian rows in the shipped catalog, and every one of them missed and took the fallback, which is
 * US dollars. A Toronto booking had its payment intent raised in usd, its guest and operator emails read
 * "$185.00 USD" where they should have read "CA$185.00", and the Connect account the payouts page offered was
 * a US one.
 */

test("a listing is priced in its own country's dollars", () => {
  assert.equal(currencyForArea("Tobermory, ON"), "cad");
  assert.equal(currencyForArea("Tampa, FL"), "usd");
  assert.equal(currencyForArea("Whistler, BC"), "cad");
  assert.equal(currencyForArea("St John's, NL"), "cad");
});

test("the province is read even when the area is only the province", () => {
  assert.equal(currencyForArea("ON"), "cad");
  assert.equal(currencyForArea("BC"), "cad");
  assert.equal(currencyForArea("SK"), "cad");
  assert.equal(currencyForArea("YT"), "cad");
  assert.equal(currencyForArea("NC"), "usd");
  assert.equal(currencyForArea("OH"), "usd");
});

test("a state that reads like a province is still a state", () => {
  // Ontario, California, and Ontario, Oregon. Neither is in Canada.
  assert.equal(currencyForArea("Ontario, CA"), "usd");
  assert.equal(currencyForArea("Ontario, OR"), "usd");
  // The town is never read, so the catalog's "Mt, NJ" cannot be taken for Montana or anywhere else.
  assert.equal(currencyForArea("Mt, NJ"), "usd");
});

test("an area with no region at all keeps the caller's fallback", () => {
  assert.equal(currencyForArea(undefined), "usd");
  assert.equal(currencyForArea(""), "usd");
  assert.equal(currencyForArea("Somewhere"), "usd");
  assert.equal(currencyForArea("Somewhere", "cad"), "cad");
});
