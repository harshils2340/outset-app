import assert from "node:assert/strict";
import test from "node:test";
import type { Unclaimed } from "../../data/types";
import { mergeCatalog, savedListings, setOperatorOverride } from "../catalog";

/**
 * The Wishlists tab, which is a list of ids looked up in a catalog that arrives after the first paint.
 *
 * Saves live in localStorage and survive a reload; the catalog does not, and most operators are only in the
 * full file, not the lite shard the rails paint from. So the tab has to tell an id the catalog has not reached
 * yet from one that is genuinely gone, or a guest holding twelve saves is told to create their first wishlist.
 */

let n = 0;
function op(over: Partial<Unclaimed> = {}): Unclaimed {
  n += 1;
  return {
    id: "o-wish-" + n,
    title: "Shop " + n,
    cat: "water",
    art: "jetski",
    metroId: "tampa",
    area: "Tampa",
    src: "wish" + n + ".example.com",
    blurb: "",
    gap: "",
    options: [],
    ...over,
  } as unknown as Unclaimed;
}

test("an id the catalog has not reached yet is counted as missing, not dropped in silence", () => {
  const here = op();
  mergeCatalog([here], {});
  const { items, missing } = savedListings([here.id, "o-not-loaded-yet"]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, here.id);
  // The screen shows "loading your 1 saved place" on this, instead of the empty state.
  assert.equal(missing, 1);
});

test("saved listings keep the order they were hearted in", () => {
  const a = op();
  const b = op();
  const c = op();
  mergeCatalog([a, b, c], {});
  // toggleSaved puts the newest first, and the tab promises newest first.
  assert.deepEqual(savedListings([c.id, a.id, b.id]).items.map((u) => u.id), [c.id, a.id, b.id]);
});

test("a listing the operator switched off stays in the wishlist and carries offline", () => {
  const off = op();
  mergeCatalog([off], {});
  setOperatorOverride(off.id, { title: off.title }, false);
  const { items, missing } = savedListings([off.id]);
  assert.equal(missing, 0);
  assert.equal(items.length, 1);
  // The card reads "Not bookable" off this, rather than offering Instant Book for a page that takes none.
  assert.equal(items[0].offline, true);
  setOperatorOverride(off.id, null, true);
});

test("nothing saved is nothing missing, so the empty state is the right one", () => {
  assert.deepEqual(savedListings([]), { items: [], missing: 0 });
});
