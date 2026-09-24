import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { statesAPlusAge, barePlusAge } from "../ages";
import { listingFacts } from "../catalog";
import { minAge } from "../listingDerive";
import type { Unclaimed } from "../../data/types";

/**
 * "Who can go" used to ask for `\d+\+` inside a `\b(...)\b`, and the group's own trailing boundary made that
 * alternative read the wrong lines and only the wrong ones. "21+" and "18+" end at a space or a full stop,
 * where there is no word boundary after the "+", so no bare age rule ever reached the column; what did reach
 * it was a number glued to a word, which is a fee or a speed and never an age.
 */

function whoOf(spec: string): string[] {
  const item = { specs: [spec], gap: "", options: [] } as unknown as Unclaimed;
  return listingFacts(item).who.filter((l) => l.posted).map((l) => l.text);
}

test("a bare N+ with a person behind it is a rule about who can go", () => {
  for (const line of [
    "18+ with valid photo ID required to drive",
    "Must be 21+ to attend",
    "Guests 21+ can bring alcohol",
    "Anyone aged 18+ can rent a boat",
    "Waverunner operators must be 21+ and carry a valid Driver's License",
    "Alcohol served only to guests 21+ with valid ID",
    "21+ after 9pm no exceptions",
    "Jet skis: renter 21+, operator 16+",
    "Must be 21+ years to rent boats; copy of driver's license required",
  ]) {
    assert.ok(statesAPlusAge(line), `"${line}" states an age`);
    assert.equal(whoOf(line).length, 1, `"${line}" belongs under Who can go`);
  }
});

test("a fee, a speed and a tax are not an age", () => {
  for (const line of [
    "$50+tax fee for cancellations or changes less than 24h before",
    "Security deposit $300+taxes, refundable if no damages",
    "Season Pass refunds only before season start, less $65+GST fee",
    "Late returns charged $2.00+tax per minute per boat",
    "If the winds are unsafe (35+mph sustained), proceed to the docks",
    "Original Hot Yoga (26+2) classes",
  ]) {
    assert.ok(!statesAPlusAge(line), `"${line}" is not an age rule`);
  }
});

test("a number sizing a group, a purchase or the shop's own stock is not an age", () => {
  for (const line of [
    "Field trips for groups 10+ require booking",
    "Group discounts for 3+ skis",
    "Discounts for groups: 8+ tickets $1 off each",
    "Group booking special: ride free with 10+ paying riders",
    "Private group booking option for 8+ participants.",
    "Bookings of 15+ participants require 20% non-refundable deposit",
    "8+ years of hands-on experience and a 5.0 Google rating",
    "Experienced guides with 20+ years local knowledge",
    "20+ craft beers brewed on-site",
    "16+ taps at each location with a wide variety of beer styles",
  ]) {
    assert.ok(!statesAPlusAge(line), `"${line}" counts something other than years of life`);
    assert.deepEqual(whoOf(line), [], `"${line}" is not a rule about who can go`);
  }
});

/** The floor a listing prints in its key facts still reads the same number off a line that names one. */
test("the minimum age reader keeps its own answers", () => {
  assert.equal(minAge(["Must be 18+"]), 18);
  assert.equal(minAge(["Minimum age: 8 years"]), 8);
  assert.equal(minAge(["ages 6 and up"]), 6);
  assert.equal(minAge(["Supported devices: iPhone with iOS 15+"]), null);
  assert.equal(minAge(["Not recommended for travelers who cannot walk 3+ miles"]), null);
  assert.equal(minAge(["Guests under 21 not permitted on 21+ cruises"]), 21);
  assert.equal(barePlusAge("USTA rating 3.5+"), null);
});

/** Over the whole shipped catalog: nothing reaches the column on a dollar sign or a speed. */
test("no shipped listing reads a fee or a speed as an age", () => {
  const dir = path.join(process.cwd(), "public", "o");
  if (!fs.existsSync(dir)) return;
  const bad: string[] = [];
  let checked = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.startsWith("o-"))) {
    const u = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Unclaimed;
    checked++;
    for (const line of listingFacts(u).who) {
      if (!line.posted) continue;
      if (/[$£€]\s?\d{1,3}(?:\.\d\d)?\s*\+|\d+\s*\+\s*(?:mph|kph|GST|HST|tax)/i.test(line.text)) bad.push(f + " | " + line.text);
    }
  }
  assert.ok(checked > 1000, "the shipped catalog was read");
  assert.deepEqual(bad.slice(0, 10), [], bad.length + " fees and speeds still read as an age");
});
