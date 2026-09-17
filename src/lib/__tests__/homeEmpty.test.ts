import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { weekAheadLine } from "../operator";

/**
 * What the dashboard's Next 7 days tab says when it lists nothing.
 *
 * The tab lists confirmed bookings only. "Nothing booked in the next 7 days. Your calendar is open." was
 * therefore shown to a shop with five requests waiting inside that week, two lines under a Needs action badge
 * reading 5, and to a shop whose next booking is eight days out with eleven behind it.
 */

test("unanswered requests in that week are said, not called an open calendar", () => {
  assert.equal(weekAheadLine(5, 0), "Nothing confirmed in the next 7 days. 5 requests are still waiting on your answer.");
  assert.equal(weekAheadLine(1, 0), "Nothing confirmed in the next 7 days. 1 request is still waiting on your answer.");
  assert.ok(!weekAheadLine(5, 0).includes("calendar is open"));
});

test("bookings further out are said rather than left unmentioned", () => {
  assert.equal(weekAheadLine(0, 11), "Nothing in the next 7 days. 11 bookings after that.");
  assert.equal(weekAheadLine(0, 1), "Nothing in the next 7 days. 1 booking after that.");
});

test("a genuinely open week still says so", () => {
  assert.equal(weekAheadLine(0, 0), "Nothing booked in the next 7 days. Your calendar is open.");
});

test("a request waiting outranks a booking further out", () => {
  assert.ok(weekAheadLine(2, 9).includes("waiting on your answer"));
});

test("the tab reads its line from the one place that decides it", () => {
  const home = readFileSync(new URL("../../components/operator/OpHome.tsx", import.meta.url), "utf8");
  assert.ok(/weekAheadLine\(freshSoon, later\)/.test(home), "Home stopped asking weekAheadLine what to say");
  assert.ok(/\{emptyWeek\}<\/p>/.test(home), "the tab is printing a fixed line again instead of the one it was given");
});
