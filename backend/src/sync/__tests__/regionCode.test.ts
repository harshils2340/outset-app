import { test } from "node:test";
import assert from "node:assert/strict";

import { regionCode } from "../contacts.ts";

/**
 * Which state a listing is in, as every reader of that fact asks for it: a two-letter code on the end of the
 * area line. 47 operators publish the name spelled out instead, so they shipped as "West Union, Ohio", and
 * `regionOfArea` answers nothing for a name. That costs them the clock their hours are read on, the currency a
 * booking is charged in, the state row a search offers and the page that row opens. Each one below is real.
 */

test("a state or province spelled out becomes the code the app reads", () => {
  assert.equal(regionCode("Ohio"), "OH"); // o-achs-ohio-org, "West Union, Ohio"
  assert.equal(regionCode("Texas"), "TX"); // o-adkinsstoreandstay-com
  assert.equal(regionCode("Oregon"), "OR"); // three listings, and Oregon is not on Eastern time
  assert.equal(regionCode("arizona"), "AZ");
  assert.equal(regionCode(" Florida "), "FL");
});

test("a code is left as it stands, in the case the app uses", () => {
  assert.equal(regionCode("FL"), "FL");
  assert.equal(regionCode("on"), "ON");
  assert.equal(regionCode(null), null);
  assert.equal(regionCode(""), null);
});

test("a region that is neither keeps what the operator published, rather than becoming a guess", () => {
  assert.equal(regionCode("Baja California"), "Baja California");
  assert.equal(regionCode("Ohio Valley"), "Ohio Valley");
});
