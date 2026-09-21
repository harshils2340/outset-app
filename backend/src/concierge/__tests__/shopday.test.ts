import test from "node:test";
import assert from "node:assert/strict";
import { addDays, lastDayOf, ymdLocal, zonedNow, zonedYmd } from "../shopday.ts";

/**
 * The day a guest means, where the shop is.
 *
 * Eight readers turned the window into calendar dates off this machine's clock, under a comment saying that
 * local dates are used rather than UTC because UTC rolls the evening into tomorrow. The API host has no TZ
 * set, so local is UTC there and the comment was describing a fix that only worked on a laptop: from eight in
 * the evening Eastern, five in the afternoon Pacific, "escape room tonight" asked every shop about tomorrow
 * and "tomorrow" asked for the day after. These tests run in whatever zone they are run in, so every case
 * names both zones explicitly rather than leaning on the machine's.
 */

test("the evening a UTC host has already called tomorrow is still tonight where the shop is", () => {
  // 21:30 in Toronto, 18:30 in Vancouver, and the 22nd in UTC.
  const at = new Date("2026-09-22T01:30:00Z");
  assert.equal(zonedYmd(at, "America/Toronto"), "2026-09-21");
  assert.equal(zonedYmd(at, "America/Vancouver"), "2026-09-21");
  assert.equal(zonedYmd(at, "UTC"), "2026-09-22", "the host's own answer, for comparison");
  // A day later in real time is the shop's next day, which is what "tomorrow" has to mean.
  assert.equal(zonedYmd(new Date(at.getTime() + 86400_000), "America/Toronto"), "2026-09-22");
});

test("a morning is the same day everywhere in North America, which is why this was never seen", () => {
  const at = new Date("2026-09-21T14:00:00Z");
  for (const zone of ["America/Toronto", "America/Chicago", "America/Denver", "America/Los_Angeles"]) {
    assert.equal(zonedYmd(at, zone), "2026-09-21", zone);
  }
});

test("no zone, or a zone nobody has heard of, keeps this machine's own answer", () => {
  const at = new Date("2026-09-22T01:30:00Z");
  assert.equal(zonedYmd(at, null), ymdLocal(at));
  assert.equal(zonedYmd(at, ""), ymdLocal(at));
  assert.equal(zonedYmd(at, "Mars/Olympus_Mons"), ymdLocal(at));
});

test("the shop's clock, for the one question it answers: has this slot started?", () => {
  const at = new Date("2026-09-22T01:30:00Z");
  assert.deepEqual(zonedNow("America/Toronto", at), { date: "2026-09-21", minutes: 21 * 60 + 30 });
  assert.deepEqual(zonedNow("America/Los_Angeles", at), { date: "2026-09-21", minutes: 18 * 60 + 30 });
  // Midnight is minute zero, not minute 1,440: `hour12: false` reports the hour after midnight as 24.
  assert.deepEqual(zonedNow("UTC", new Date("2026-09-22T00:10:00Z")), { date: "2026-09-22", minutes: 10 });
  assert.deepEqual(zonedNow(null, at), { date: ymdLocal(at), minutes: at.getHours() * 60 + at.getMinutes() });
});

test("a window walks the calendar, not 86,400,000 milliseconds at a time", () => {
  assert.equal(addDays("2026-09-21", 1), "2026-09-22");
  assert.equal(addDays("2026-09-30", 1), "2026-10-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(addDays("2026-09-21", 0), "2026-09-21");
  // The night the clocks go forward is 23 hours long, so adding a day of elapsed time steps over a date.
  assert.equal(addDays("2026-03-07", 1), "2026-03-08");
  assert.equal(addDays("2026-03-07", 2), "2026-03-09");
  // A leap day is a day.
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addDays("not a date", 1), "not a date");
});

/**
 * A day's window is that day. `fareharborLive` counts its last day this way and said why in its own comment;
 * the eight readers written after it counted one day past the first instead, so "tonight" reached tomorrow.
 */
test("a window of n days ends on its nth day, not the one after it", () => {
  assert.equal(lastDayOf("2026-09-21", 1), "2026-09-21");
  assert.equal(lastDayOf("2026-09-21", 2), "2026-09-22");
  assert.equal(lastDayOf("2026-09-21", 14), "2026-10-04");
  // A window of nothing is still the day it starts on, rather than the day before it.
  assert.equal(lastDayOf("2026-09-21", 0), "2026-09-21");
  assert.equal(lastDayOf("2026-09-21", -3), "2026-09-21");
  // Month ends and leap days are the calendar's business, not arithmetic's.
  assert.equal(lastDayOf("2026-09-30", 2), "2026-10-01");
  assert.equal(lastDayOf("2028-02-28", 2), "2028-02-29");
});
