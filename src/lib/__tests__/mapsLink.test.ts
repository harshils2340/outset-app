import assert from "node:assert/strict";
import test from "node:test";

import type { Unclaimed } from "../../data/types";
import { mapsHref, mapsQuery, mapsSearchQuery, venueMapsQuery } from "../catalog";

/**
 * "Open in Maps" on the desktop listing page and the desktop confirmation, and the "Directions" row on the
 * phone sheet. Every contact below is a real one from public/o, named by the listing it came from.
 *
 * The two surfaces read the same shop and used to build different queries: the phone kept the business name
 * when the shop published no street, the desktop dropped it and searched for the town on its own.
 */

const item = (title: string, area: string) => ({ title, area }) as Unclaimed;

test("a shop with a street is searched by its address, on both surfaces", () => {
  const c = { domain: "10pinchicago.com", street: "330 North State Street", city: "Chicago", region: "IL", postal: "60654" };
  assert.equal(mapsSearchQuery(c, "10pin Bowling Lounge Chicago, IL"), "330 North State Street, Chicago, IL, 60654"); // o-10pinchicago-com
  assert.equal(mapsQuery(item("10pin Bowling Lounge", "Chicago, IL"), c), "330 North State Street, Chicago, IL, 60654");
});

test("a shop with a town but no street keeps its own name in the query", () => {
  // o-12knots-com: the page prints "St. Petersburg, FL" and the link used to search for exactly that.
  const c = { domain: "12knots.com", city: "St. Petersburg", region: "FL" };
  assert.equal(mapsSearchQuery(c, "12 Knots St. Petersburg, FL"), "12 Knots St. Petersburg, FL");
  assert.equal(mapsQuery(item("12 Knots", "St. Petersburg, FL"), c), "12 Knots, St. Petersburg, FL");
});

test("a shop that published only its state no longer sends the guest to the middle of it", () => {
  // o-1515lincolngallery-com and 1,209 others: "Get directions" opened a search for "OK".
  const c = { domain: "1515lincolngallery.com", region: "OK" };
  assert.equal(mapsSearchQuery(c, "1515 Lincoln Gallery OK"), "1515 Lincoln Gallery OK");
  assert.ok(!mapsHref(c, "1515 Lincoln Gallery OK").endsWith("query=OK"));
});

test("a street the crawl stored that is not one takes the same branch as no street at all", () => {
  // streetOf refuses a house number with no road on it, so what is left is the town again.
  const c = { domain: "20thcenturytech.com", street: "3615", city: "Wharton", region: "TX" }; // o-20thcenturytech-com
  assert.equal(mapsSearchQuery(c, "20th Century Technology Museum Wharton, TX"), "20th Century Technology Museum Wharton, TX");
});

test("with no name to fall back on the address line still stands", () => {
  const c = { domain: "12knots.com", city: "St. Petersburg", region: "FL" };
  assert.equal(mapsSearchQuery(c, "   "), "St. Petersburg, FL");
});

test("a chain's other venues are searched by street, then by name and town, then by their pin", () => {
  assert.equal(venueMapsQuery({ street: "5 Court Street", city: "Boston" }, "Boda Borg"), "5 Court Street, Boston");
  // A street the crawl stored with its town already on it is not given a second one.
  assert.equal(venueMapsQuery({ street: "5 Court Street, Boston", city: "Boston" }, "Boda Borg"), "5 Court Street, Boston");
  // o-bondsescaperoom-com: the only shipped venue row with a town and no street. It searched for "Arlington".
  assert.equal(venueMapsQuery({ city: "Arlington", lat: 38.88, lon: -77.09 }, "Bond's Escape Room"), "Bond's Escape Room, Arlington");
  // A venue the crawl found as a bare pin has no town to put a name beside, so the pin is the answer.
  assert.equal(venueMapsQuery({ lat: 38.88, lon: -77.09 }, "Bond's Escape Room"), "38.88,-77.09");
  // And a row with neither searched for "null,null".
  assert.equal(venueMapsQuery({}, "Bond's Escape Room"), "Bond's Escape Room");
});
