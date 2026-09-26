import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import test from "node:test";
import { listingId, listingInHash } from "../hashRoute";

/**
 * A listing link whose id has been shouted somewhere along the way.
 *
 * Every regex that reads an id out of the hash is case-insensitive, and every id the catalog ships is lower
 * case, so `#o=O-ALCATRAZTOURSF-COM` names a real listing and resolved to nothing. That was silent until the
 * app learned to say "That listing is no longer on Outset" when it cannot find one, and then it would have
 * said it about a listing that is right there.
 */

test("an id is read as the catalog spells it", () => {
  assert.equal(listingId("O-ALCATRAZTOURSF-COM"), "o-alcatraztoursf-com");
  assert.equal(listingId("o-alcatraztoursf-com"), "o-alcatraztoursf-com");
  assert.equal(listingInHash("#o=O-Adkboattour-Com"), "o-adkboattour-com");
  assert.equal(listingInHash("https://onoutset.com/#o=O-ADKBOATTOUR-COM"), "o-adkboattour-com");
});

test("a hash that names no listing still names none", () => {
  assert.equal(listingInHash("#claim=o-x&k=y"), null);
  assert.equal(listingInHash(""), null);
});

test("every shipped listing id is lower case, which is what makes lowering safe", () => {
  const ids = readdirSync(new URL("../../../public/o", import.meta.url)).map((f) => f.replace(/\.json$/, ""));
  assert.ok(ids.length > 1000, "the shipped detail files are not where they were");
  const shouted = ids.filter((id) => id !== id.toLowerCase());
  assert.deepEqual(shouted, [], "a listing id now carries an upper case letter, so lowering a hash would lose it");
});
