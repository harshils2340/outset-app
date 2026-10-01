/**
 * The character a numeric HTML entity names, or null when it names none.
 *
 * `String.fromCodePoint` throws a RangeError for anything above U+10FFFF, and every entity decoder in this
 * project passed it a number read straight out of a crawled page. A shop whose site carries a malformed
 * numeric entity, which a broken template or a double-encoded byte is enough to write ("&#999999999;",
 * "&#x110000;"), took down whatever was reading it: the sync's contact pass, a live vendor read in the
 * middle of a concierge answer, a Bookeo or Rezdy page. None of them caught it, because the throw is not a
 * fetch fault and nothing expected text to be able to fault at all.
 *
 * A code point in the surrogate range is refused too. It does not throw, it returns a lone surrogate, which
 * is a string that is not well-formed: it survives as far as the database and then reads back as a question
 * mark or a replacement character, and `JSON.stringify` escapes it rather than carrying it.
 *
 * Zero is refused, which is what the two decoders that had a guard already did: a page writing "&#0;" means
 * nothing by it, and a NUL in a shop's name is worse than the six characters it was written as.
 *
 * Null means "leave the entity exactly as the page wrote it", which is what every caller already does for a
 * named entity it does not know.
 */
export function charFromCodePoint(code: number): string | null {
  if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) return null;
  if (code >= 0xd800 && code <= 0xdfff) return null;
  return String.fromCodePoint(code);
}
