import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dateKey, startOfToday } from "../dates";
import { weekDayLabel } from "../operator";

/**
 * Home's "Next 7 days" list labels each day it groups bookings under, and the day after today is the one a
 * person reads for a word rather than a date. It measured the gap from a date built at noon against midnight
 * today, so tomorrow came to one and a half days, rounded to two, and "Tomorrow" was unreachable.
 */

const keyIn = (days: number): string => {
  const d = new Date(startOfToday());
  d.setDate(d.getDate() + days);
  return dateKey(d);
};

const dayOf = (iso: string): number => Number(iso.split("-")[2]);

test("the day after today is Tomorrow, and it carries its own date", () => {
  assert.equal(weekDayLabel(keyIn(1)), "Tomorrow " + dayOf(keyIn(1)));
});

test("every other day of the week is its own weekday", () => {
  for (const n of [2, 3, 4, 5, 6, 7]) {
    const label = weekDayLabel(keyIn(n));
    assert.doesNotMatch(label, /Tomorrow|Today|Yesterday/, `day +${n} read as ${label}`);
    assert.match(label, /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{1,2}$/, `day +${n} read as ${label}`);
    assert.equal(label.split(" ")[1], String(dayOf(keyIn(n))));
  }
});

test("Home reads the shared label rather than a day sum of its own", () => {
  const src = readFileSync(new URL("../../components/operator/OpHome.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /T12:00:00/, "Home is back on a day built at noon");
});
