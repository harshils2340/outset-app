import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { countryOfArea } from "../../data/regions";
import { fmtDistance, formatDistance } from "../geo";
import { kmBetween } from "../places";

/**
 * The distance on a card, a listing page's venue tile and the "where" line.
 *
 * Two things are pinned here. The units: this printed kilometres to everyone, so the 51,940 American listings
 * in the catalog told a guest in Tampa a shop was "19 km away". And the bands, each picked from the rounded
 * number rather than the raw one, or the rounding pushes the answer out of the band that chose it: a shop
 * 999.6 m away read "1000 m away" instead of "1.0 km", and one 9.96 km away read "10.0 km" where every other
 * distance of ten or more reads "10 km".
 */

const listing = (id: string) =>
  JSON.parse(readFileSync(new URL("../../../public/o/" + id + ".json", import.meta.url), "utf8")) as {
    area: string;
    lat: number;
    lon: number;
  };

/* ---------- the country decides the unit ---------- */

test("an American listing is miles, to a guest standing in that city", () => {
  // 10pin Bowling Lounge, Chicago, 1.16 km from the pin the metro list keeps for downtown Chicago.
  const shop = listing("o-10pinchicago-com");
  assert.equal(countryOfArea(shop.area), "US", "o-10pinchicago-com moved country, so this case needs a new listing");
  const km = kmBetween({ lat: 41.8781, lon: -87.6298 }, { lat: shop.lat, lon: shop.lon });
  assert.equal(fmtDistance(km, countryOfArea(shop.area)), "0.7 mi");
});

test("a Canadian listing is still metric", () => {
  // Alder Alley Brewing, 53.2 km from downtown Vancouver.
  const shop = listing("o-alderalley-com");
  assert.equal(countryOfArea(shop.area), "CA", "o-alderalley-com moved country, so this case needs a new listing");
  const km = kmBetween({ lat: 49.2827, lon: -123.1207 }, { lat: shop.lat, lon: shop.lon });
  assert.equal(fmtDistance(km, countryOfArea(shop.area)), "53 km");
});

test("the same kilometres read two ways, by the country the shop sits in", () => {
  assert.equal(fmtDistance(19, "US"), "12 mi");
  assert.equal(fmtDistance(19, "CA"), "19 km");
  assert.equal(fmtDistance(2.14, "US"), "1.3 mi");
  assert.equal(fmtDistance(2.14, "CA"), "2.1 km");
});

/* ---------- the booking sheet asks the same question and must get the same answer ---------- */

test("the booking sheet and the card agree, mile for mile", () => {
  // `formatDistance` takes miles, `fmtDistance` kilometres, and they used to be two separate rules: a card
  // said "19 km away" and the sheet that opened from it said "12 mi away" about the same shop.
  for (const miles of [0.1, 0.25, 0.4, 1, 2.5, 9.94, 9.96, 12, 33.1, 150]) {
    for (const country of ["US", "CA"] as const) {
      assert.equal(
        formatDistance(miles, country),
        fmtDistance(miles * 1.60934, country),
        miles + " mi in " + country,
      );
    }
  }
});

/* ---------- the imperial bands ---------- */

test("a third of a mile or less is Nearby, not a fraction", () => {
  assert.equal(fmtDistance(0, "US"), "Nearby");
  assert.equal(fmtDistance(0.3, "US"), "Nearby", "190 m");
  assert.equal(fmtDistance(0.4, "US"), "Nearby", "0.25 mi, which rounds to 0.2");
  assert.equal(fmtDistance(0.45, "US"), "0.3 mi", "0.28 mi rounds up into the band, so it is shown");
});

test("one decimal under ten miles, whole numbers above, and no 10.0 mi in between", () => {
  assert.equal(fmtDistance(1.60934, "US"), "1.0 mi");
  assert.equal(fmtDistance(15.99, "US"), "9.9 mi");
  assert.equal(fmtDistance(16.04, "US"), "10 mi");
  assert.equal(fmtDistance(1609.34, "US"), "1000 mi");
});

/* ---------- the metric bands, unchanged ---------- */

test("metres under a kilometre, to the nearest ten", () => {
  assert.equal(fmtDistance(0.05, "CA"), "50 m");
  assert.equal(fmtDistance(0.4, "CA"), "400 m");
  assert.equal(fmtDistance(0.94, "CA"), "940 m");
});

test("a distance that rounds up to a kilometre is shown as one, not as 1000 m", () => {
  assert.equal(fmtDistance(0.995, "CA"), "1.0 km");
  assert.equal(fmtDistance(0.9996, "CA"), "1.0 km");
  assert.equal(fmtDistance(0.99999, "CA"), "1.0 km");
  assert.equal(fmtDistance(0.9949, "CA"), "990 m", "and one that rounds down stays in metres");
});

test("one decimal under ten kilometres, whole numbers above, and no 10.0 km in between", () => {
  assert.equal(fmtDistance(1, "CA"), "1.0 km");
  assert.equal(fmtDistance(2.14, "CA"), "2.1 km");
  assert.equal(fmtDistance(9.94, "CA"), "9.9 km");
  assert.equal(fmtDistance(9.96, "CA"), "10 km");
  assert.equal(fmtDistance(10, "CA"), "10 km");
  assert.equal(fmtDistance(12.4, "CA"), "12 km");
  assert.equal(fmtDistance(3337, "CA"), "3337 km");
});

test("a guest standing on the doorstep gets the ten metre floor rather than 0 m", () => {
  assert.equal(fmtDistance(0, "CA"), "10 m");
  assert.equal(fmtDistance(0.004, "CA"), "10 m");
});

/* ---------- which country a listing is in ---------- */

test("the country comes off the area line, and an unreadable one is American", () => {
  assert.equal(countryOfArea("Tampa, FL"), "US");
  assert.equal(countryOfArea("Kelowna, BC"), "CA");
  assert.equal(countryOfArea("SK"), "CA", "an operator whose town was never read publishes the code alone");
  assert.equal(countryOfArea("Mt, NJ"), "US", "the town is never read as a code");
  assert.equal(countryOfArea(""), "US");
  assert.equal(countryOfArea(undefined), "US");
});
