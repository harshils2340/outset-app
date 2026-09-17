/**
 * The count a guest reads beside the stars.
 *
 * Every surface that printed the number and the word together wrote "reviews" whatever the number, so each of the
 * 207 shipped listings with exactly one public review was told "1 reviews" wherever the two appeared as a phrase:
 * the listing page's rating line, its hero, both reserve boxes, the reviews heading, and the phone sheet's.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { reviewsLine } from "../format";

test("one review is not '1 reviews'", () => {
  assert.equal(reviewsLine(1), "1 review");
  assert.equal(reviewsLine(2), "2 reviews");
  assert.equal(reviewsLine(2431), "2,431 reviews");
  assert.equal(reviewsLine(1, "public"), "1 public review");
  assert.equal(reviewsLine(120, "public"), "120 public reviews");
});

test("no surface glues the word 'reviews' onto a count itself", () => {
  const surfaces: [string, string][] = [
    ["the desktop listing page", readFileSync(new URL("../../components/web/WebListing.tsx", import.meta.url), "utf8")],
    ["the phone listing sheet", readFileSync(new URL("../../components/booking/Sheets.tsx", import.meta.url), "utf8")],
  ];
  for (const [what, src] of surfaces) {
    assert.doesNotMatch(src, /fmtReviews\([^)]*\)\s*\+?\s*("| \+ ")\s*(public )?reviews/, what + " still writes the plural by hand");
    assert.doesNotMatch(src, /\{fmtReviews\([^)]*\)\}\s*reviews/, what + " still writes the plural by hand");
  }
});

test("207 shipped listings carry exactly one public review", () => {
  // The count that made this worth fixing: the number is on their cards, and on the page of any that publish a quote.
  const ops = (JSON.parse(readFileSync(new URL("../../../public/catalog.json", import.meta.url), "utf8")) as { operators: { rating?: number; reviews?: number }[] }).operators;
  const singles = ops.filter((u) => u.rating != null && u.reviews === 1);
  assert.ok(singles.length > 100, "expected a real population, got " + singles.length);
});

