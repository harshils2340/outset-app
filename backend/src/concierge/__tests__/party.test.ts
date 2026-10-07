import { strict as assert } from "node:assert";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A headcount nobody could book here leaves the party unstated, so the agent asks and the answer owns its guess.
 *
 * The range check replaced an out-of-range figure with two and `saidParty` counted the sentence as having
 * stated a party anyway: "600 people, escape room in waterloo" came back quoted for two, was never asked how
 * many, and the answer did not say it had assumed two, because it only says that when nothing was stated.
 */
process.env.OUTSET_DB = join(mkdtempSync(join(tmpdir(), "outset-party-")), "catalog.db");
const { migrate } = await import("../../db/client.ts");
const { readIntent } = await import("../plan.ts");
const { nextNeed } = await import("../needs.ts");

migrate();

test("a party too big or too small to book is not a party stated", () => {
  for (const sentence of [
    "escape room in waterloo for 600 people",
    "escape room in waterloo for 501 people",
    "600 people, escape room in waterloo",
    "team offsite in waterloo for 999",
    "escape room in waterloo for 0 people",
  ]) {
    const i = readIntent(sentence);
    assert.equal(i.party, 2, "the fallback is still two: " + sentence);
    assert.ok(!i.partyStated, "a figure we refuse is not an answer: " + sentence);
    assert.equal(nextNeed(i)?.id, "party", "so it is asked: " + sentence);
  }
});

test("a party inside the range is still read and still stated", () => {
  for (const [sentence, party] of [
    ["escape room in waterloo for 500 people", 500],
    ["escape room in waterloo for 1 person", 1],
    ["escape room in waterloo for 4 of us", 4],
    ["axe throwing in toronto, party of six", 6],
    ["offsite for a group of 10 near me", 10],
    ["2 adults and 3 kids, trampoline park in tampa", 5],
    ["kayak in waterloo for me and my dad", 2],
  ] as [string, number][]) {
    const i = readIntent(sentence);
    assert.equal(i.party, party, sentence);
    assert.ok(i.partyStated, sentence);
  }
});

test("an age is not a headcount", () => {
  for (const sentence of [
    "escape room in waterloo for 8-year-olds",
    "escape room in waterloo for a 10 year old",
    "trampoline park in tampa for 6-year-olds",
    "go karts in orlando for a 12-year-old birthday",
    "soft play in tampa for an 18 month old",
  ]) {
    const i = readIntent(sentence);
    assert.equal(i.party, 2, sentence);
    assert.ok(!i.partyStated, "an age is not a party stated: " + sentence);
    assert.equal(nextNeed(i)?.id, "party", "so it is asked: " + sentence);
  }
  const both = readIntent("escape room in waterloo for 4 kids aged 8");
  assert.equal(both.party, 4, "a sentence that states both still counts the heads");
  assert.ok(both.partyStated);
});

test("a sentence that counts no heads is still unstated, as before", () => {
  for (const sentence of ["escape room in waterloo", "escape room in waterloo tonight", "fishing charter in tampa for 4 hours"]) {
    const i = readIntent(sentence);
    assert.equal(i.party, 2, sentence);
    assert.ok(!i.partyStated, sentence);
  }
});
