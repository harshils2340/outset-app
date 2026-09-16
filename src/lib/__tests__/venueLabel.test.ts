import assert from "node:assert/strict";
import test from "node:test";
import { nearestLocation, venueLabel } from "../places";

/**
 * "Nearby" was a town.
 *
 * `npm run sync` wrote `city: l.city || "Nearby"` for a chain's other venues, so every venue whose own town
 * the crawl never found shipped as a place called Nearby. That made it the commonest town in `catalog.json`
 * by three to one: 64 venues on 24 listings, against 11 for Orlando. The app read it as a town, so Trapped
 * of Vancouver offered a venue called "Nearby · 3,337 km away", and the listing page's map link went looking
 * for a town called Nearby.
 *
 * The sync stops writing it (`backend/src/sync/contacts.ts`), and the guest side stops believing the ones
 * already shipped, which stay in `catalog.json` until a sync runs on Render.
 */

// Trapped, Vancouver BC: a real Toronto address whose town the crawl never read. From public/catalog.json.
const TRAPPED = {
  area: "Vancouver, BC",
  lat: 49.2814215,
  lon: -123.0224692,
  locations: [{ city: "Nearby", lat: 43.5316, lon: -79.6728, street: "2273 Dundas Street West" }],
};
const TORONTO = { lat: 43.6532, lon: -79.3832 };

test("a town the crawl really read is used, with its region", () => {
  assert.equal(venueLabel({ city: "Kitchener", region: "ON" }), "Kitchener, ON");
  assert.equal(venueLabel({ city: "Orlando" }), "Orlando");
});

test("the shipped placeholder is not a town, whether or not the venue has a street", () => {
  assert.equal(venueLabel({ city: "Nearby", street: "2273 Dundas Street West" }), "2273 Dundas Street West");
  assert.equal(venueLabel({ city: "Nearby", region: "ON" }), "", "and it does not become “Nearby, ON” either");
  assert.equal(venueLabel({ city: "Nearby" }), "");
});

test("a venue with no town at all falls back to its street, then to no name", () => {
  assert.equal(venueLabel({ street: "419 King Street" }), "419 King Street");
  assert.equal(venueLabel({}), "");
  assert.equal(venueLabel({ city: "   ", street: "  " }), "");
});

test("the nearest venue of a real chain is named by its street, not by the placeholder", () => {
  const n = nearestLocation(TRAPPED, TORONTO);
  assert.ok(n);
  assert.equal(n.alt, true, "the Toronto venue beats the Vancouver pin");
  assert.equal(n.label, "2273 Dundas Street West");
  assert.notEqual(n.label, "Nearby");
  assert.ok(n.km < 40, "and it really is the near one, not the Vancouver pin 3,300 km away");
});

test("a bare pin is measured but not named, so a card can show the distance alone", () => {
  const n = nearestLocation({ area: "Calgary, AB", lat: 51.05, lon: -114.07, locations: [{ city: "Nearby", lat: 43.65, lon: -79.38 }] }, TORONTO);
  assert.ok(n);
  assert.equal(n.label, "");
  assert.ok(n.km < 5);
});

test("the operator's own pin keeps its own area as the label", () => {
  const n = nearestLocation(TRAPPED, { lat: 49.28, lon: -123.02 });
  assert.ok(n);
  assert.equal(n.label, "Vancouver, BC");
  assert.equal(n.alt, false);
});
