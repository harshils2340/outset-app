import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

import { companyReply } from "../companyAgent";
import { minAge } from "../listingDerive";
import type { Unclaimed } from "../../data/types";

/**
 * The youngest guest a shop takes, as the listing page prints it and as Otto answers it.
 *
 * There were three readers. The page's `minAge` wants an age word beside the number and keeps it between 2 and
 * 21. Otto had two of its own that wanted neither, so any number within a few characters of "must be at least"
 * became an age: a height in inches, a check-in window in minutes, a cancellation window in days, the age on a
 * senior ticket. They disagreed with the page on 83 of the 1,210 shipped listings where both had a number.
 *
 * Every case below is a real listing in `public/o` and names the one it came from.
 */

const dir = new URL("../../../public/o/", import.meta.url);
const listing = (id: string) => JSON.parse(readFileSync(new URL(id + ".json", dir), "utf8")) as Unclaimed;
const ask = (id: string, q = "is my 8 year old ok?") => companyReply({ item: listing(id), contact: null }, q);

/* ---------- a number that is not an age ---------- */

test("a height in inches is not a minimum age", () => {
  // o-acadiafun-com: "Children must be at least 48 inches tall to paddle in any of our kayak tours." Because
  // the line names the tour, Otto scoped it and told a parent "Not for Kayak Tour (48+)".
  const j = listing("o-acadiafun-com");
  assert.match(j.requirements!.join(" "), /at least 48 inches tall/i, "the line changed, so this case needs a new listing");
  assert.equal(minAge(j.requirements!), 12, "the page reads the age line, not the height one");
  const said = ask("o-acadiafun-com");
  assert.doesNotMatch(said, /48/);
  assert.match(said, /minimum age is 12/);
});

test("a check-in window, a cancellation window and a senior fare are not minimum ages", () => {
  const cases: [string, RegExp, number][] = [
    ["o-baysideboatrentals-com", /30 minutes prior/i, 18], // "You must be arrive 30 minutes prior"
    ["o-beachytiki-com", /canceled 14 days in advance/i, 2], // a refund window
    ["o-brandywinezoo-org", /Seniors \(ages 62\+\)/i, 21], // a ticket price row
  ];
  for (const [id, line, expected] of cases) {
    const j = listing(id);
    const all = [...(j.requirements || []), ...(j.policies || []), ...j.specs].join(" | ");
    assert.match(all, line, id + " no longer carries that line, so this case needs a new listing");
    assert.match(ask(id), new RegExp("minimum age is " + expected + "\\b"), id);
  }
});

/* ---------- and the page and Otto name one number ---------- */

test("no shipped listing has the page and Otto naming different minimum ages", () => {
  let checked = 0;
  const wrong: string[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    let j: Unclaimed;
    try {
      j = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as Unclaimed;
    } catch {
      continue;
    }
    const page = minAge(j.requirements || []);
    if (page == null) continue;
    const m = companyReply({ item: j, contact: null }, "is my 8 year old ok?").match(/minimum age is (\d{1,2})/);
    if (!m) continue;
    checked++;
    if (Number(m[1]) !== page) wrong.push(j.id + ": page " + page + ", Otto " + m[1]);
  }
  assert.ok(checked > 800, "only " + checked + " listings had both a printed age and an Otto number");
  assert.deepEqual(wrong.slice(0, 10), [], wrong.length + " listings name two different minimum ages");
});

test("no shipped listing has Otto quoting an age nobody could be", () => {
  const silly: string[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    let j: Unclaimed;
    try {
      j = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as Unclaimed;
    } catch {
      continue;
    }
    const said = companyReply({ item: j, contact: null }, "is my 8 year old ok?");
    // Both shapes Otto prints a number in: the whole-shop rule and the per-experience one.
    for (const m of said.matchAll(/minimum age is (\d{1,3})|\((\d{1,3})\+\)|\bis (\d{1,3})\+/g)) {
      const n = Number(m[1] || m[2] || m[3]);
      if (n < 2 || n > 21) silly.push(j.id + ": " + said.slice(0, 90));
    }
  }
  assert.deepEqual(silly.slice(0, 10), [], silly.length + " listings quote an age outside 2 to 21");
});
