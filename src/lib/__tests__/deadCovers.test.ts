import assert from "node:assert/strict";
import test from "node:test";
import { reportDeadCover, resetDeadCovers, withPhotos } from "../deadCovers";

/**
 * Browse promises a photograph.
 *
 * `explore/feed.ts` keeps a listing out of the grid unless it has a cover, because a wall of scene
 * illustrations reads as a broken page however good the businesses behind it are. That filter was being
 * defeated at render time: a cover is a URL on the operator's own server, roughly one in twelve no longer
 * answers, and `Photo` draws its generated illustration when an image fails. So the grid showed exactly the
 * cartoons the filter exists to prevent, and said nothing.
 *
 * The rule these pin: a cover that fails takes its listing out of every list that promises photographs, on
 * every surface at once, and nothing else about the listing changes.
 */

test("a listing whose cover died leaves the lists that promise photographs", () => {
  resetDeadCovers();
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(withPhotos(items, new Set()), items, "nothing is dropped before anything has failed");
  reportDeadCover("b");
  assert.deepEqual(
    withPhotos(items, new Set(["b"])).map((x) => x.id),
    ["a", "c"],
  );
});

test("the same dead cover reported twice is still one listing", () => {
  resetDeadCovers();
  reportDeadCover("a");
  reportDeadCover("a");
  // A card remounts as a rail scrolls and reports again; the set is the point, not the count.
  assert.deepEqual(withPhotos([{ id: "a" }, { id: "b" }], new Set(["a"])).map((x) => x.id), ["b"]);
});

test("an empty id is not a dead cover", () => {
  resetDeadCovers();
  reportDeadCover("");
  // Photo calls back with whatever id the card passed; a card with no listing behind it must not blank a list.
  assert.deepEqual(withPhotos([{ id: "" }, { id: "b" }], new Set()).length, 2);
});

test("withPhotos leaves the array alone when nothing has died, rather than copying it every render", () => {
  const items = [{ id: "a" }];
  assert.equal(withPhotos(items, new Set()), items, "same reference, so memoised lists downstream stay stable");
});
