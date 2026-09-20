import assert from "node:assert/strict";
import test from "node:test";
import type { Place } from "../places";
import type { Unclaimed } from "../../data/types";
import { NEAR_RADIUS_KM, atMetro, atPlace, awayLine, kmToPlace } from "../../components/explore/feed";

/**
 * Whether a listing is at the place the guest picked.
 *
 * The desktop home and the phone Explore feed each had their own answer, and they disagreed for the same
 * guest in the same session, because `state.near` is shared and "Open the phone app" is one click away:
 *
 *  - A picked state or province. The desktop holds every listing in it; the phone drew an 80 km circle round
 *    the middle of it. Saskatchewan offers 224 places in the Where box, the desktop showed the province, and
 *    the phone showed the 8 with photos within an hour of a point in a field near Davidson, each card reading
 *    "SK · 16 km away", which is a distance from nothing a guest has heard of.
 *  - A chain. The desktop measures to the nearest of an operator's venues; the phone measured to whichever
 *    pin the catalog leads with. 182 catalog rows carry other venues and 60 of those have one over 50 km from
 *    the lead pin.
 *
 * There is one definition now, in `explore/feed.ts`, and the desktop imports it.
 */

const op = (u: Partial<Unclaimed>): Unclaimed => ({ id: "t", title: "T", cat: "play", art: "kayak", area: "Somewhere", ...u }) as unknown as Unclaimed;
const point = (lat: number, lon: number): Place => ({ label: "Near me", sub: "", lat, lon });
const region = (code: string): Place => ({ label: code, sub: "", lat: 52.9399, lon: -106.4509, region: code });

const TORONTO = point(43.6532, -79.3832);

// Real rows, as they ship in public/catalog.json.
const TRAPPED = op({ area: "Vancouver, BC", lat: 49.2814215, lon: -123.0224692, locations: [{ city: "Nearby", lat: 43.5316, lon: -79.6728, street: "2273 Dundas Street West" }] });
const KITTY_HAWK = op({ area: "Nags Head, NC", lat: 35.9573, lon: -75.6243, locations: [{ city: "Atlantic Beach", lat: 34.6993, lon: -76.7402 }] });

test("a picked state or province holds every listing in it, however far from its middle", () => {
  // Fond du Lac is in the far north of Saskatchewan, 700 km from the point the province row carries.
  const far = op({ area: "Fond-du-Lac, SK", lat: 59.3333, lon: -107.1833 });
  assert.equal(atPlace(far, region("SK")), true);
  assert.ok(kmToPlace(far, region("SK")) > NEAR_RADIUS_KM, "and it is well outside the radius the phone used");
  assert.equal(atPlace(op({ area: "Regina, SK", lat: 50.4452, lon: -104.6189 }), region("SK")), true);
  assert.equal(atPlace(op({ area: "Winnipeg, MB", lat: 49.8951, lon: -97.1384 }), region("SK")), false);
});

test("a listing whose area is the province code alone is still in the province", () => {
  // 4,736 catalog rows carry no town. They are the ones a radius could never have reached.
  assert.equal(atPlace(op({ area: "SK", lat: 52.1, lon: -106.6 }), region("SK")), true);
});

test("a picked point measures to the nearest of a chain's venues, not to the pin the catalog leads with", () => {
  assert.equal(atPlace(TRAPPED, TORONTO), true, "its Toronto venue is here even though its pin is in Vancouver");
  assert.ok(kmToPlace(TRAPPED, TORONTO) < 40);
  const beach = point(34.72, -76.74);
  assert.equal(atPlace(KITTY_HAWK, beach), true);
  assert.ok(kmToPlace(KITTY_HAWK, beach) < 10, "its Atlantic Beach venue, not the Nags Head pin 170 km away");
});

test("a listing genuinely out of reach of a picked point stays out", () => {
  assert.equal(atPlace(op({ area: "Miami, FL", lat: 25.7617, lon: -80.1918 }), TORONTO), false);
  assert.equal(atPlace(TRAPPED, point(51.05, -114.07)), false, "Calgary is near neither of Trapped's two pins");
});

test("a listing with no pin at all is out of a picked point, and never throws", () => {
  const pinless = op({ area: "Tampa, FL" });
  assert.equal(atPlace(pinless, TORONTO), false);
  assert.equal(kmToPlace(pinless, TORONTO), Infinity);
  assert.equal(atPlace(pinless, region("FL")), true, "but a picked state reads its area, so it is still in Florida");
});

test("a GPS pin shows how far the shop is, not the metro the catalog filed it under", () => {
  // Gentle Arts Dojo sits in Waterloo and ships as "Toronto, ON" because there is no KW metro.
  const waterloo = point(43.4643, -80.5204);
  const dojo = op({ title: "Gentle Arts Dojo", area: "Toronto, ON", metroId: "toronto", lat: 43.4633, lon: -80.5236 });
  const line = awayLine(dojo, waterloo);
  assert.ok(line);
  assert.equal(/toronto/i.test(line), false, "the metro dump is not the town");
  assert.match(line, /away$/);
  assert.ok(kmToPlace(dojo, waterloo) < 1);
  assert.equal(awayLine(dojo, region("ON")), null, "a whole province has no distance");
  const chain = awayLine(TRAPPED, TORONTO);
  assert.ok(chain && chain.startsWith("2273 Dundas Street West"), "a chain venue can still name its street");
});

test("a city picked by name includes shops whose pin is there, even if they were filed under another metro", () => {
  const dojo = op({ title: "Gentle Arts Dojo", area: "Toronto, ON", metroId: "toronto", lat: 43.4633, lon: -80.5236 });
  assert.equal(atMetro(dojo, "waterloo"), true);
  assert.equal(atMetro(dojo, "toronto"), true, "its filed metro still counts");
  assert.equal(atMetro(op({ area: "Miami, FL", metroId: "miami", lat: 25.7617, lon: -80.1918 }), "waterloo"), false);
});
