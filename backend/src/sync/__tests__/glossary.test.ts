/**
 * The plain-English line a guest reads under a service name. It is written from the word alone, so a word that
 * means two things has to be sure which one it is looking at before it says anything.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { explainTerms } from "../glossary.ts";

test("a river grade is a river, and a class pack is not", () => {
  // o-htdnyc-com sells a "Boxing Class 4-Pack"; both its tiers were explained as powerful rapids.
  assert.deepEqual(explainTerms("Boxing Class 4-Pack (Seaport)", "martialarts"), []);
  assert.deepEqual(explainTerms("Yoga Class 2 Pack", "yoga"), []);
  assert.equal(explainTerms("16 miles of class II-IV whitewater rafting on the Pacuare River", "rafting")[0]?.term, "Class II rapids"); // o-westernriver-com
  assert.equal(explainTerms("14-mile trips with class II and III+ rapids", "fishing")[0]?.term, "Class II rapids"); // o-blackcanyonanglers-com
  assert.equal(explainTerms("Class 3 rapids, half day", "rafting").some((e) => e.term === "Class III rapids"), true);
});

test("a word that means two things reads its own activity first", () => {
  assert.equal(explainTerms("Tandem jump", "skydive")[0]?.meaning, "You jump strapped to an instructor who handles the parachute.");
  assert.equal(explainTerms("Tandem flight", "parasail")[0]?.meaning, "Two people fly together, side by side under one parasail.");
});

test("nothing is explained twice, and a blank label says nothing", () => {
  assert.deepEqual(explainTerms("", "golf"), []);
  assert.deepEqual(explainTerms("   ", "golf"), []);
  const hits = explainTerms("18 holes with greens fee and cart fee included", "golf");
  assert.ok(hits.length <= 2, "at most two, so a menu is not a dictionary");
  assert.equal(new Set(hits.map((h) => h.term)).size, hits.length);
});
