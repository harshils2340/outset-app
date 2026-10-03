import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CATEGORIES, inferCategory } from "../catalog.ts";

// `plan.ts` opens the catalog database at import time; a scratch file keeps this test off the real one.
process.env.OUTSET_DB = join(mkdtempSync(join(tmpdir(), "outset-spelled-")), "catalog.db");
const { readIntent } = await import("../../concierge/plan.ts");
const { migrate } = await import("../../db/client.ts");
migrate();

/**
 * The product's own name for a category has to resolve to that category.
 *
 * Every id in this file is one word and `inferCategory` anchors on a word boundary, so nine of the sixty-four
 * labels did not resolve to the category they label. "Mini golf" and "disc golf" fell through to the shorter
 * `golf`, so a guest asking the concierge for mini golf in Tampa was answered with country clubs; "laser tag",
 * "water park", "theme park", "ice skating" and "martial arts" fell through to the jet ski fallback, which
 * `readIntent` discards as a false positive, so the sentence read as naming no activity at all and a guest who
 * had said exactly what they wanted was asked what sort of thing they wanted.
 *
 * Measured over all 52,816 shipped business names: 650 read differently after the fix, and 647 of them move
 * onto the kind the catalog already ships them as (301 martial arts studios, 104 disc golf courses, 93 mini
 * golf courses, 59 ice rinks, 53 water parks, 12 laser tag arenas).
 */
test("the spelled-out form of a glued id resolves to that category", () => {
  assert.equal(inferCategory("mini golf in tampa").id, "minigolf");
  assert.equal(inferCategory("Arnold's Mini-Golf").id, "minigolf");
  assert.equal(inferCategory("disc golf near me").id, "discgolf");
  assert.equal(inferCategory("laser tag for 8 of us").id, "lasertag");
  assert.equal(inferCategory("water park in orlando").id, "waterpark");
  assert.equal(inferCategory("theme park tickets").id, "themepark");
  assert.equal(inferCategory("ice rink in boston").id, "icerink");
  assert.equal(inferCategory("ice skating tonight").id, "icerink");
  assert.equal(inferCategory("martial arts class").id, "martialarts");
  // The glued spelling never stopped working.
  assert.equal(inferCategory("minigolf in tampa").id, "minigolf");
  assert.equal(inferCategory("waterpark in orlando").id, "waterpark");
});

test("every category's own label resolves to it, bar the two that are not that category's alone", () => {
  // "Art class" is pottery's label and 8 of the 12 shipped listings named for one are filed under gymnastics;
  // "sailing lessons and charters" carries the word charter, which this function reads as a fishing charter.
  const allowed = new Set(["pottery", "sailing"]);
  const wrong = CATEGORIES.filter((c) => inferCategory(c.label.toLowerCase()).id !== c.id).map((c) => c.id);
  assert.deepEqual(wrong.filter((id) => !allowed.has(id)), []);
});

test("the longest id still wins, so a spelling cannot beat a category that contains it", () => {
  // Both phrases are in this one. The water park is the bigger thing and 9 characters beats 8, as before.
  assert.equal(inferCategory("Waterpark and Mini Golf").id, "waterpark");
  assert.equal(inferCategory("water park and mini golf").id, "waterpark");
});

test("a sentence naming a two-word activity reaches the concierge as that activity", () => {
  // Without the spelling, `categoryId` came back null here: the jet ski fallback is thrown away as a false
  // positive, so the guest was asked what sort of thing they wanted after naming it.
  assert.equal(readIntent("laser tag for 8 of us").categoryId, "lasertag");
  assert.equal(readIntent("mini golf tonight").categoryId, "minigolf");
});
