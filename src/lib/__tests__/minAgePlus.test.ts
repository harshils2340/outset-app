import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

import { minAge } from "../listingDerive";
import type { Unclaimed } from "../../data/types";

/**
 * "Ages N+" off a line where N counts something that is not years.
 *
 * `minAge` reads an age word beside the number first, and falls back to a bare "N+" because that is how a shop
 * most often writes the rule: "Adults only 18+", "This experience is 21+". The fallback took the first "N+"
 * anywhere in the line, whatever it counted, so 55 shipped listings printed an age nobody had published. The
 * listing page, the phone sheet and Otto all read this one function, so all three said it.
 *
 * Every case below is a real listing in `public/o` and names the one it came from.
 */

const dir = new URL("../../../public/o/", import.meta.url);
const listing = (id: string) => JSON.parse(readFileSync(new URL(id + ".json", dir), "utf8")) as Unclaimed;

/* ---------- a number that counts something other than years ---------- */

test("a phone's software version is not a minimum age", () => {
  // 22 self-guided tours carry Viator's device note. The page put "Ages 15+" on every one of them.
  const j = listing("a-viator-259177p1");
  assert.match(j.requirements!.join(" "), /iPhone with iOS 15\+/, "the line changed, so this case needs a new listing");
  assert.equal(minAge(j.requirements!), null);
});

test("a group size is not a minimum age", () => {
  const cases: [string, RegExp][] = [
    ["a-viator-337938p1", /Groups Of 7\+ Passengers/i], // 19 charters read as "Ages 7+"
    ["a-viator-329560p5", /Groups of 4\+ may be split/i], // 5 helicopter flights read as "Ages 4+"
    ["a-viator-5578913p10", /Planning for 7\+ people/i],
  ];
  for (const [id, line] of cases) {
    const j = listing(id);
    assert.match(j.requirements!.join(" "), line, id + " no longer carries that line, so this case needs a new listing");
    assert.equal(minAge(j.requirements!), null, id);
  }
});

test("a distance, a booking window, a course load and a tax line are not minimum ages", () => {
  // The last one publishes an age of its own, on another line, and that is the one the page prints now.
  const cases: [string, RegExp, number | null][] = [
    ["a-viator-31018p2", /cannot walk 3\+ miles/i, null], // a walking tour read as "Ages 3+"
    ["o-bigtexboatrentals-com", /made 15\+ days before your trip/i, null], // a reschedule window
    ["o-capital-adventuresunbound-com", /3\+ nights in 7 days/i, null],
    ["o-rentchicagoboats-com", /2\+ years boating experience/i, null],
    ["o-bridgesrockgym-com", /enrolled in 12\+ units/i, 16], // a student discount, then "classes are for participants aged 16+"
  ];
  for (const [id, line, expected] of cases) {
    const j = listing(id);
    assert.match(j.requirements!.join(" "), line, id + " no longer carries that line, so this case needs a new listing");
    assert.equal(minAge(j.requirements!), expected, id);
  }
});

test("a decimal's tail is not a number of its own", () => {
  // o-bridgemillathleticclub-com: "USTA rating 3.5+ for Doubles Drills" was read as an age of 5. The club does
  // publish one, on the line under it, and that is the one the page prints now.
  const j = listing("o-bridgemillathleticclub-com");
  assert.match(j.requirements!.join(" "), /USTA rating 3\.5\+/);
  assert.equal(minAge(j.requirements!), 4, "\"Participants must be age 4 and older for swimming lessons\"");
});

/* ---------- and the line that really is an age still is one ---------- */

test("a bare age the shop wrote as N+ is still read", () => {
  const cases: [string, number][] = [
    ["a-viator-28758p4", 18], // "Only Adults 18+"
    ["a-viator-5645371p1", 21], // "This experience is 21+"
    ["a-viator-35926p11", 6], // "6+ years of age can participate"
    ["o-belmartikiboat-com", 14], // "14+ years old for F-Cove Public Swimming Cruise"
    ["o-charlestongameshow-com", 21], // "Groups of 4 to 20+ players", then "Adult game show is 21+"
    ["o-fishingseattle-com", 5], // "$1,600 for 6 +tax", then "recommended minimum age 5 years"
  ];
  for (const [id, expected] of cases) {
    assert.equal(minAge(listing(id).requirements || []), expected, id);
  }
});

/* ---------- over the whole shipped catalog ---------- */

test("no shipped listing takes its age off a line that says what else the number counts", () => {
  // The shapes the fallback was wrong about, held against the line each printed age actually came from.
  // A shop that writes the age itself is out of scope here: "for age 21+ passengers only" is a drinking rule
  // read off the age word, which is the branch above this one.
  const COUNTING = /\b(?:iOS|Android with version)\s*\d{1,2}\s*\+|\bgroups? of\s*\d{1,2}\s*\+|(?<![\d.])(?<!\bages?\s)\d{1,2}\s*\+\s*(?:passengers|people|players|miles|units|nights|days before)|\d{1,2}\s\+tax/i;
  const wrong: string[] = [];
  let printed = 0;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    let j: Unclaimed;
    try {
      j = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as Unclaimed;
    } catch {
      continue;
    }
    const req = j.requirements || [];
    const n = minAge(req);
    if (n == null) continue;
    printed++;
    const line = req.find((l) => minAge([l]) === n);
    if (line && COUNTING.test(line)) wrong.push(j.id + ": Ages " + n + "+ off \"" + line.slice(0, 80) + "\"");
  }
  assert.ok(printed > 1000, "only " + printed + " shipped listings print a minimum age");
  assert.deepEqual(wrong.slice(0, 10), [], wrong.length + " listings print an age off a number counting something else");
});
