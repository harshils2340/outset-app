import assert from "node:assert/strict";
import test from "node:test";
import { inCat } from "../../data/categories";
import { ALL_METRO_ID } from "../../data/metros";
import type { CategoryId, Unclaimed } from "../../data/types";
import { metroInQuery, searchListings, searchSuggest, stripPlaceWords, type SearchScope } from "../search";

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
  // Seattle has more skydiving than Orlando, and is further from Tampa than Orlando is.
  op({ title: "Skydive Seattle", cat: "air", art: "skydive", metroId: "seattle" }),
  op({ title: "Seattle Freefall", cat: "air", art: "skydive", metroId: "seattle" }),
  op({ title: "Puget Sound Parachute Club", cat: "air", art: "skydive", metroId: "seattle" }),
  // Tampa has a yoga studio, so the Classes tab is not empty there even though pottery is.
  op({ title: "Tampa Yoga Loft", cat: "wellness", art: "yoga", metroId: "tampa" }),
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
  if (found.family) {
    // Pressing the family clears What and browses that tab in the same place: photographed listings only.
    const metroId = scope.metroId;
    const got = CATALOG.filter((u) => !!u.cover && (!metroId || metroId === ALL_METRO_ID || u.metroId === metroId) && inCat(u, found.family!.cat)).length;
    assert.ok(got > 0, `family row "${found.family.name}" opens an empty page for ${q}`);
    assert.equal(found.family.count, got, `family row "${found.family.name}" promised ${found.family.count} and opened ${got}`);
  }
  return found;
}

test("a named kind is not hidden by the category tab the guest happens to be on", () => {
  // Wellness All used to empty "escape rooms" because those listings sit in Indoor, then offered
  // "22 in other categories" as the way out. The guest already named the kind.
  const water = searchSuggest(CATALOG, "skydiving", { metroId: ALL_METRO_ID, cat: "water" as CategoryId });
  assert.equal(water.results.length, 5);
  assert.ok(water.results.every((u) => u.art === "skydive"));

  const wellness = searchSuggest(CATALOG, "escape rooms", { metroId: "tampa", cat: "wellness" as CategoryId });
  assert.equal(wellness.results.length, 1);
  assert.equal(wellness.results[0].title, "Tampa Escape Rooms");
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

test("cities that have the kind come nearest first, not biggest first", () => {
  // From Tampa, Orlando's two skydiving centers are offered before Seattle's three.
  const scope: SearchScope = { metroId: "tampa", cat: "all" as CategoryId };
  const found = checkWaysOut("skydiving", scope);
  assert.deepEqual(found.places.map((p) => p.metro.id), ["orlando", "seattle"]);
  assert.equal(found.places[0].count, 2);
  assert.equal(found.places[1].count, 3);
});

test("with no city picked, cities come biggest first", () => {
  const found = searchSuggest(CATALOG, "skydiving miami", { metroId: ALL_METRO_ID, cat: "all" as CategoryId });
  // Miami was named and has none, so the search is scoped nowhere and no city row is needed.
  assert.equal(found.results.length, 0);
  assert.ok(!found.places.some((p) => p.metro.id === "miami"));
});

test("a kind missing from the city offers the tab it lives in, counted there", () => {
  // No pottery in Tampa. Pottery is a Classes kind, and Tampa's yoga studio makes the Classes tab worth opening.
  const scope: SearchScope = { metroId: "tampa", cat: "all" as CategoryId };
  const found = checkWaysOut("pottery class", scope);
  assert.ok(found.family, "no family way out");
  assert.equal(found.family.cat, "classes");
  assert.equal(found.family.name, "Classes");
  assert.equal(found.family.count, 1);
});

test("a kind whose tab is also empty in the city offers no family row", () => {
  // Miami has an axe house and nothing else; no skydiving, and the Air tab there is empty too.
  const scope: SearchScope = { metroId: "miami", cat: "all" as CategoryId };
  const found = checkWaysOut("skydiving", scope);
  assert.equal(found.family, null);
});

test("a kind with no virtual tab falls back to the tab most of its listings carry", () => {
  // No axe throwing in Orlando; axe listings are Indoor, and Orlando has nothing indoor, so the family is not
  // offered, while its Play tab (mini golf) is not the axe family and is not offered either.
  const scope: SearchScope = { metroId: "orlando", cat: "all" as CategoryId };
  const found = checkWaysOut("axe throwing", scope);
  assert.equal(found.family, null);
  // In Tampa the Indoor tab has the escape room, so "axe throwing" there offers Indoor.
  const tampa = checkWaysOut("axe throwing", { metroId: "tampa", cat: "all" as CategoryId });
  assert.equal(tampa.family?.cat, "indoor");
  assert.equal(tampa.family?.count, 1);
});

/**
 * What a search hands back after the catalog has been rebuilt.
 *
 * `rebuild()` in catalog.ts hands out a new array on every operator edit and every time a lite record is
 * swapped for its own detail file. The ids and their order do not move, so the word index stands, but each
 * folded entry also kept the object it folded. That object is what a search returned.
 */

/** The array catalog.ts hands out after an edit: the same listings, one of them a new object. */
function edited(pool: Unclaimed[], id: string, patch: Partial<Unclaimed>): Unclaimed[] {
  return pool.map((u) => (u.id === id ? { ...u, ...patch } : u));
}

test("a listing edited in place is the one a search hands back", () => {
  const pool: Unclaimed[] = [
    op({ title: "Bay Kayak Rentals", cat: "water", art: "kayak", metroId: "tampa", from: 65 }),
    op({ title: "Tampa Paddle Shack", cat: "water", art: "kayak", metroId: "tampa", from: 80 }),
  ];
  const id = pool[0].id;
  assert.equal(searchListings(pool, "kayak tampa")[0].id, id);

  const after = edited(pool, id, { blurb: "Sunset trips from the Riverwalk.", cover: "https://example.com/new.jpg" });
  const found = searchListings(after, "kayak tampa").find((u) => u.id === id);
  assert.ok(found, "the edited listing dropped out of its own search");
  assert.equal(found, after[0], "the search handed back the record the operator replaced");
  assert.equal(found.blurb, "Sunset trips from the Riverwalk.");
  assert.equal(found.cover, "https://example.com/new.jpg");
});

test("a price cap reads the price the operator saved", () => {
  const pool: Unclaimed[] = [
    op({ title: "Gulf Jet Ski Co", cat: "water", art: "jetski", metroId: "tampa", from: 200 }),
  ];
  const id = pool[0].id;
  assert.equal(searchListings(pool, "jet ski under $50").length, 0);

  // The operator puts a $40 half hour on their menu. The cap has to read that, not the crawled $200.
  const cheaper = edited(pool, id, { from: 40, options: [{ name: "Half hour", detail: "", price: 40 }] });
  assert.equal(searchListings(cheaper, "jet ski under $50").length, 1, "a $40 ride stayed out of an under $50 search");

  // And the other way: a shop that raises its price is no longer under the cap.
  const dearer = edited(cheaper, id, { from: 240, options: [{ name: "Half hour", detail: "", price: 240 }] });
  assert.equal(searchListings(dearer, "jet ski under $50").length, 0, "a $240 ride was still offered under $50");
});

test("a city typed with its own accents still moves to Where", () => {
  // "Montréal" is how the city spells itself and how a French keyboard types it. The place words come back
  // normalised, so stripping them by hand left "montral" behind and the city stayed in What as a keyword.
  const named = metroInQuery("cafés montréal");
  assert.equal(named?.metro.id, "montreal");
  assert.equal(stripPlaceWords("cafés montréal", named!.words), "cafés");
  assert.equal(stripPlaceWords("Montréal", named!.words), "");
  // The plain spelling is unchanged.
  const plain = metroInQuery("kayak montreal");
  assert.equal(stripPlaceWords("kayak montreal", plain!.words), "kayak");
  // A preposition belongs to the place, so it goes with it.
  const prep = metroInQuery("cooking classes in tampa");
  assert.equal(stripPlaceWords("cooking classes in tampa", prep!.words), "cooking classes");
});

test("Waterloo, Kitchener and KW are their own metro, not Toronto", () => {
  assert.equal(metroInQuery("karate in waterloo")?.metro.id, "waterloo");
  assert.equal(metroInQuery("karate kitchener")?.metro.id, "waterloo");
  assert.equal(metroInQuery("escape room kw")?.metro.id, "waterloo");
});
