import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { awayLine, measurableFrom } from "../../components/explore/feed";
import type { Unclaimed } from "../../data/types";

/**
 * Which point a distance may be measured from, and that the listing page asks the same question its cards do.
 *
 * The cards refused a picked state and a partner's product from the day they learned to print a distance. The
 * desktop listing page measured from `state.near` whatever it was, so the page a card opened read "143 miles
 * from Florida" under a card that printed no distance at all, and "2 miles away" for a Viator product whose
 * pin is the centre of its destination and is shared by all 160 products filed under that city.
 */

const shop = (over: Partial<Unclaimed> = {}): Unclaimed =>
  ({ id: "o-x", title: "X", area: "Tampa, FL", lat: 27.95, lon: -82.46, ...over }) as unknown as Unclaimed;
const point = { label: "Near me", sub: "Current location", lat: 27.95, lon: -82.46 };
const florida = { label: "Florida", sub: "US", lat: 28.6, lon: -82.4, region: "FL" };
const partner = { source: "viator", label: "Viator", url: "https://viator.example" };

test("a picked point is measurable", () => {
  assert.equal(measurableFrom(shop(), point), point);
});

test("a picked state or province is one pin in the middle of it, so nothing is measured from it", () => {
  assert.equal(measurableFrom(shop(), florida), null);
  assert.equal(awayLine(shop({ lat: 28.59, lon: -82.39 }), florida), null);
});

test("a partner's product shares its pin with its whole destination, so nothing is measured from it either", () => {
  assert.equal(measurableFrom(shop({ affiliate: partner } as Partial<Unclaimed>), point), null);
});

test("with no place picked at all there is nothing to measure from", () => {
  assert.equal(measurableFrom(shop(), null), null);
});

/**
 * The rule is one function so the two surfaces cannot drift again. This is the guard on that: the listing page
 * must reach for it rather than read `state.near` straight into a distance.
 */
test("the desktop listing page reads the shared rule rather than the raw pick", () => {
  const src = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../../components/web/WebListing.tsx"),
    "utf8",
  );
  assert.ok(src.includes("measurableFrom(item, state.near)"), "the listing page should take its point from measurableFrom");
  assert.ok(!/nearestLocation\(item, state\.near\)/.test(src), "nothing should measure straight from the raw pick");
  assert.ok(!/kmBetween\(state\.near/.test(src), "the venue grid should measure from the same guarded point");
});
