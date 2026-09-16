import assert from "node:assert/strict";
import test from "node:test";
import type { Unclaimed } from "../../data/types";
import { bookableStart, dayKeyIn } from "../openNow";

/**
 * Which published start times the date picker still offers today.
 *
 * The times on a listing are wall clock times where the business stands, so the question "has this one gone
 * yet" has to be asked on the shop's clock. Both pickers asked it on the browser's, so a guest three hours east
 * of the shop lost its whole afternoon and a guest three hours west was offered starts that had already gone.
 */

/** Only the fields zoneFor reads. The picker never looks at the rest of the record here. */
const shopIn = (area: string): Unclaimed => ({ area } as unknown as Unclaimed);

const la = shopIn("Los Angeles, CA");
const ny = shopIn("Brooklyn, NY");

test("a New York guest at 8 PM still sees the Los Angeles shop's 6 PM start", () => {
  // 8 PM in New York is 5 PM in Los Angeles, so a 6 PM Pacific start is an hour out and bookable.
  const open = bookableStart(la, new Date("2026-09-16T20:00:00-04:00"));
  assert.equal(open("2026-09-16", "18:00"), true);
  // 5 PM Pacific is now, and 5:30 is inside the hour's notice.
  assert.equal(open("2026-09-16", "17:00"), false);
  assert.equal(open("2026-09-16", "17:30"), false);
});

test("a Los Angeles guest at 9 AM is not offered a New York start that has gone", () => {
  // 9 AM in Los Angeles is noon in New York, so an 11 AM Eastern start is in the past there.
  const open = bookableStart(ny, new Date("2026-09-16T09:00:00-07:00"));
  assert.equal(open("2026-09-16", "11:00"), false);
  assert.equal(open("2026-09-16", "13:00"), true);
});

test("a date that has not come yet keeps all of its times, and one that has gone keeps none", () => {
  const open = bookableStart(la, new Date("2026-09-16T20:00:00-04:00"));
  assert.equal(open("2026-09-17", "07:00"), true);
  assert.equal(open("2026-09-15", "23:00"), false);
});

test("late in the evening the guest's today is already the shop's tomorrow", () => {
  // 11 PM Pacific on the 16th is 2 AM Eastern on the 17th, so the New York shop's today is the 17th and the
  // guest's own date strip starts on a day that is over where the shop is.
  const now = new Date("2026-09-16T23:00:00-07:00");
  assert.equal(dayKeyIn("America/New_York", now), "2026-09-17");
  const open = bookableStart(ny, now);
  assert.equal(open("2026-09-16", "15:00"), false);
  assert.equal(open("2026-09-17", "09:00"), true);
});

test("a listing we cannot place falls back to the guest's own clock rather than refusing everything", () => {
  const nowhere = shopIn("Somewhere");
  const open = bookableStart(nowhere, new Date("2026-09-16T12:00:00Z"));
  const today = dayKeyIn(null, new Date("2026-09-16T12:00:00Z"));
  assert.equal(open(today, "23:59"), true);
});
