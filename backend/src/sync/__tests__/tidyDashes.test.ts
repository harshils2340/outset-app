import { test } from "node:test";
import assert from "node:assert/strict";
import { tidyDashes } from "../contacts.ts";

/**
 * 2,551 published listings carried an em or en dash inside `specs` or `highlights`, straight from the operator's
 * own site text; AGENTS.md bans the em dash in the app's own copy. A number or month on each side is a range and
 * reads as "to"; anything else was a separator and reads as a comma or a period, the substitutes AGENTS.md names.
 */
test("a numeric range keeps its meaning as \"to\"", () => {
  assert.equal(
    tidyDashes("Target species include Walleye (May–October), Smallmouth Bass (June–October)"),
    "Target species include Walleye (May to October), Smallmouth Bass (June to October)",
  );
  assert.equal(tidyDashes("Children 2–15 years old must be accompanied by an adult."), "Children 2 to 15 years old must be accompanied by an adult.");
  assert.equal(tidyDashes("Mandatory 20–30 minute orientation at launch ramp"), "Mandatory 20 to 30 minute orientation at launch ramp");
  assert.equal(tidyDashes("Combined weight 150–450 lbs per flight"), "Combined weight 150 to 450 lbs per flight");
});

test("a dash used as punctuation reads as a comma or a period, never a dash", () => {
  assert.equal(tidyDashes("Fully private charters – no crowds"), "Fully private charters, no crowds");
  assert.equal(
    tidyDashes("Jet Ski Tours – Failure to comply will result in forfeiting of the deposit."),
    "Jet Ski Tours. Failure to comply will result in forfeiting of the deposit.",
  );
  assert.ok(!/[–—]/.test(tidyDashes("Full Day Trip – Chuckanut Bay (5 Hours): minimum 2 guests per booking.")));
});

test("text with no dash is untouched", () => {
  assert.equal(tidyDashes("Rooms hold 8 to 10 players; some rooms hold up to 12"), "Rooms hold 8 to 10 players; some rooms hold up to 12");
});
