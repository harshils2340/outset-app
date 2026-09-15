import assert from "node:assert/strict";
import test from "node:test";
import { ALL_METRO_ID } from "../../data/metros";
import type { CategoryId, Unclaimed } from "../../data/types";
import { searchSuggest, type SearchScope } from "../search";

/**
 * The ways out of an empty search.
 *
 * When a query finds nothing, the feed offers rows the guest can press: a kind of activity, the same kind
 * somewhere else, another city. Each one carries a count. A count that does not match the page the press
 * opens is worse than no row at all, so these tests press every row and compare.
 */

let n = 0;
function op(over: Partial<Unclaimed> & Pick<Unclaimed, "title" | "cat" | "art" | "metroId">): Unclaimed {
  n += 1;
  return {
    id: "o-test-" + n,
    area: over.metroId,
    src: "test" + n + ".com",
    specs: [],
    options: [],
    includes: [],
    gap: "",
    cover: "https://example.com/" + n + ".jpg",
    ...over,
  };
}

const CATALOG: Unclaimed[] = [
  op({ title: "Skydive Orlando", cat: "air", art: "skydive", metroId: "orlando" }),
  op({ title: "Orlando Freefall Center", cat: "air", art: "skydive", metroId: "orlando" }),
  op({ title: "Tampa Escape Rooms", cat: "indoor", art: "escape", metroId: "tampa" }),
  op({ title: "Bay Kayak Rentals", cat: "water", art: "kayak", metroId: "tampa" }),
  op({ title: "Miami Axe House", cat: "indoor", art: "axe", metroId: "miami" }),
  // Orlando has a third listing that has nothing to do with skydiving, so a city row that counts the whole
  // city instead of the query reads 3 where the page it opens holds 2.
  op({ title: "Orlando Mini Golf", cat: "play", art: "minigolf", metroId: "orlando" }),
];

/** What each kind of row does when the guest presses it, as the feed and the desktop home both wire it up. */
const pressActivity = (q: string, s: SearchScope) => searchSuggest(CATALOG, q, s).results.length;
const pressElsewhere = (q: string, s: SearchScope) => searchSuggest(CATALOG, q, { ...s, metroId: ALL_METRO_ID }).results.length;
const pressPlace = (q: string, s: SearchScope, metroId: string) => searchSuggest(CATALOG, q, { ...s, metroId }).results.length;

/** Every row the empty state offers opens a page with at least as many listings as the row promised. */
function checkWaysOut(q: string, scope: SearchScope) {
  const found = searchSuggest(CATALOG, q, scope);
  assert.equal(found.results.length, 0, `expected no results for ${q}`);
  for (const a of found.activities) {
    const got = pressActivity(a.query, scope);
    assert.ok(got > 0, `activity row "${a.label}" opens an empty page for ${q}`);
    assert.ok(a.count <= got, `activity row "${a.label}" promised ${a.count} and opened ${got}`);
  }
  for (const a of found.elsewhere) {
    const got = pressElsewhere(a.query, scope);
    assert.ok(got > 0, `elsewhere row "${a.label}" opens an empty page for ${q}`);
    assert.ok(a.count <= got, `elsewhere row "${a.label}" promised ${a.count} and opened ${got}`);
  }
  for (const pl of found.places) {
    const got = pressPlace(q, scope, pl.metro.id);
    assert.ok(got > 0, `city row "${pl.metro.name}" opens an empty page for ${q}`);
    assert.ok(pl.count <= got, `city row "${pl.metro.name}" promised ${pl.count} and opened ${got}`);
  }
  return found;
}

test("a kind the category tab hides is not offered as a way out of that tab", () => {
  // Skydiving exists, twice, but not in the Water tab. Offering "Skydive, 2" there opened another empty page.
  const scope: SearchScope = { metroId: ALL_METRO_ID, cat: "water" as CategoryId };
  const found = checkWaysOut("skydiving", scope);
  assert.equal(found.activities.length, 0);
  assert.equal(found.elsewhere.length, 0);
  // The tab is the only thing in the way, and that is what the "in other categories" way out is for.
  assert.equal(found.otherCats, 2);
});

test("a city with none of what the guest asked for is not offered", () => {
  // Tampa has no skydiving. Naming Tampa in the query used to offer Tampa back, counted as its whole catalog.
  const scope: SearchScope = { metroId: "tampa", cat: "all" as CategoryId };
  const found = checkWaysOut("skydiving tampa", scope);
  assert.ok(!found.places.some((p) => p.metro.id === "tampa"), "offered the city the guest is already in");
});

test("a city that does have the kind is offered, with the count that city really has", () => {
  const scope: SearchScope = { metroId: "tampa", cat: "all" as CategoryId };
  const found = checkWaysOut("skydiving orlando", scope);
  const orlando = found.places.find((p) => p.metro.id === "orlando");
  assert.ok(orlando, "Orlando has two skydiving centers and was not offered");
  assert.equal(orlando.count, 2);
});

test("a kind nowhere near the catalog offers nothing rather than something made up", () => {
  const found = searchSuggest(CATALOG, "zzqxwv", { metroId: ALL_METRO_ID, cat: "all" as CategoryId });
  assert.equal(found.results.length, 0);
  assert.equal(found.activities.length, 0);
  assert.equal(found.elsewhere.length, 0);
  assert.equal(found.places.length, 0);
  assert.equal(found.nearMiss, true);
});

test("a search that lands still reports what it found", () => {
  const found = searchSuggest(CATALOG, "kayak", { metroId: "tampa", cat: "all" as CategoryId });
  assert.equal(found.nearMiss, false);
  assert.equal(found.results.length, 1);
  assert.equal(found.results[0].title, "Bay Kayak Rentals");
});
