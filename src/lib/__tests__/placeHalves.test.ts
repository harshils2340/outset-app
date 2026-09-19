import assert from "node:assert/strict";
import test from "node:test";
import type { Unclaimed } from "../../data/types";
import { searchListings } from "../search";

/**
 * A place whose name is two words.
 *
 * The search folds in the two ways a guest splits a word differently from the operator: "jetski" typed for a
 * shop called Jet Ski, and "jet ski" typed for a shop called Jetski. The second one glues the pair into one
 * spelling and lets it answer either half. A word that is only the *front* of that glued spelling was
 * answering the back half too, so "fort" answered the "myers" in "fort myers", and every Fort Smith, Fort
 * Garry, Fort Hill and Fort Benning in the catalog turned up in a Fort Myers search. Over the shipped
 * catalog that put a golf course at Fort Benning, Georgia at the top of "golf fort myers", Fort Hill Brewery
 * in Massachusetts at the top of "brewery fort lauderdale", and a dive shop in Utah as the only answer to
 * "scuba virginia beach".
 */

let n = 0;
function op(over: Partial<Unclaimed> & Pick<Unclaimed, "title" | "cat" | "art" | "metroId" | "area">): Unclaimed {
  n += 1;
  return {
    id: "o-halves-" + n,
    src: "shop" + n + ".com",
    specs: [],
    options: [],
    includes: [],
    gap: "",
    cover: "https://example.com/" + n + ".jpg",
    ...over,
  };
}

/**
 * One listing carries "fortmyers" as a word of its own, through its domain, which is what puts the glued
 * spelling in the vocabulary and turns the pair on. Without it the pair is never glued and there is nothing
 * to leak through.
 */
const CATALOG: Unclaimed[] = [
  op({ title: "Eagle Ridge Golf Club", cat: "play", art: "golf", metroId: "tampa", area: "Fort Myers, FL", src: "fortmyers.com" }),
  op({ title: "San Carlos Golf Club", cat: "play", art: "golf", metroId: "tampa", area: "Fort Myers, FL" }),
  op({ title: "Fort Benning Golf Course", cat: "play", art: "golf", metroId: "atlanta", area: "Fort Moore, GA" }),
  op({ title: "Fort Smith Little Theatre", cat: "indoor", art: "theatre", metroId: "atlanta", area: "Fort Smith, AR" }),
];

const titles = (q: string) => searchListings(CATALOG, q).map((u) => u.title);

test("a shop at the other Fort does not answer a Fort Myers search", () => {
  const found = titles("golf fort myers");
  assert.deepEqual(found, ["Eagle Ridge Golf Club", "San Carlos Golf Club"]);
  assert.ok(!found.includes("Fort Benning Golf Course"), "a golf course at Fort Benning answered Fort Myers");
});

test("the town on its own is no looser than the town with an activity in front of it", () => {
  const found = titles("fort myers");
  assert.ok(found.includes("Eagle Ridge Golf Club"), "a Fort Myers listing dropped out of a Fort Myers search");
  assert.ok(!found.includes("Fort Smith Little Theatre"), "a theatre at Fort Smith answered Fort Myers");
});

/**
 * The half that is genuinely missing leaves an empty page rather than a wrong one. The feed already offers
 * the same kind somewhere else when a search finds nothing, which is a better answer than a shop in another
 * state presented as the only one there is.
 */
test("nothing in the town means nothing, not the nearest lookalike", () => {
  assert.deepEqual(titles("theatre fort myers"), []);
});

/** The reason the pair is glued at all still holds: a shop that writes the word as one word is still found. */
test("a glued spelling the catalog really carries still answers both halves", () => {
  const pool: Unclaimed[] = [
    op({ title: "Jetski Miami Rental", cat: "water", art: "jetski", metroId: "miami", area: "Miami Beach, FL" }),
    op({ title: "Coral Way Bowling", cat: "play", art: "bowling", metroId: "miami", area: "Miami, FL" }),
  ];
  const found = searchListings(pool, "jet ski miami").map((u) => u.title);
  assert.deepEqual(found, ["Jetski Miami Rental"]);
});

/** And the front of a word a guest really typed still reaches the shorter word the catalog filed it under. */
test("a longer word the guest typed still reaches the shorter one the catalog uses", () => {
  const pool: Unclaimed[] = [
    op({ title: "Bayside Heli Tours", cat: "air", art: "heli", metroId: "tampa", area: "Tampa, FL" }),
  ];
  assert.equal(searchListings(pool, "helicopter tampa").length, 1);
});
