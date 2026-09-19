import assert from "node:assert/strict";
import test from "node:test";
import { ALL_METRO_ID } from "../../data/metros";
import type { CategoryId, Unclaimed } from "../../data/types";
import { searchSuggest, type SearchScope } from "../search";

/**
 * The city rows under a search that did find something.
 *
 * A search offers cities to try, each with a count. The empty state counts what its own button opens; the
 * found state counted the city itself, every listing in it of every kind, and the guest sees those rows
 * whenever a filter clears the grid under a search that did land. Over the shipped catalog that offered a
 * guest searching tennis in Tampa "Nashville · 313", because Nashville answers "tennis" through Tennessee,
 * and opened an empty page on it: the city has 313 listings and no tennis at all.
 */

let n = 0;
function op(over: Partial<Unclaimed> & Pick<Unclaimed, "title" | "cat" | "art" | "metroId" | "area">): Unclaimed {
  n += 1;
  return {
    id: "o-cityrow-" + n,
    src: "row" + n + ".com",
    specs: [],
    options: [],
    includes: [],
    gap: "",
    cover: "https://example.com/" + n + ".jpg",
    ...over,
  };
}

/**
 * Nashville answers "tennis" because Tennessee does, and it has listings, none of them tennis. Tampa has the
 * tennis, so the search lands and the found state is the one that draws the city rows. The areas carry their
 * state because that is what puts Tennessee in front of the query in the first place.
 */
const CATALOG: Unclaimed[] = [
  op({ title: "Bayshore Tennis Club", cat: "play", art: "tennis", metroId: "tampa", area: "Tampa, FL" }),
  op({ title: "Davis Islands Courts", cat: "play", art: "tennis", metroId: "tampa", area: "Tampa, FL" }),
  op({ title: "Music City Axe", cat: "indoor", art: "axe", metroId: "nashville", area: "Nashville, TN" }),
  op({ title: "Cumberland Kayak", cat: "water", art: "kayak", metroId: "nashville", area: "Nashville, TN" }),
  op({ title: "Broadway Bowling", cat: "play", art: "bowling", metroId: "nashville", area: "Nashville, TN" }),
];

const scope: SearchScope = { metroId: "tampa", cat: "all" as CategoryId };

test("a city row is counted by the page it opens, not by the size of the city", () => {
  const found = searchSuggest(CATALOG, "tennis", scope);
  assert.ok(found.results.length > 0, "the search was supposed to land in Tampa");
  for (const pl of found.places) {
    const opened = searchSuggest(CATALOG, "tennis", { ...scope, metroId: pl.metro.id }).results.length;
    assert.ok(opened >= pl.count, `${pl.metro.name} promised ${pl.count} and opens ${opened}`);
  }
});

test("a city with none of what the guest asked for is not offered at all", () => {
  const found = searchSuggest(CATALOG, "tennis", scope);
  assert.ok(!found.places.some((pl) => pl.metro.id === "nashville"), "Nashville was offered for a tennis search");
});

test("a city that does have it is still offered, with the count it really has", () => {
  const found = searchSuggest(CATALOG, "kayak", scope);
  const nash = found.places.find((pl) => pl.metro.id === "nashville");
  assert.ok(nash, "Nashville has the kayaking and was not offered");
  assert.equal(nash.count, 1);
  assert.equal(searchSuggest(CATALOG, "kayak", { ...scope, metroId: "nashville" }).results.length, 1);
});

/** A guest already looking everywhere has the whole ranking in hand, and the rows have to count the same. */
test("the rows count the same when the guest is looking everywhere", () => {
  const everywhere: SearchScope = { metroId: ALL_METRO_ID, cat: "all" as CategoryId };
  const found = searchSuggest(CATALOG, "kayak", everywhere);
  for (const pl of found.places) {
    const opened = searchSuggest(CATALOG, "kayak", { ...everywhere, metroId: pl.metro.id }).results.length;
    assert.ok(opened >= pl.count, `${pl.metro.name} promised ${pl.count} and opens ${opened}`);
  }
});
