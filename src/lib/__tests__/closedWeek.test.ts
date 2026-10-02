import assert from "node:assert/strict";
import test from "node:test";
import type { Unclaimed } from "../../data/types";
import { defaultProfile, toCatalog } from "../operator";
import { closedOnDay } from "../startTimes";
import { itemWeek } from "../openNow";

/**
 * A shop that has closed its whole week.
 *
 * "Apply to all" on a closed day is a deliberate, guarded gesture in the dashboard: it asks for a second
 * click and then says "Closed every day". A dive shop out of the water for the winter, a track resurfacing
 * its circuit, a charter whose boat is in for a refit. The API's own calendar reads those hours and sells
 * nothing from that moment on, so the one thing the guest page may not do is keep advertising the hours the
 * crawl read off the website months ago.
 */

const base = {
  id: "o-test-com",
  title: "Test Charters",
  src: "test.com",
  area: "Tampa, FL",
  cat: "water",
  art: "jetski",
  options: [{ name: "Half day", detail: "4 hours", price: 300, per: "/trip" }],
  services: [{ name: "Half day", desc: null, variants: [{ label: "4 hours", price: 300, per: "/trip", optionIdx: 0 }] }],
  hrs: [0, 1, 2, 3, 4, 5, 6].map(() => [540, 1020] as [number, number]),
  hoursText: ["Daily 9am-5pm"],
  tags: [],
  includes: [],
  specs: [],
  gap: "",
} as unknown as Unclaimed;

function shutForTheSeason() {
  const p = defaultProfile(base, { name: "O", email: "o@test.com", phone: "" });
  p.hours = p.hours.map((h) => ({ ...h, closed: true }));
  return p;
}

test("a week closed every day publishes its own closed lines, not the crawled ones", () => {
  const patch = toCatalog(shutForTheSeason(), base);
  assert.deepEqual(patch.hoursText, ["Sun: Closed", "Mon: Closed", "Tue: Closed", "Wed: Closed", "Thu: Closed", "Fri: Closed", "Sat: Closed"]);
  assert.notDeepEqual(patch.hoursText, base.hoursText);
});

/** `itemWeek` reads the compact week before the lines, so leaving the crawled one in place undoes the above. */
test("the crawled compact week is cleared by a value JSON keeps, not by undefined", () => {
  const patch = toCatalog(shutForTheSeason(), base);
  assert.ok("hrs" in patch, "the key has to be present to clear it across the wire");
  assert.deepEqual(patch.hrs, []);
});

test("every day of the published week then reads as closed to the guest side", () => {
  const guest = { ...base, ...toCatalog(shutForTheSeason(), base) } as Unclaimed;
  const week = itemWeek(guest);
  assert.ok(week, "the closed lines are still readable as a week");
  for (let d = 0; d < 7; d++) assert.equal(closedOnDay(week![d]), true, "day " + d + " should read closed");
});

/** One day back on is published as itself, which is what the week already did before this. */
test("reopening one day of a closed week publishes that day and keeps the rest shut", () => {
  const p = shutForTheSeason();
  p.hours = p.hours.map((h, i) => (i === 6 ? { closed: false, open: "10:00", close: "16:00" } : h));
  const guest = { ...base, ...toCatalog(p, base) } as Unclaimed;
  const week = itemWeek(guest)!;
  assert.equal(closedOnDay(week[6]), false);
  assert.deepEqual(week[6], { open: 600, close: 960 });
  for (let d = 0; d < 6; d++) assert.equal(closedOnDay(week[d]), true);
});
