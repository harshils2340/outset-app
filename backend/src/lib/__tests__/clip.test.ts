import assert from "node:assert/strict";
import test from "node:test";

import { clip } from "../clip.ts";

/**
 * Cutting a shop's prose to a budget. Every case below is a real one from the shipped catalog or from a
 * vendor fixture, named where it came from.
 */

test("text already inside the budget comes back whole, last word and all", () => {
  // The Peek reader chopped "Rentals" off Dogpatch Paddle's own 53-character line, because the cut it used
  // ran unconditionally: `slice(0, 700).replace(/\s+\S*$/, "")` eats the last word of every short string.
  assert.equal(clip("Beginner, Youth, Performance, and Dog Friendly Rentals", 700), "Beginner, Youth, Performance, and Dog Friendly Rentals");
  assert.equal(clip("Meet at the dock.", 400), "Meet at the dock.");
  assert.equal(clip("", 400), "");
});

test("a sentence end late in the budget is a real ending and needs no mark", () => {
  const text = "Please arrive twenty minutes early. Parking is limited and fills up on weekends, so leave time for it.";
  assert.equal(clip(text, 40), "Please arrive twenty minutes early.");
});

test("with no sentence to stop at, the cut backs up to a word and says the text goes on", () => {
  // o-1000islandexcursions-com shipped "...book another trip of equal or greater valu".
  const text = "If we cancel for weather 1000 Islands Excursions is able to book another trip of equal or greater value";
  const out = clip(text, 95);
  assert.equal(/valu$/.test(out), false, "the cut still lands inside a word");
  assert.equal(out.endsWith("…"), true);
  assert.equal(out, "If we cancel for weather 1000 Islands Excursions is able to book another trip of equal or…");
});

test("a comma left hanging by the cut comes off with it", () => {
  // o-extremearizona-com shipped "...charged for damages, recovery, downtime, cleaning,".
  const out = clip("Your credit card will be charged for damages, recovery, downtime, cleaning, and fuel", 75);
  assert.equal(out, "Your credit card will be charged for damages, recovery, downtime…");
});

test("one word longer than the whole budget has no boundary to back up to", () => {
  const out = clip("https://example.com/" + "a".repeat(80), 40);
  assert.equal(out.length <= 41, true);
  assert.equal(out.endsWith("…"), true);
});

test("the budget is never exceeded", () => {
  const text = "Guests must sign a waiver before boarding. ".repeat(40);
  for (const max of [40, 100, 240, 400, 500, 700, 1200]) {
    assert.equal(clip(text, max).length <= max + 1, true, "clip to " + max + " ran over");
  }
});
