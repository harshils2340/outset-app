import assert from "node:assert/strict";
import test from "node:test";
import { dropBorrowedTowns } from "../borrowedTowns.ts";

const at = (area: string, lat: number, lon: number, extra: Record<string, unknown> = {}) =>
  ({ id: "o-" + area.toLowerCase().replace(/\W+/g, "-"), area, lat, lon, ...extra }) as Record<string, unknown>;

test("a metro's name beside a state it is not in loses the town and keeps the state", () => {
  // Bethesda, Maryland: 12 km from the Washington DC pin, and Washington DC is not in Maryland.
  const items = [at("Washington DC, MD", 38.98, -77.1), at("New York, NJ", 40.83, -74.03), at("Detroit, ON", 42.32, -83.04)];
  assert.equal(dropBorrowedTowns(items), 3);
  assert.deepEqual(items.map((i) => i.area), ["MD", "NJ", "ON"]);
  for (const i of items) assert.equal(typeof i.lat, "number", "the pin is a fact and is not touched");
});

test("a real town that shares a metro's name, far from that metro, keeps it", () => {
  // Portland, Maine is 4,000 km from the Portland metro, so its town was read rather than borrowed.
  const items = [at("Portland, ME", 43.66, -70.26), at("Charleston, WV", 38.35, -81.63), at("Waterloo, IA", 42.49, -92.34), at("Vancouver, WA", 45.63, -122.67)];
  assert.equal(dropBorrowedTowns(items), 0);
  assert.deepEqual(items.map((i) => i.area), ["Portland, ME", "Charleston, WV", "Waterloo, IA", "Vancouver, WA"]);
});

test("a town that agrees with its state, a town no metro is named after, and a bare state code are all left alone", () => {
  const items = [at("Tampa Bay, FL", 27.95, -82.46), at("Clearwater Beach, FL", 27.98, -82.83), at("Bethesda, MD", 38.98, -77.1), { id: "o-bare", area: "MD", lat: 38.98, lon: -77.1 }];
  assert.equal(dropBorrowedTowns(items), 0);
  assert.deepEqual(items.map((i) => i.area), ["Tampa Bay, FL", "Clearwater Beach, FL", "Bethesda, MD", "MD"]);
});

test("a listing with no pin is left alone: nothing says the name was borrowed rather than read", () => {
  const items = [{ id: "o-nopin", area: "Washington DC, MD" }];
  assert.equal(dropBorrowedTowns(items), 0);
  assert.equal(items[0].area, "Washington DC, MD");
});

test("an operator's own claimed listing keeps the area they typed", () => {
  const items = [at("Washington DC, MD", 38.98, -77.1, { claimed: true })];
  assert.equal(dropBorrowedTowns(items), 0);
  assert.equal(items[0].area, "Washington DC, MD");
});

test("the state the town loses is still the one every reader gets back out of the area line", async () => {
  const { regionOfArea, countryOfArea } = await import("../../../../src/data/regions.ts");
  const items = [at("Washington DC, MD", 38.98, -77.1), at("Detroit, ON", 42.32, -83.04)];
  dropBorrowedTowns(items);
  assert.equal(regionOfArea(String(items[0].area)), "MD");
  assert.equal(countryOfArea(String(items[0].area)), "US");
  assert.equal(regionOfArea(String(items[1].area)), "ON");
  assert.equal(countryOfArea(String(items[1].area)), "CA");
});
