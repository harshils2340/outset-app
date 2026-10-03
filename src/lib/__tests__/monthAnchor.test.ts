import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { anchorMonth } from "../dates";

/**
 * A booking calendar has to draw the month the picked day is in, whoever moved that day.
 *
 * Both grids seed their month from the picked day on mount and neither is told when something else moves it.
 * Two things do: the phone sheet lands the guest on the first day that has start times, and the booking window
 * rebuilds itself on the local day roll (`bookingDates`). Driven in a real Chromium at 400px with the page's
 * clock set to 23:50 on 31 October, the phone sheet's head read "October 2026" with no day marked picked, the
 * only open day on the grid was the 31st, and the Start times column beside it was listing Sunday 1 November's
 * times; an hour later the same October grid had no bookable day on it at all.
 */

const m = (y: number, mo: number) => new Date(y, mo, 1);
const d = (y: number, mo: number, day: number) => new Date(y, mo, day);

test("a picked day already on screen leaves the month where the guest paged it", () => {
  assert.equal(anchorMonth(m(2026, 9), d(2026, 9, 31)).getTime(), m(2026, 9).getTime());
  // The desktop pair draws two months, so the second one is on screen too.
  assert.equal(anchorMonth(m(2026, 9), d(2026, 10, 1), 2).getTime(), m(2026, 9).getTime());
});

test("a picked day in another month pulls the grid to it", () => {
  assert.equal(anchorMonth(m(2026, 9), d(2026, 10, 1)).getTime(), m(2026, 10).getTime());
  assert.equal(anchorMonth(m(2026, 9), d(2026, 11, 2), 2).getTime(), m(2026, 11).getTime());
});

test("the year rolls over with the month", () => {
  assert.equal(anchorMonth(m(2026, 11), d(2027, 0, 1)).getTime(), m(2027, 0).getTime());
  assert.equal(anchorMonth(m(2026, 11), d(2027, 0, 1), 2).getTime(), m(2026, 11).getTime());
  assert.equal(anchorMonth(m(2026, 11), d(2027, 1, 3), 2).getTime(), m(2027, 1).getTime());
});

test("a day behind the month on screen pulls it back, which is how the window roll reaches it", () => {
  assert.equal(anchorMonth(m(2026, 10), d(2026, 9, 31)).getTime(), m(2026, 9).getTime());
  assert.equal(anchorMonth(m(2026, 10), d(2026, 9, 31), 2).getTime(), m(2026, 9).getTime());
});

test("a span of nothing is still read as the one month it draws", () => {
  assert.equal(anchorMonth(m(2026, 9), d(2026, 9, 2), 0).getTime(), m(2026, 9).getTime());
  assert.equal(anchorMonth(m(2026, 9), d(2026, 10, 2), 0).getTime(), m(2026, 10).getTime());
});

/** Neither calendar may keep a copy of the rule: they drifted once already, and only the pair had it. */
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("the phone sheet's grid follows its picked day through the shared rule", () => {
  const cal = read("../../components/booking/SlotCalendar.tsx");
  assert.match(cal, /setMonth\(\(m\) => anchorMonth\(m, selected\)\)/);
  assert.match(cal, /\}, \[selectedKey\]\)/);
});

test("the desktop page's pair follows it the same way, two months wide", () => {
  const page = read("../../components/web/WebListing.tsx");
  assert.match(page, /setMonth\(\(m\) => anchorMonth\(m, selected, 2\)\)/);
  assert.match(page, /\}, \[selectedKey\]\)/);
});
