import assert from "node:assert/strict";
import test from "node:test";
import { placeName } from "../listingDerive";

test("a coded state is spelled out beside the town", () => {
  assert.equal(placeName("Clearwater Beach, FL"), "Clearwater Beach, Florida");
  assert.equal(placeName("Kelowna, BC"), "Kelowna, British Columbia");
});

test("a listing whose town was never read spells out the state on its own", () => {
  // 2,943 shipped listings publish a bare code, and the page heading used to read "Kayak rental in MD".
  assert.equal(placeName("MD"), "Maryland");
  assert.equal(placeName("ON"), "Ontario");
  assert.equal(placeName("NJ"), "New Jersey");
  assert.equal(placeName("nj"), "New Jersey");
});

test("a town that already names its own state is not given it twice", () => {
  assert.equal(placeName("DC"), "Washington, DC");
  assert.equal(placeName("Washington DC, DC"), "Washington DC");
  assert.equal(placeName("Washington DC"), "Washington DC");
  // A town whose last word merely looks like a code keeps its state: nothing ends on a boundary plus the code.
  assert.equal(placeName("New York, NY"), "New York, New York");
  assert.equal(placeName("Washington, WA"), "Washington, Washington");
});

test("a place the table does not know is printed as the shop's own page states it", () => {
  assert.equal(placeName("Clearwater Beach"), "Clearwater Beach");
  assert.equal(placeName("Mt, NJ"), "Mt, New Jersey");
  assert.equal(placeName("ZZ"), "ZZ");
  assert.equal(placeName("Somewhere, ZZ"), "Somewhere, ZZ");
  assert.equal(placeName(""), "");
});
