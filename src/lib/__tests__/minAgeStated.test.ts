import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { listingFacts } from "../catalog";
import { minAge } from "../listingDerive";
import type { Unclaimed } from "../../data/types";

/**
 * A shop that has written the words "minimum age" has already said the number is a floor, so it needs nothing
 * after it. One regex asked every cue for the same trailing "+", "years" or "or older", and 86 listings that
 * state the rule in plain English printed no age at all on the listing page, the phone sheet or in Otto.
 */

test("a stated minimum age needs no words after the number", () => {
  assert.equal(minAge(["Minimum age 8"]), 8);
  assert.equal(minAge(["Minimum age 10 for Traditional and Low Impact Paintball"]), 10);
  assert.equal(minAge(["Minimum age 16 to enter without adult supervision"]), 16);
  assert.equal(minAge(["Level 3 minimum age is 19"]), 19);
  assert.equal(minAge(["Recommended minimum age 5 for ballroom dancing"]), 5);
  assert.equal(minAge(["Adult pricing applies to all travelers (minimum age is 8-years old)"]), 8);
  assert.equal(minAge(["min age: 12"]), 12);
});

test("a number that is not a stated minimum age is still refused", () => {
  assert.equal(minAge(["Minimum age 25 to rent some boats"]), null, "above the floor this reader will print");
  assert.equal(minAge(["Minimum 2 guests per booking."]), null);
  assert.equal(minAge(["Minimum spend of 50 per group"]), null);
  assert.equal(minAge(["No minimum age for the aquarium"]), null);
});

/**
 * The cue runs only after the looser ones have read the whole list, so it adds an age where there was none and
 * never changes one: `minAge` returns the first line that yields a number rather than the lowest, and on a
 * shop selling more than one thing the two are not the same.
 */
test("a listing that already states an age another way keeps it", () => {
  const lines = ["Birthday party climbers must be at least 5 years old", "To belay, minimum age 13 for belaying"];
  assert.equal(minAge(lines), 5);
  assert.equal(minAge(["Summer camp ages 8+ (12+ for last sessions)", "Minimum age 5 for birthday parties"]), 8);
});

/** Over the shipped catalog: a listing whose own rules state a floor prints one. */
test("no shipped listing states a minimum age and prints none", () => {
  const dir = path.join(process.cwd(), "public", "o");
  if (!fs.existsSync(dir)) return;
  const STATED = /\bmin(?:imum)?\.?\s*age(?:\s+is|\s*:|\s+of)?\s*(\d{1,2})\b/i;
  const silent: string[] = [];
  let printed = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const u = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Unclaimed;
    const facts = listingFacts(u);
    const req = u.requirements?.length ? u.requirements : facts.who.filter((l) => l.posted).map((l) => l.text);
    if (minAge(req) != null) {
      printed++;
      continue;
    }
    const hit = req.find((r) => {
      const m = STATED.exec(r);
      return m ? Number(m[1]) >= 2 && Number(m[1]) <= 21 : false;
    });
    if (hit) silent.push(f + " | " + hit.slice(0, 90));
  }
  assert.ok(printed > 1000, "only " + printed + " shipped listings print a minimum age");
  assert.deepEqual(silent.slice(0, 10), [], silent.length + " listings state a minimum age and print none");
});
