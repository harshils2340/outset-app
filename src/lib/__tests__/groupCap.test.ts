import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { groupCap } from "../listingDerive";

/**
 * "Up to N guests" on a listing, read from the operator's own group lines. Every line below is a real one from
 * public/o, and each is named by the listing it came from.
 */

test("a thousands separator is part of the number, not the end of it", () => {
  // Nine listings printed "Up to 0 guests", because "3,000 guests" matched the "000" on its end.
  assert.equal(groupCap(["Group events for 10 to 3,000 guests with customizable packages"]), 3000); // o-austinspark-com
  assert.equal(groupCap(["Groups from 15 to 5,000 guests welcome"]), 5000); // o-castlesncoasters-com
  assert.equal(groupCap(["Private picnic grounds accommodate up to 10,000 people"]), 10000); // o-enchantedisland-com
  assert.equal(groupCap(["Corporate events for 25-1500 guests"]), 1500); // o-adventureparkusa-com
});

test("a stated minimum is never printed as the maximum", () => {
  // o-arapahoefc-com read "Up to 2 guests", which sends a family of four away from a flight that takes six.
  assert.equal(groupCap(["Helicopter tours require minimum 2 passengers and have weight restrictions"]), null);
  assert.equal(groupCap(["Minimum 25 people for group visits"]), null); // o-cinezoo-qc-ca
  assert.equal(groupCap(["Private Italian Marketplace Experience requires minimum 50 guests"]), null); // o-bahiahotel-com
  assert.equal(groupCap(["Groups over 20 people can book tournaments with carts, meals, and prizes"]), null); // o-bluedevilgolf-com
});

test("a line naming both gives the ceiling, not the floor", () => {
  assert.equal(groupCap(["Wine Cave & Library Experience minimum 6 guests, maximum 10"]), 10); // o-50thparallel-com
  assert.equal(groupCap(["Minimum 2 passengers and maximum 4 passengers per flight"]), 4); // o-piedmonthotair-com
  assert.equal(groupCap(["Group reservations minimum 8 people, maximum 12 people"]), 12); // o-seastarvineyards-ca
  assert.equal(groupCap(["Ultimate VIP Tour minimum 2 guests, maximum 12 guests"]), 12); // o-seaworld-com
  assert.equal(groupCap(["Each room requires a minimum of 4 people, some games max 12 players"]), 12); // o-thinkitoutescape-com
  assert.equal(groupCap(["Private tours with Sprinter Van for groups of 10 minimum, 13 maximum people"]), 13); // o-popthecorkwinetours-com
});

test("the ordinary lines every other listing carries are unchanged", () => {
  assert.equal(groupCap(["Maximum 6 guests on The Ultimate Boat Day"]), 6); // o-1000islandsprivateboattours-com
  assert.equal(groupCap(["Boat accommodates up to 6 passengers"]), 6); // o-4reel-charters-com
  assert.equal(groupCap(["Baskets hold 2 to 6 passengers plus pilot"]), 6); // o-605balloonride-com
  assert.equal(groupCap(["Electric boat rental seats 12 max, 10 comfortably including infants"]), 12); // o-cruisenewportbeach-com
  assert.equal(groupCap(["Up to 3 people: $650 per 5 hour trip"]), 3); // o-anglersedge-ca
  // "6 or 10 passengers": the count sits beside the second number, and that is the one the page has shown.
  assert.equal(groupCap(["Small airboats seat up to 6 or 10 passengers; large airboats seat up to 30 passengers"]), 10); // o-airboatadventures-com
});

test("a floor word at the far end of a line does not speak for a later count", () => {
  // o-greaterorlandoballoonrides-com: the "from" belongs to the bottom of the range, four words away.
  assert.equal(groupCap(["Balloons range from pilot plus 2 to pilot plus 6 passengers; private balloons available"]), 6);
});

test("nothing stated is an honest gap, and nothing absurd is stated", () => {
  assert.equal(groupCap(undefined), null);
  assert.equal(groupCap([]), null);
  assert.equal(groupCap(["Private events and corporate bookings welcome"]), null);
  assert.equal(groupCap(["0 guests"]), null);
});

test("both listing surfaces read the one helper, so they cannot differ", () => {
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
  for (const [name, src] of [
    ["the phone listing sheet", read("../../components/booking/Sheets.tsx")],
    ["the desktop listing page", read("../../components/web/WebListing.tsx")],
  ] as const) {
    assert.match(src, /groupCap[^\n]*from "\.\.\/\.\.\/lib\/listingDerive"/, name + " imports it");
    assert.doesNotMatch(src, /guests\?\|people\|passengers\|riders\|max/, name + " keeps no copy of the old reader");
  }
});
