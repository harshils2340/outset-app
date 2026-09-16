import assert from "node:assert/strict";
import test from "node:test";
import { fmtDistance } from "../places";

/**
 * The distance on a card, a listing page's venue tile and the "where" line.
 *
 * Each band was picked from the raw number and then rounded, so the rounding could push the answer out of
 * the band that chose it: a shop 999.6 m away read "1000 m away" instead of "1.0 km", and one 9.96 km away
 * read "10.0 km" where every other distance of ten or more reads "10 km".
 */

test("metres under a kilometre, to the nearest ten", () => {
  assert.equal(fmtDistance(0.05), "50 m");
  assert.equal(fmtDistance(0.4), "400 m");
  assert.equal(fmtDistance(0.94), "940 m");
});

test("a distance that rounds up to a kilometre is shown as one, not as 1000 m", () => {
  assert.equal(fmtDistance(0.995), "1.0 km");
  assert.equal(fmtDistance(0.9996), "1.0 km");
  assert.equal(fmtDistance(0.99999), "1.0 km");
  assert.equal(fmtDistance(0.9949), "990 m", "and one that rounds down stays in metres");
});

test("one decimal under ten kilometres, whole numbers above, and no 10.0 km in between", () => {
  assert.equal(fmtDistance(1), "1.0 km");
  assert.equal(fmtDistance(2.14), "2.1 km");
  assert.equal(fmtDistance(9.94), "9.9 km");
  assert.equal(fmtDistance(9.96), "10 km");
  assert.equal(fmtDistance(10), "10 km");
  assert.equal(fmtDistance(12.4), "12 km");
  assert.equal(fmtDistance(3337), "3337 km");
});

test("a guest standing on the doorstep gets the ten metre floor rather than 0 m", () => {
  assert.equal(fmtDistance(0), "10 m");
  assert.equal(fmtDistance(0.004), "10 m");
});
