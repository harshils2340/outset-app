import { test } from "node:test";
import assert from "node:assert/strict";
import { charFromCodePoint } from "../codePoint.ts";
import { decodeEntities } from "../../sync/contacts.ts";
import { decode as decodeChain } from "../../discover/chains.ts";

/**
 * Every numeric HTML entity in this project was handed straight to `String.fromCodePoint`, which throws a
 * RangeError above U+10FFFF. A shop's page only has to carry one malformed entity, which a broken template
 * or a double-encoded byte is enough to write, and whatever was reading the page threw: the sync's contact
 * pass, the chain reader, a live FishingReservations read in the middle of a concierge answer, a Bookeo or
 * a Rezdy page. The throw is not a fetch fault, so none of the callers caught it.
 *
 * No shipped listing carries such an entity today, so this is the crawl that has not happened yet rather
 * than a listing that is wrong now. The two decoders that did have a guard checked `Number.isFinite`, which
 * every one of these numbers passes.
 */

test("a code point past the last character names nothing", () => {
  assert.equal(charFromCodePoint(0x110000), null);
  assert.equal(charFromCodePoint(999999999), null);
  assert.equal(charFromCodePoint(1e25), null);
  assert.equal(charFromCodePoint(Number.POSITIVE_INFINITY), null);
  assert.equal(charFromCodePoint(Number.NaN), null);
});

test("a lone surrogate is not a character", () => {
  for (const code of [0xd800, 0xdc00, 0xdfff]) assert.equal(charFromCodePoint(code), null);
  // The pair spelled out as one scalar value is a character, and keeps being one.
  assert.equal(charFromCodePoint(0x1f600), "\u{1f600}");
});

test("zero and below name nothing, as they did before", () => {
  assert.equal(charFromCodePoint(0), null);
  assert.equal(charFromCodePoint(-1), null);
  assert.equal(charFromCodePoint(1.5), null);
});

test("the characters a page actually writes still decode", () => {
  assert.equal(charFromCodePoint(39), "'");
  assert.equal(charFromCodePoint(38), "&");
  assert.equal(charFromCodePoint(0x2019), "’");
  assert.equal(charFromCodePoint(0x10ffff), String.fromCodePoint(0x10ffff));
});

test("the sync's decoder leaves a malformed entity as the page wrote it", () => {
  assert.equal(decodeEntities("Half day &#999999999; charter"), "Half day &#999999999; charter");
  assert.equal(decodeEntities("Half day &#x110000; charter"), "Half day &#x110000; charter");
  assert.equal(decodeEntities("Quizzler&#39;s Escape &amp; Play"), "Quizzler's Escape & Play");
});

test("the chain reader reads a numeric entity past U+FFFF as the character it names", () => {
  // It used to use String.fromCharCode, which wraps modulo 65536 rather than throwing: an emoji in a
  // branch name came back as a private-use glyph instead of the emoji.
  assert.equal(decodeChain("Pier 60 &#128512;"), "Pier 60 \u{1f600}");
  assert.equal(decodeChain("Pier 60 &#999999999;"), "Pier 60 &#999999999;");
  assert.equal(decodeChain("Dick&#39;s Sporting Goods"), "Dick's Sporting Goods");
});
