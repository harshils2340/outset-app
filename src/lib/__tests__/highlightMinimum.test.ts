import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { listingFacts } from "../catalog";
import type { Unclaimed } from "../../data/types";

/**
 * `listingFacts().about` has one reader: the highlights a listing leads with when the shop publishes none of
 * its own, drawn under "Highlights" on the desktop page and a ticked "What you'll do" on the phone booking
 * sheet. Our own vendor readers write one "<item>: minimum N guests per booking." per menu row, and 739 of
 * them on 261 listings were being sold to a guest as the thing they would do.
 */

function facts(specs: string[]) {
  return listingFacts({ specs, gap: "", options: [] } as unknown as Unclaimed);
}

test("a booking system's party floor is not a highlight", () => {
  for (const line of [
    "Parasailing: minimum 2 guests per booking.",
    "Memphis Mojo Tour: the Best of Memphis: minimum 2 guests per booking.",
    '"The 4:30": minimum 2 guests per booking.',
    "Minimum 4 players per booking",
    "Kealakekua Bay Kayak and Snorkel Tour: minimum 6 guests per booking.",
  ]) {
    assert.deepEqual(facts([line]).about, [], `"${line}" is a booking rule, not a highlight`);
  }
});

test("a line that says anything else as well is the shop's own words and stays", () => {
  for (const line of [
    "Up to 4 passengers per flight, minimum 2 people per booking",
    "Common areas cannot accommodate more than 8 people per booking",
    "Private games available with $40 upgrade per booking",
    "Boats hold up to 5 people",
  ]) {
    assert.deepEqual(facts([line]).about, [line], `"${line}" is a fact worth reading`);
  }
});

/** The whole shipped catalog: no listing leads its highlights with a per-booking party floor. */
test("no shipped listing sells a booking minimum as a highlight", () => {
  const dir = path.join(process.cwd(), "public", "o");
  if (!fs.existsSync(dir)) return;
  const bad: string[] = [];
  let checked = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.startsWith("o-"))) {
    const u = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Unclaimed;
    if (u.highlights?.length) continue;
    checked++;
    for (const line of listingFacts(u).about.slice(0, 6)) {
      if (/minimum\s+\d+\s+\w+\s+per\s+booking/i.test(line)) bad.push(f + " | " + line);
    }
  }
  assert.ok(checked > 1000, "the shipped catalog was read");
  assert.deepEqual(bad.slice(0, 10), [], bad.length + " booking minimums still head a listing's highlights");
});
