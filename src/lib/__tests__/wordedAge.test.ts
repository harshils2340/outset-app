import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { statesAPlusAge, statesAWordedAge } from "../ages";
import { listingFacts } from "../catalog";
import type { Unclaimed } from "../../data/types";

/**
 * A shop states its floor as a sentence about the guest and never writes the word "age": "Must be 21 or older
 * to consume alcohol", "Go Kart driver must be 18 or older", "Participants must be 12 years or older for Intro
 * Lesson". "Who can go" asked a line for an age word or a bare "N+", and this shape has neither, so 282 lines
 * on 245 shipped listings were filed as a thing the trip is and printed as a selling highlight instead: under
 * "Highlights" on the listing page and a ticked "What you'll do" on the phone booking sheet.
 *
 * On 63 of those listings it is the only rule the shop posted at all, so the column said "Age, weight and kid
 * rules are not posted on their site" on the same page that led with "Must be 21 or older to enter tasting
 * room" as a reason to come.
 */

function factsOf(spec: string) {
  return listingFacts({ specs: [spec], gap: "", options: [] } as unknown as Unclaimed);
}
const whoOf = (spec: string) => factsOf(spec).who.filter((l) => l.posted).map((l) => l.text);

test("a floor stated as a sentence about the guest is a rule about who can go", () => {
  for (const line of [
    "Must be 21 or older to consume alcohol",
    "Must be 21 years or older to enter tasting room",
    "Go Kart driver must be 18 or older",
    "Participants must be 12 years or older for Intro Lesson",
    "Must be 21 and over to attend Oktoberfest events",
    "Renters must be 21 years or older",
    "Must be 25 or older with a valid driver's licence to rent a boat",
    "Baby participants must be at least 1 year old and able to hold their head upright",
  ]) {
    assert.ok(statesAWordedAge(line), `"${line}" states an age`);
    assert.deepEqual(whoOf(line).length, 1, `"${line}" belongs under Who can go`);
    assert.deepEqual(factsOf(line).about, [], `"${line}" is not a selling point`);
  }
});

test("a length, a lead time and a party size stated the same way are not an age", () => {
  for (const line of [
    "Boats must be 20 feet or longer to use the ramp",
    "Reservations must be 48 hours or more in advance",
    "Groups must be 10 or more to book the room",
    "Deposits must be 50 percent of the total",
    "Must be a member to book the lane",
  ]) {
    assert.ok(!statesAWordedAge(line), `"${line}" states no age`);
  }
});

test("the rule reads the shipped catalog and nothing it moves is anything but an age", () => {
  // Resolved off this file, never off the working directory: the rehearsal runs these tests from its own.
  const dir = new URL("../../../public/o/", import.meta.url);
  const shape = /\bmust be(?: at least)?\s*\d{1,2}\s*(?:\+|and (?:up|over|older)|years?(?: old| of age)?|yrs|or (?:older|over|above))/i;
  let moved = 0;
  const listings = new Set<string>();
  for (const f of readdirSync(dir)) {
    const d = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as { id: string; specs?: string[] };
    for (const line of d.specs || []) {
      if (!statesAWordedAge(line) || statesAPlusAge(line)) continue;
      // Every line the new cue alone moves has to carry the cue whole: the number, and the words after it
      // that say it counts years. Nothing else may reach the column through this rule.
      if (!/\b(ages?|years old)\b/i.test(line)) {
        assert.match(line, shape, d.id + " moved a line that states no age: " + line);
        moved++;
        listings.add(d.id);
      }
    }
  }
  assert.ok(moved > 250, "lines the cue moves out of the highlights: " + moved);
  assert.ok(listings.size > 200, "listings with one: " + listings.size);
});
