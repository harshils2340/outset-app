import assert from "node:assert/strict";
import test from "node:test";

import { decodeEntities, plainWords } from "../catalog";

/**
 * A numeric HTML entity naming no character at all.
 *
 * `decodeEntities` handed the number it read straight to `String.fromCodePoint`, which throws a RangeError
 * for anything above U+10FFFF. The guard in front of it checked `Number.isFinite`, which every one of these
 * numbers passes. So a shop whose site carries a malformed numeric entity, which a broken template or a
 * double-encoded byte is enough to write, threw inside `plainWords`, and `plainWords` is what the listing
 * page, the phone sheet's "What to bring" and every Otto answer run the shop's own words through.
 *
 * There is no error boundary anywhere in this app, so the throw would not have shown as a bad sentence. It
 * would have unmounted the tree: a blank screen for every guest who opened that shop.
 *
 * No shipped detail file carries such an entity today, checked over all of `public/o` and both catalog
 * files: the only numeric entities in the catalog are `&#038;` and `&#39;`. This is the crawl that has not
 * happened yet rather than a listing that is wrong now.
 */

test("an entity naming no character is left exactly as the shop wrote it", () => {
  assert.equal(decodeEntities("Half day &#999999999; charter"), "Half day &#999999999; charter");
  assert.equal(decodeEntities("Half day &#x110000; charter"), "Half day &#x110000; charter");
  assert.equal(decodeEntities("&#1114112;"), "&#1114112;");
  assert.equal(decodeEntities("&#" + "9".repeat(25) + ";"), "&#" + "9".repeat(25) + ";");
});

test("a lone surrogate is never written into a guest's text", () => {
  for (const e of ["&#55296;", "&#xD800;", "&#57343;"]) assert.equal(decodeEntities(e), e);
  assert.ok(decodeEntities("&#128512;").isWellFormed());
  assert.equal(decodeEntities("&#128512;"), "\u{1f600}");
});

test("plainWords survives a shop's broken markup instead of blanking the page", () => {
  assert.equal(
    plainWords("Bring a helmet &#999999999; and a towel"),
    "Bring a helmet &#999999999; and a towel",
  );
  // The sentence around it still reads: only the six characters it could not decode stay as they were.
  assert.equal(plainWords("Half day &#x110000; trip &amp; gear"), "Half day &#x110000; trip & gear");
});

test("the entities a shop actually writes still decode", () => {
  assert.equal(decodeEntities("Quizzler&#39;s Escape &amp; Play"), "Quizzler's Escape & Play");
  assert.equal(decodeEntities("20&#039; Nauticstar"), "20' Nauticstar");
  assert.equal(decodeEntities("Pick Up &amp;amp; Drop Off"), "Pick Up & Drop Off");
  assert.equal(decodeEntities("30&#176; water"), "30\u00b0 water");
  assert.equal(decodeEntities("&#8217;"), "’");
  assert.equal(decodeEntities("&#0;"), "&#0;");
});
