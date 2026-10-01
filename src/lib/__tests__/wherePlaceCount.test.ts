import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { atMetro, feedFor } from "../../components/explore/feed";
import { ALL_METRO_ID, METROS } from "../../data/metros";
import type { CategoryId, Unclaimed } from "../../data/types";
import type { FeedFilters } from "../../components/explore/prefs";

/**
 * What a place row in the phone search sheet promises, against the page it opens.
 *
 * The sheet states its own rule at the top of the file: every count on a suggestion is the length of the feed
 * that suggestion opens. The What rows keep it, and so does the family row; the Where rows counted the metro
 * instead, every listing filed there whatever the feed would then draw. Browse asks for a real cover, and it
 * also honours the category chip and the filters the guest left on, so each row overstated its own page:
 * "Dallas · 763 places" opened on 564, "New York · 2,216" on 1,713, "Anywhere · 52,816 places across the US
 * and Canada" on 43,678. Every metro in the grid was wrong, by 10% to 26%.
 *
 * The desktop's Where menu has counted photographed places since it was written, so this is the phone catching
 * up on a rule the product had already settled.
 */

const TSX = readFileSync(new URL("../../components/explore/SearchSheet.tsx", import.meta.url), "utf8");
const CATALOG = JSON.parse(readFileSync(new URL("../../../public/catalog.json", import.meta.url), "utf8")) as {
  operators: Unclaimed[];
};
const NONE: FeedFilters = { fav: false, cancel: false, deal: false, priced: false };

/** The body of the sheet's one place-counting function. */
function countInMetroBody(): string {
  const at = TSX.indexOf("function countInMetro(");
  assert.ok(at > 0, "countInMetro was renamed; re-read this test");
  const open = TSX.indexOf("{", at);
  return TSX.slice(open, TSX.indexOf("\n}", open));
}

test("a place row is counted by running the feed it opens", () => {
  const body = countInMetroBody();
  assert.match(body, /feedFor\(/, "the Where count is expected to run the feed, the way every other count here does");
  assert.doesNotMatch(body, /atMetro\(/, "counting the metro is what overstated every row; count the feed instead");
});

test("the count carries the chip and the filters the feed will apply", () => {
  const decl = /function countInMetro\(([^)]*)\)/.exec(TSX);
  assert.ok(decl, "countInMetro was renamed; re-read this test");
  assert.match(decl![1], /cat:/, "a category chip narrows the feed, so it has to narrow the count");
  assert.match(decl![1], /filters:/, "the guest's filters narrow the feed, so they have to narrow the count");
  // Three rows read it: the typed city list, the seeded destinations and Anywhere.
  const calls = TSX.match(/countInMetro\(/g) || [];
  assert.equal(calls.length, 4, "a caller was added or removed; check each one passes the chip and the filters");
  for (const m of TSX.matchAll(/countInMetro\((?!metroId)([^)]*)\)/g)) {
    assert.match(m[1], /state\.cat/, "every call is expected to pass the live category chip");
    assert.match(m[1], /prefs\.filters/, "every call is expected to pass the live filters");
  }
});

test("counting the metro overstates the feed on every city in the grid, and on Anywhere", () => {
  const all = CATALOG.operators;
  const ids = [...METROS.map((m) => m.id), ALL_METRO_ID];
  let overstated = 0;
  for (const id of ids) {
    const said = id === ALL_METRO_ID ? all.length : all.filter((u) => atMetro(u, id)).length;
    const shown = feedFor(all, "", "all" as CategoryId, id, null, NONE).length;
    assert.ok(shown <= said, id + ": the feed cannot hold more than the metro does");
    if (shown < said) overstated++;
  }
  assert.equal(overstated, ids.length, "the old rule is expected to overstate every row, which is why it was wrong");
});

test("a category chip and a filter each take the count down with the feed", () => {
  const all = CATALOG.operators;
  const everything = feedFor(all, "", "all" as CategoryId, "tampa", null, NONE).length;
  const water = feedFor(all, "", "water" as CategoryId, "tampa", null, NONE).length;
  assert.ok(water > 0 && water < everything, "the Water chip is expected to draw fewer cards than All");
  const priced = feedFor(all, "", "all" as CategoryId, "tampa", null, { ...NONE, priced: true }).length;
  assert.ok(priced > 0 && priced < everything, "the priced filter is expected to draw fewer cards than no filter");
});
