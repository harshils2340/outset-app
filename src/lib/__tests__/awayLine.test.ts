import { strict as assert } from "node:assert";
import test from "node:test";
import { awayLine } from "../../components/explore/feed";
import type { Unclaimed } from "../../data/types";

/**
 * "Nearby away" was on every card in downtown Tampa: fmtDistance answers "Nearby" in words for a shop under
 * a third of a mile off, and the card line appended "away" to whatever came back. Only a number takes "away".
 */
const shop = (lat: number, lon: number): Unclaimed => ({ id: "o-x", title: "X", area: "Tampa, FL", lat, lon } as unknown as Unclaimed);
const here = { label: "Here", sub: "", lat: 27.95, lon: -82.46 };

test("a shop a few hundred metres off reads Nearby, not Nearby away", () => {
  assert.equal(awayLine(shop(27.951, -82.461), here), "Nearby");
});

test("a shop a real distance off still reads as a distance away", () => {
  assert.equal(awayLine(shop(28.05, -82.46), here), "6.9 mi away");
});

test("a partner product has no distance line", () => {
  assert.equal(awayLine({ ...shop(27.951, -82.461), affiliate: { source: "viator", label: "Viator", url: "https://viator.example" } }, here), null);
});
