import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { reportDeadCover, resetDeadCovers, withPhotos } from "../deadCovers";

/**
 * A heading counts what the grid under it draws.
 *
 * A cover is a URL on the operator's own web server and roughly one in twelve no longer answers, so
 * `deadCovers` drops those listings from anything that promises photographs. It did that inside `Grid` and
 * `Rail`, at the last moment, and every count on the page was worked out before it: the desktop home drew
 * "Escape rooms in Toronto · 22" over 18 cards, with no Show more and no other way to the missing four. The
 * Filters modal's "Show N places" button, read at the same instant, promised 22 as well.
 *
 * The filter now runs once, on the pool every list is built from, so the number and the cards agree. A
 * business whose cover is dead is still findable by name: the What menu's Businesses rows read the search's
 * own answer rather than the pool.
 */

test("a dead cover leaves the list, so a count taken from it is what the grid draws", () => {
  resetDeadCovers();
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.equal(withPhotos(items, new Set()).length, 3);
  reportDeadCover("b");
  const alive = withPhotos(items, new Set(["b"]));
  assert.deepEqual(alive.map((i) => i.id), ["a", "c"]);
  resetDeadCovers();
});

test("the desktop home filters the pool, not just the grid that draws it", () => {
  const src = readFileSync(new URL("../../components/web/WebHome.tsx", import.meta.url), "utf8");
  const pool = src.slice(src.indexOf("const pool = useMemo"), src.indexOf("const nearPoint ="));
  assert.ok(pool.length > 0, "the home no longer builds a pool");
  assert.match(pool, /withPhotos\(/, "the pool every count is taken from does not drop dead covers");
  // Both branches: a browse of the catalog and the results of a search.
  assert.match(pool, /if \(found\) return withPhotos\(/, "a search's results are counted before the dead are dropped");
  // And the Businesses rows in the What menu still read the search itself, so a dead cover hides no shop.
  assert.match(src, /const ops = found\?\.operators/, "search by name no longer reads the search's own answer");
});
