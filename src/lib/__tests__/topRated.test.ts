/**
 * One bar for "top rated", held to the catalog the app ships and to the four surfaces that draw it.
 *
 * The desktop feed card asked for 50 reviews at 4.8; the phone card, the listing page and the phone booking sheet
 * all asked for 100. So 758 shipped listings had a card shouting "Top rated" that opened a page with no such
 * badge, and a phone card for the same business with no badge at all, which is exactly what the phone card's own
 * comment says must never happen.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { TOP_RATED_RATING, TOP_RATED_REVIEWS, topRated } from "../catalog";
import type { Unclaimed } from "../../data/types";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const CATALOG = JSON.parse(read("../../../public/catalog.json")) as { operators: Unclaimed[] };
const item = (rating?: number, reviews?: number) => ({ rating, reviews } as unknown as Unclaimed);

test("the bar is a rating and a count, and both have to be cleared", () => {
  assert.equal(topRated(item(TOP_RATED_RATING, TOP_RATED_REVIEWS)), true);
  assert.equal(topRated(item(TOP_RATED_RATING - 0.1, TOP_RATED_REVIEWS)), false);
  assert.equal(topRated(item(TOP_RATED_RATING, TOP_RATED_REVIEWS - 1)), false);
  assert.equal(topRated(item(5, 10000)), true);
});

test("a listing with no published rating is not top rated", () => {
  assert.equal(topRated(item(undefined, undefined)), false);
  assert.equal(topRated(item(5, 0)), false);
  assert.equal(topRated(item(undefined, 400)), false);
});

test("the band the two surfaces used to disagree over is settled one way", () => {
  // The desktop card's old bar: 4.8 and 50. Every listing in the gap now answers the same on both cards.
  const gap = CATALOG.operators.filter((u) => (u.rating ?? 0) >= 4.8 && (u.reviews ?? 0) >= 50 && (u.reviews ?? 0) < 100);
  assert.ok(gap.length > 500, "expected the shipped gap to be large, got " + gap.length);
  for (const u of gap) assert.equal(topRated(u), false, u.id + " is in the old desktop-only band");
});

test("the listings that clear the bar are the ones every surface will badge", () => {
  const top = CATALOG.operators.filter((u) => topRated(u));
  assert.ok(top.length > 1000, "expected a real population, got " + top.length);
  for (const u of top) {
    assert.ok((u.rating ?? 0) >= TOP_RATED_RATING && (u.reviews ?? 0) >= TOP_RATED_REVIEWS, u.id);
  }
});

test("no surface carries a bar of its own any more", () => {
  const surfaces: [string, string][] = [
    ["the desktop feed card", read("../../components/web/WebHome.tsx")],
    ["the phone feed card", read("../../components/explore/UnclaimedCard.tsx")],
    ["the desktop listing page", read("../../components/web/WebListing.tsx")],
    ["the phone listing sheet", read("../../components/booking/Sheets.tsx")],
  ];
  for (const [what, src] of surfaces) {
    assert.doesNotMatch(src, /rating >= 4\.8/, what + " still keeps its own rating bar");
    assert.doesNotMatch(src, /reviews >= (?:50|100)\b/, what + " still keeps its own review count bar");
    assert.match(src, /topRated|isTopRated/, what + " does not read the shared bar");
  }
});
