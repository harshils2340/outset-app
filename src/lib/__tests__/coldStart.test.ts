import assert from "node:assert/strict";
import test from "node:test";
import type { Unclaimed } from "../../data/types";
import { listingsByIds, mergeCatalog, stillArriving } from "../catalog";

/**
 * The three tabs that are a list of ids kept in localStorage: Wishlists, Trips and Inbox.
 *
 * The ids survive a reload and the catalog does not. It is fetched after the first paint, and most operators
 * are only in the full file, not the lite shard the rails paint from, so between the first paint and the
 * catalog landing every one of those ids resolves to nothing. Wishlists learned to say so; Trips and Inbox
 * both looked each id up, rendered null for every miss, and then counted the ids rather than the rows they
 * could draw, so the tab drew its list container full of nothing and skipped its empty state as well. A guest
 * with a confirmed trip for tomorrow opened Trips on a cold start and read the word "Trips" over a blank page.
 */

let n = 0;
function op(over: Partial<Unclaimed> = {}): Unclaimed {
  n += 1;
  return {
    id: "o-cold-" + n,
    title: "Shop " + n,
    cat: "water",
    art: "jetski",
    metroId: "tampa",
    area: "Tampa",
    src: "cold" + n + ".example.com",
    blurb: "",
    gap: "",
    options: [],
    ...over,
  } as unknown as Unclaimed;
}

test("an id the catalog has not reached yet is counted as missing, not dropped in silence", () => {
  const here = op();
  mergeCatalog([here], {});
  const { items, missing } = listingsByIds([here.id, "o-not-loaded-yet"]);
  assert.deepEqual(items.map((u) => u.id), [here.id]);
  assert.equal(missing, 1);
});

test("ids keep the order they were given in", () => {
  const a = op();
  const b = op();
  const c = op();
  mergeCatalog([a, b, c], {});
  assert.deepEqual(listingsByIds([c.id, a.id, b.id]).items.map((u) => u.id), [c.id, a.id, b.id]);
});

test("nothing resolved while the catalog is still coming is a list loading, not an empty one", () => {
  // Three trips or three threads on the device, none of their operators landed yet.
  assert.equal(stillArriving(3, 0, false), true);
});

test("nothing resolved once the catalog is complete is genuinely empty", () => {
  // The same three ids, but the catalog has finished: they are gone, so the tab shows its empty state rather
  // than spinning for good.
  assert.equal(stillArriving(3, 0, true), false);
});

test("one row that did resolve is a list, however many ids are still outstanding", () => {
  // The tab draws what it has instead of hiding a trip behind a loading message.
  assert.equal(stillArriving(9, 1, false), false);
});

test("nothing on the device is nothing loading, so the empty state is the right one", () => {
  assert.equal(stillArriving(0, 0, false), false);
  assert.deepEqual(listingsByIds([]), { items: [], missing: 0 });
});
