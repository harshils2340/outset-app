/**
 * When a seasonal business actually trades, read one way for every surface that prints it.
 *
 * The desktop page put the season in the grey run of facts under the subtitle ("Up to 12 guests · Ages 8+ ·
 * April to October") and dropped anything over 32 characters on the floor, so 491 of the 1,144 shops that
 * publish a season said nothing about it there at all: a guest could pick a January date on a charter whose
 * own site says "May 16 - October 31" and never be told. The phone sheet had the opposite fault and printed
 * whatever it was given as the bold title of a key-fact row, so the same shops turned a 228-character
 * paragraph into a heading with the word "Season" in small grey type underneath it.
 *
 * So a season is one of two things, and both surfaces read it the same way here:
 *
 * - a `chip`, when the shop stated it as one short phrase ("Memorial Day weekend through Labor Day weekend").
 *   That sits in a run of facts and reads as the title of a row.
 * - a `note`, when the shop stated it as a sentence or several. That is not a heading and not a chip, and it
 *   is printed as the sentence it is, under a label.
 *
 * `note` carries the shop's words either way, so nothing a shop published is ever thrown away.
 */

/** As long as a season may be and still read as a fact rather than a sentence. */
const CHIP_MAX = 48;

export type SeasonFact = { chip: string | null; note: string | null };

/** Collapse the whitespace the crawl leaves behind. The season field carries no markup, so nothing else is stripped. */
function normalize(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** True when the text is one statement, so it can stand as a chip rather than needing a sentence's room. */
function oneStatement(text: string): boolean {
  if (text.includes(";")) return false;
  // A full stop with more text after it is a second sentence. A trailing one is just punctuation.
  return !/[.!?]\s+\S/.test(text);
}

export function seasonFact(raw: string | null | undefined): SeasonFact {
  if (!raw) return { chip: null, note: null };
  const text = normalize(raw);
  if (!text) return { chip: null, note: null };
  return { chip: text.length <= CHIP_MAX && oneStatement(text) ? text : null, note: text };
}

/**
 * The season under a label, for the surfaces that print it as a sentence. A shop that already opens with the
 * word keeps its own wording rather than reading "Season: Season 2026-2027 runs...".
 */
export function seasonNoteLine(note: string): string {
  return /^season(s|al)?\b/i.test(note) ? note : "Season: " + note;
}
