import { test } from "node:test";
import assert from "node:assert/strict";
import { dropPlaceholderPins } from "../placeholderPins.ts";

/**
 * 33 shipped listings sat at 46.423669, -129.942709, open Pacific 500 km west of Vancouver Island: Boston
 * Charter Boat in Boston, Italiana Tours in Dallas, Playin Hooky Water Taxi at the Lake of the Ozarks, Na Pali
 * Coast Hanalei Tours on Kauai. A site builder's theme ships a geo block nobody filled in and the crawl read
 * it as an address. A shop pinned in the ocean drops out of near me, out of the distance sort, out of the
 * rail and out of the concierge, while its own page prints the town it is really in.
 */
const at = (area: string, lat?: number, lon?: number) => ({ id: "o-" + area.toLowerCase().replace(/\W+/g, "-"), area, lat, lon }) as Record<string, unknown>;
const PLACEHOLDER: [number, number] = [46.423669, -129.9427086];

test("a pin several states share to the last decimal is cleared from all of them", () => {
  const items = [at("Boston, MA", ...PLACEHOLDER), at("Dallas, TX", ...PLACEHOLDER), at("Kauai, HI", ...PLACEHOLDER)];
  assert.equal(dropPlaceholderPins(items), 3);
  for (const i of items) {
    assert.equal("lat" in i, false, i.area + " keeps no coordinate that was never its own");
    assert.equal("lon" in i, false);
    assert.ok(i.area, "and keeps its town: the listing is not dropped, the pin is");
  }
});

test("two businesses at one marina keep their pin", () => {
  const items = [at("Sarasota, FL", 27.336, -82.577), at("Sarasota, FL", 27.336, -82.577)];
  assert.equal(dropPlaceholderPins(items), 0, "274 shipped pins are shared and all but one are a real address");
  assert.equal(items[0].lat, 27.336);
});

test("a chain at one address across one state keeps its pin, however many locations", () => {
  const items = Array.from({ length: 12 }, () => at("Orlando, FL", 28.54, -81.38));
  assert.equal(dropPlaceholderPins(items), 0);
});

test("a pin one listing holds on its own is never a placeholder", () => {
  const items = [at("Boston, MA", ...PLACEHOLDER), at("Dallas, TX", 32.78, -96.8)];
  assert.equal(dropPlaceholderPins(items), 0, "sharing is the whole evidence, so one row is no evidence");
  assert.equal(items[0].lat, PLACEHOLDER[0]);
});

test("a listing with no pin, and one whose area names no region, are left as they are", () => {
  const items = [at("Boston, MA"), at("Somewhere", ...PLACEHOLDER), at("Nowhere", ...PLACEHOLDER)];
  assert.equal(dropPlaceholderPins(items), 0, "two rows with no readable region are not two regions");
  assert.equal(items[1].lat, PLACEHOLDER[0]);
});
