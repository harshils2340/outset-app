import { test } from "node:test";
import assert from "node:assert/strict";
import { CATEGORIES, familyForArt } from "../catalog.ts";

/**
 * The app cuts its browse tabs by family and draws the chips inside them by kind, so a listing whose family is
 * not its own kind's family sits in a tab its chip does not appear in. The sync used to keep discovery's family
 * unless `reconcileArt` moved the kind, and a name settles the kind too, which on 18 September 2026 left 529
 * shipped listings in the wrong tab: 119 parasail operators under Water rather than Air, 198 airboat and swamp
 * tours under Water rather than Outdoor, and a brewery, a museum and four RV parks scattered further still.
 */
test("the family follows the kind, whatever discovery filed the listing under", () => {
  assert.equal(familyForArt("parasail", "water"), "air");
  assert.equal(familyForArt("tour", "water"), "outdoor");
  assert.equal(familyForArt("escape", "wellness"), "indoor");
  assert.equal(familyForArt("horse", "food"), "outdoor");
  assert.equal(familyForArt("kart", "play"), "motorsport");
  assert.equal(familyForArt("fishing", "outdoor"), "water");
  // A kind this file does not define keeps whatever it arrived with.
  assert.equal(familyForArt("sleighride", "outdoor"), "outdoor");
  assert.equal(familyForArt("sleighride", null), null);
});

test("every category the taxonomy defines sits in a family the app draws a tab for", () => {
  const tabs = new Set(["air", "water", "motorsport", "indoor", "outdoor", "play", "food", "wellness"]);
  for (const c of CATEGORIES) {
    assert.ok(tabs.has(c.family), c.id + " is in family " + c.family + ", which is not a tab");
    assert.equal(familyForArt(c.id, "play"), c.family, c.id);
  }
});
