import assert from "node:assert/strict";
import test from "node:test";
import { slotsForDay, type OperatorProfile } from "../operator";

/**
 * The grid the dashboard Calendar draws. It has to say the same thing the guest picker does, because an owner
 * blocks time here and then trusts the page: a slot the calendar offers and the API refuses is time off the
 * owner thinks they gave away, and a slot the calendar hides and the API sells is a guest arriving unannounced.
 * scheduledSlots in backend/src/api/openSlots.ts is the other half, and openSlots.test.ts is its twin of this.
 */

const week = (open: string, close: string) => Array.from({ length: 7 }, () => ({ closed: false, open, close }));
const profile = (over: Partial<OperatorProfile>): OperatorProfile =>
  ({ hours: week("09:00", "17:00"), slotMinutes: 60, blockedDates: [], blockedSlots: [], ...over }) as OperatorProfile;

// Thursday 17 September 2026, and the Friday and Saturday after it.
const THU = new Date(2026, 8, 17);
const FRI = new Date(2026, 8, 18);
const SAT = new Date(2026, 8, 19);

test("ordinary hours run from the open to the close", () => {
  assert.deepEqual(slotsForDay(profile({}), THU), ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"]);
});

test("a shop open until midnight fills its evening instead of showing nothing", () => {
  assert.deepEqual(slotsForDay(profile({ hours: week("21:00", "00:00") }), THU), ["21:00", "22:00", "23:00"]);
});

test("a close after midnight lands on the date the guest turns up on", () => {
  const p = profile({ hours: week("18:00", "01:00"), slotMinutes: 120 });
  assert.deepEqual(slotsForDay(p, FRI), ["00:00", "18:00", "20:00", "22:00"]);
});

/**
 * The day off is kept on the date it was taken, and the late session belongs to that date even though the
 * guest books it under the next one. The calendar read only this date's hours, so a shop open Friday 6pm to 1am
 * with Friday taken off still offered the operator midnight on Saturday as an open slot, while the API, which
 * checks the day before, offered the guest nothing there.
 */
test("a day off takes its after midnight session with it, the way the API does", () => {
  const p = profile({ hours: week("18:00", "01:00"), slotMinutes: 180, blockedDates: ["2026-09-18"] });
  assert.equal(slotsForDay(p, SAT).includes("00:00"), false);
  // The Saturday evening is untouched: only Friday was taken off.
  assert.deepEqual(slotsForDay(p, SAT), ["18:00", "21:00"]);
});

test("a closed weekday leaves no tail on the next day either", () => {
  const hours = week("18:00", "01:00");
  hours[5] = { closed: true, open: "18:00", close: "01:00" }; // Friday
  assert.equal(slotsForDay(profile({ hours, slotMinutes: 180 }), SAT).includes("00:00"), false);
});

test("an inverted day is a mistake, not a night shift, so it sells nothing", () => {
  assert.deepEqual(slotsForDay(profile({ hours: week("18:00", "17:00") }), THU), []);
  assert.deepEqual(slotsForDay(profile({ hours: week("09:00", "09:00") }), THU), []);
});

/**
 * Hours are read off the operator's own website, which is under no obligation to use half hours. Nothing in
 * the chain may round them: the two selects on Availability carry the shop's own time as an extra entry, both
 * slot engines count in minutes, and the calendar's rows are the union of every day's start times, so an odd
 * one gets a row of its own rather than falling between two.
 */
test("hours off the half hour keep their own minutes all the way through", () => {
  const p = profile({ hours: week("08:45", "17:15"), slotMinutes: 90 });
  assert.deepEqual(slotsForDay(p, THU), ["08:45", "10:15", "11:45", "13:15", "14:45", "16:15"]);
});

test("an odd close after midnight still lands on the date the guest turns up on", () => {
  const p = profile({ hours: week("18:20", "01:20"), slotMinutes: 120 });
  assert.deepEqual(slotsForDay(p, FRI), ["00:20", "18:20", "20:20", "22:20"]);
});
