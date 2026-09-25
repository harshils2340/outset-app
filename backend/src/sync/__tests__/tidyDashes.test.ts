import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

/**
 * A day of the week and a clock time are ranges too, and were falling through to the punctuation rule: the
 * Seattle Aquarium's highlight shipped as "Open daily 9:30am, 6pm, 365 days a year", and a shop's deal reading
 * "Rentals Sunday - Wednesday" would have been published as two sentences.
 */
test("a day of the week on each side is a range", () => {
  assert.equal(tidyDashes("30% Off Cabin and Boat Rentals Sunday – Wednesday."), "30% Off Cabin and Boat Rentals Sunday to Wednesday.");
  assert.equal(tidyDashes("20% off rentals Tuesday — Thursday."), "20% off rentals Tuesday to Thursday.");
  assert.equal(tidyDashes("Open Mon. – Fri."), "Open Mon to Fri.");
  // The day has to be on both sides: a dash before a price is still punctuation.
  assert.equal(tidyDashes("Monday Morning Madness – $5 off regular priced tickets."), "Monday Morning Madness, $5 off regular priced tickets.");
});

test("a clock time on each side is a range", () => {
  assert.equal(tidyDashes("Open daily 9:30am–6pm, 365 days a year"), "Open daily 9:30am to 6pm, 365 days a year");
  assert.equal(tidyDashes("Rentals 8 a.m. – 5 p.m."), "Rentals 8 a.m. to 5 p.m.");
  assert.equal(tidyDashes("Sunday Social 10am — 4pm"), "Sunday Social 10am to 4pm");
});

test("the deals a shop publishes go through the same rule", () => {
  const src = readFileSync(new URL("../contacts.ts", import.meta.url), "utf8");
  assert.match(src, /const title = tidyDashes\(d\.title\);/);
  assert.match(src, /const detail = d\.detail \? tidyDashes\(d\.detail\) : "";/);
});
