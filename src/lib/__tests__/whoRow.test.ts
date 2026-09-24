import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { listingFacts } from "../catalog";
import type { Unclaimed } from "../../data/types";

/**
 * The "Who can go" column takes a line off a menu row only when the row states a rule. A price tier's own name
 * is not one: "Kids Karate", "Admission: Children", "Tickets: Child" say nothing about who may come, and 1,501
 * of them were printed as the shop's own eligibility rule before this rule landed.
 */

function item(options: { name: string; detail: string }[]): Unclaimed {
  return { specs: [], gap: "", options } as unknown as Unclaimed;
}

function whoFrom(name: string, detail = ""): string[] {
  return listingFacts(item([{ name, detail }])).who.filter((l) => l.posted).map((l) => l.text);
}

test("a price tier's name is not a rule about who can go", () => {
  for (const [name, detail] of [
    ["Kids Karate", ""],
    ["Admission", "Children"],
    ["Tickets", "Child"],
    ["Rental Fleet", "Child Seat"],
    ["Junior Explorers", "35 hours"],
    ["Memberships", "Child/youth"],
    ["Kids BJJ", "Trial class"],
    ["After School Junior Program", "Adult Pickleball Classes"],
  ] as const) {
    assert.deepEqual(whoFrom(name, detail), [], `"${name}: ${detail}" is a menu row, not a rule`);
  }
});

test("a row that states an age, a height or an adult's company is kept", () => {
  assert.deepEqual(whoFrom("Whale Watching", "Children (8-12)"), ["Whale Watching: Children (8-12)."]);
  assert.equal(whoFrom("Private Lessons (Ages 3+)").length, 1);
  assert.equal(whoFrom("Junior Rate 18 Holes with Cart", "18 holes with cart for juniors 17 & under").length, 1);
  assert.equal(whoFrom("Buy Tickets", "Adult (Age 18 & Older)").length, 1);
  assert.equal(whoFrom("Child admission (3-10)").length, 1, "one word may sit between the person and the band");
  assert.equal(whoFrom("CHILD ticket (5-12)", "children under the age of 5 not permitted to sail").length, 1);
  assert.equal(whoFrom("Shorty 40\" Ticket", "For children 40\" & under.").length, 1);
  assert.equal(whoFrom("Bumper Boat Ride", "One 5-minute ride; children under 8 and/or 44\" must ride with adult").length, 1);
});

test("a number beside a person word that counts something else is not an age", () => {
  assert.deepEqual(whoFrom("Junior 18 Holes", "18 holes walking only, no cart operation"), []);
  assert.deepEqual(whoFrom("Open Boat | Trips For Kids", "3.5 hours"), []);
  assert.deepEqual(whoFrom("Public Tours 30-Minute Child or Senior", "30-minute public tour for child or senior"), []);
  assert.deepEqual(whoFrom("Private Airboat Tour", "$65 each additional adult, $45 per child"), []);
  assert.deepEqual(whoFrom("Horses and Friends 101", "Introduction to horses for children 5th-8th grade"), []);
  assert.deepEqual(whoFrom("GNCC Junior Camp 2026", "Junior curling camp with meals provided"), []);
  assert.deepEqual(whoFrom("Kids Classes", "6 classes a month"), []);
  assert.deepEqual(whoFrom("Motorized boat rental", "Motorized boat rental for 4 adults or 2 adults + 3 children"), []);
  assert.deepEqual(whoFrom("Register for Classes", "Junior classes: 3:45 p.m. - 5:45 p.m"), []);
});

/**
 * Over the whole shipped catalog: no menu row reaches the column without stating an age, a height or an
 * adult's company, and the column still falls back to its own honest gap line when nothing is posted.
 */
test("no shipped listing heads Who can go with a bare tier name", () => {
  const dir = path.join(process.cwd(), "public", "o");
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter((f) => f.startsWith("o-"));
  const NUMBERLESS_TIER = /^(?:[A-Za-z'’/&-]+\s+){0,2}[A-Za-z'’/&-]+\.$/;
  const bad: string[] = [];
  for (const f of files) {
    const u = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Unclaimed;
    const facts = listingFacts(u);
    assert.ok(facts.who.length, f + " always says something under Who can go");
    const fromRow = new Set((u.options || []).map((o) => (o.detail ? o.name + ": " + o.detail : o.name)));
    for (const line of facts.who) {
      if (!line.posted) continue;
      const raw = line.text.replace(/\.$/, "");
      if (!fromRow.has(raw) && !fromRow.has(line.text)) continue;
      if (!/\d/.test(line.text) && !/accompan|adult required|adult & junior/i.test(line.text)) bad.push(f + " | " + line.text);
      else if (NUMBERLESS_TIER.test(line.text)) bad.push(f + " | " + line.text);
    }
  }
  assert.deepEqual(bad.slice(0, 10), [], bad.length + " menu rows still read as a rule about who can go");
});
