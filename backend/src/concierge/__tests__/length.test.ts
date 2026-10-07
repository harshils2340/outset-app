import { strict as assert } from "node:assert";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A length a guest states is a length, not a headcount, however they punctuate it.
 *
 * "looking for a 90-minute massage" came back as a party of ninety with `partyStated` set, so the agent quoted
 * ninety heads and never asked how many; "for a 1-hour room" was a party of one at an escape room with a
 * minimum of two. The same sentences written with a space read correctly, so the hyphen was the whole of it.
 * And the reader that decides whether to ask "how long?" could not reach three figures or cross a hyphen, and
 * its closing boundary sat straight after "min", so it refused every "minute" and "minutes" ever written.
 */
process.env.OUTSET_DB = join(mkdtempSync(join(tmpdir(), "outset-length-")), "catalog.db");
const { migrate } = await import("../../db/client.ts");
const { readIntent } = await import("../plan.ts");
const { STATED_LENGTH, known, nextNeed } = await import("../needs.ts");

migrate();

test("a hyphenated length is never read as a headcount", () => {
  for (const [sentence, party] of [
    ["looking for a 90-minute massage in tampa", 2],
    ["fishing charter in tampa for a 4-hour trip", 2],
    ["jet ski in tampa for a 2-hour rental", 2],
    ["escape room in waterloo for a 1-hour room", 2],
    ["kayak rental for 3-days in tampa", 2],
    ["spa in toronto for a 45-min treatment", 2],
  ] as [string, number][]) {
    const i = readIntent(sentence);
    assert.equal(i.party, party, sentence);
    assert.ok(!i.partyStated, "a length never counts as a party stated: " + sentence);
  }
});

test("a headcount is still a headcount, and a spaced length still is not", () => {
  for (const [sentence, party, stated] of [
    ["escape room in waterloo for 4 of us", 4, true],
    ["escape room in waterloo for 4", 4, true],
    ["axe throwing in toronto, party of six", 6, true],
    ["offsite for a group of 10 near me", 10, true],
    ["2 adults and 3 kids, trampoline park in tampa", 5, true],
    ["fishing charter in tampa for 4 hours", 2, false],
    ["kayak in tampa for 3 days", 2, false],
    ["pontoon in tampa for a 2 hour rental", 2, false],
  ] as [string, number, boolean][]) {
    const i = readIntent(sentence);
    assert.equal(i.party, party, sentence);
    assert.equal(!!i.partyStated, stated, sentence);
  }
});

test("a length the guest already stated is never asked for again", () => {
  for (const said of [
    "90 minute massage",
    "90-minute massage",
    "a 120 minute massage",
    "30-minute deep tissue",
    "45 mins please",
    "2 hour massage",
    "2-hr treatment",
    "a 2h sauna",
    "half day charter",
    "half-day charter",
    "full-day trip",
    "overnight trip",
  ]) assert.ok(STATED_LENGTH.test(said), "a stated length: " + said);
  for (const notSaid of [
    "massage in toronto",
    "escape room for 4 of us",
    "axe throwing, $120 minimum spend",
    "boat tour for 4 hamburgers",
  ]) assert.ok(!STATED_LENGTH.test(notSaid), "not a stated length: " + notSaid);
});

test("the spa guest who said how long is asked something else", () => {
  const asked = readIntent("spa in toronto for a 120 minute massage");
  assert.ok(known(asked, "duration"), "120 minutes is a length");
  assert.notEqual(nextNeed(asked)?.id, "duration", "never ask what the guest already said");
});
