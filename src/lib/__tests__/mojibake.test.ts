import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

import { plainWords, undoMojibake } from "../catalog";

/**
 * A page served as Windows-1252 and read as UTF-8: an em dash arrives as "â€”", a curly apostrophe as "â€™",
 * and a line that went through the mistake twice carries "Ã¢â‚¬â„¢". Four shipped listings print one to a
 * guest, and the fault has been on the open list since the twenty-first run:
 *
 *   o-lastcastguiding-com   "salmon speciesâ€”Chinook, Coho, Sockeye" in its service description
 *   o-reeldealcharterfishingkeylargo-com  "weÃ¢â‚¬â„¢ll be back in October" in two review cards
 *   o-parafunalia-com       "O�Brien Pontoon Slide" in a tag
 *   o-monroevilleal-gov     "7 � 12" and "1 � 5 tables" in two option labels
 *
 * The last two are the other half of the same fault: the byte is already gone and the decoder left a U+FFFD
 * where it was, which is a character no guest should ever be shown.
 */

const dir = new URL("../../../public/o/", import.meta.url);
const MOJIBAKE = /[ÂÃâ][\u0080-ÿ–—‘-„†-•…‰‹›€™]|�/;

/* ---------- the rule ---------- */

test("a run of mojibake becomes the character the shop typed", () => {
  assert.equal(undoMojibake("salmon speciesâ€”Chinook"), "salmon species—Chinook");
  assert.equal(undoMojibake("Captainâ€™s boat"), "Captain’s boat");
  // Twice through the same mistake.
  assert.equal(undoMojibake("weÃ¢â‚¬â„¢ll be back"), "we’ll be back");
});

test("a word that is simply French keeps its accents", () => {
  for (const line of ["café au lait", "crème brûlée", "Îles de la Madeleine", "Château Ramezay"]) {
    assert.equal(undoMojibake(line), line, line);
  }
});

test("a character Windows-1252 never had does not stop the repair beside it", () => {
  assert.equal(undoMojibake("Jet ski 🏄 rental â€“ 2 hours"), "Jet ski 🏄 rental – 2 hours");
  assert.equal(undoMojibake("中文 tour"), "中文 tour");
});

test("a lost byte is read from what sits either side of it", () => {
  assert.equal(plainWords("O�Brien Pontoon Slide"), "O’Brien Pontoon Slide");
  assert.equal(plainWords("7 � 12"), "7 - 12");
  assert.equal(plainWords("1 � 5 tables"), "1 - 5 tables");
  // Nowhere it can be read from, it simply goes rather than being drawn.
  assert.equal(plainWords("Sunset cruise � bring a jacket"), "Sunset cruise bring a jacket");
});

/* ---------- and on the shipped catalog ---------- */

test("no listing in the shipped catalog says any of this to a guest", () => {
  const bad: string[] = [];
  for (const file of readdirSync(dir)) {
    const raw = readFileSync(new URL(file, dir), "utf8");
    if (!MOJIBAKE.test(raw)) continue;
    const walk = (v: unknown, path: string) => {
      if (typeof v === "string") {
        if (MOJIBAKE.test(v) && MOJIBAKE.test(plainWords(v))) bad.push(`${file} ${path}: ${plainWords(v).slice(0, 80)}`);
      } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
      else if (v && typeof v === "object") for (const k of Object.keys(v)) walk((v as Record<string, unknown>)[k], path ? `${path}.${k}` : k);
    };
    walk(JSON.parse(raw), "");
  }
  assert.deepEqual(bad, []);
});
