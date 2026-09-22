import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

import { seasonFact, seasonNoteLine } from "../season";

/**
 * When a seasonal shop trades, on the two surfaces that print it. Every line below is a real one from public/o,
 * named by the listing it came from.
 *
 * The bug this covers: the desktop page dropped any season over 32 characters and the phone sheet printed the
 * same text as a bold heading however long it ran, so 491 shops said one thing on a phone and nothing at all on
 * a desktop.
 */

test("a season stated as one short phrase is a fact, on both surfaces", () => {
  assert.deepEqual(seasonFact("April to October"), { chip: "April to October", note: "April to October" });
  // Over the old 32-character cap and still plainly a fact: the desktop used to bin all four of these.
  assert.equal(seasonFact("Memorial Day weekend through Labor Day weekend").chip, "Memorial Day weekend through Labor Day weekend"); // o-anchorageboatdock-com
  assert.equal(seasonFact("April 1st to November 30th, weather permitting").chip, "April 1st to November 30th, weather permitting"); // o-ambianceonthewater-com
  assert.equal(seasonFact("Memorial Weekend through mid-October").chip, "Memorial Weekend through mid-October"); // o-alpinemeadowsstables-com
  assert.equal(seasonFact("Open year round - Summer & Winter").chip, "Open year round - Summer & Winter"); // o-alaskaoutdoorgearrental-com
});

test("a season stated as a sentence or several is a note, never a heading", () => {
  // o-alaskananglingadventures-com: 129 characters, which the phone sheet printed as a bold title.
  const many = seasonFact("May 16 - October 31 for salmon fishing; June 11 - October 31 for trout and char fishing");
  assert.equal(many.chip, null);
  assert.equal(many.note, "May 16 - October 31 for salmon fishing; June 11 - October 31 for trout and char fishing");
  // o-airboattour-com, two sentences and no semicolon.
  const two = seasonFact("No sunset tours June 1st to Aug 30th due to lightning storms. Morning tours offered in summer months");
  assert.equal(two.chip, null);
  assert.equal(two.note?.startsWith("No sunset tours"), true);
  // o-2muddy-com: short enough for the budget, but a semicolon makes it two statements.
  assert.equal(seasonFact("April to November; custom trips year-round").chip, null);
});

test("a shop that publishes no season is asked to say nothing", () => {
  assert.deepEqual(seasonFact(undefined), { chip: null, note: null });
  assert.deepEqual(seasonFact(null), { chip: null, note: null });
  assert.deepEqual(seasonFact(""), { chip: null, note: null });
  assert.deepEqual(seasonFact("   "), { chip: null, note: null });
});

test("the whitespace the crawl leaves behind does not spend the chip budget", () => {
  assert.equal(seasonFact("  April   to  October \n").chip, "April to October");
});

test("a trailing full stop is punctuation, not a second sentence", () => {
  assert.equal(seasonFact("Open April through October.").chip, "Open April through October.");
});

test("the label goes in front unless the shop's own line already opens with it", () => {
  assert.equal(seasonNoteLine("April through November for public trips"), "Season: April through November for public trips");
  // o-aacenterfordance-org already names itself, so "Season: Season 2026-2027" is not printed.
  assert.equal(seasonNoteLine("Season 2026-2027: September 8 to June 6"), "Season 2026-2027: September 8 to June 6");
  assert.equal(seasonNoteLine("Seasonal park, open May to September"), "Seasonal park, open May to September");
});

test("no shipped season is thrown away, and none is printed as a heading", () => {
  const dir = new URL("../../../public/o/", import.meta.url);
  const files = readdirSync(dir);
  let seasons = 0;
  let chips = 0;
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const item = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as { id: string; season?: string };
    if (!item.season) continue;
    seasons++;
    const { chip, note } = seasonFact(item.season);
    // Every shop that publishes a season keeps it: the note is what both surfaces fall back to.
    assert.ok(note, item.id + " publishes a season and would show nothing");
    // A chip stands in a run of facts and as a row title, so it may never be a paragraph.
    if (chip) {
      chips++;
      assert.ok(chip.length <= 48, item.id + " would put " + chip.length + " characters in the fact line");
      assert.ok(!/[.!?]\s+\S/.test(chip), item.id + " would print a second sentence as a heading");
    }
  }
  assert.ok(seasons > 1000, "expected the shipped catalog to carry seasons, found " + seasons);
  // The old desktop rule admitted 648 of these. Nothing below is a regression guard on the exact number, only
  // that the reader still lets most of them through as facts and still holds the paragraphs back.
  assert.ok(chips > seasons * 0.6, "only " + chips + " of " + seasons + " seasons read as a fact");
  assert.ok(chips < seasons, "every season read as a fact, so the paragraph rule is not running");
});
