import { test } from "node:test";
import assert from "node:assert/strict";
import { scheduledSlots } from "../openSlots.ts";

/**
 * Hours come off the operator's own website, and plenty of shops publish "10am to 12am" or "6pm to 1am". Those
 * read back as a closing time at or before the opening time, and every one of those days used to produce no
 * start time at all: the listing's own hours row said "Open until 12:00 AM" while the booking box said "No more
 * start times today" on every day of the year. Nothing in the dashboard said why, because the operator's
 * calendar quietly fell back to a 9 to 5 grid when no day produced a slot.
 */

const week = (open: string, close: string) => Array.from({ length: 7 }, () => ({ closed: false, open, close }));
// Tuesday 15 September 2026, 08:00. The 17th is a Thursday, the 18th a Friday, the 19th a Saturday.
const NOW = new Date(2026, 8, 15, 8, 0, 0);
const THU = "2026-09-17";
const FRI = "2026-09-18";
const SAT = "2026-09-19";

test("a shop open until midnight offers the whole evening", () => {
  assert.deepEqual(
    scheduledSlots({ hours: week("21:00", "00:00"), slotMinutes: 60, leadHours: 0 }, THU, NOW),
    ["21:00", "22:00", "23:00"],
  );
});

test("a close after midnight puts the late start times on the date they happen", () => {
  const hours = week("18:00", "01:00");
  // Friday carries Thursday's midnight, because midnight is a Friday for the guest who turns up to it.
  assert.deepEqual(scheduledSlots({ hours, slotMinutes: 120, leadHours: 0 }, FRI, NOW), ["00:00", "18:00", "20:00", "22:00"]);
  // Only the evening, when the day before is shut.
  const mon = week("18:00", "01:00");
  mon[3] = { closed: true, open: "18:00", close: "01:00" }; // Wednesday off
  assert.deepEqual(scheduledSlots({ hours: mon, slotMinutes: 120, leadHours: 0 }, THU, NOW), ["18:00", "20:00", "22:00"]);
});

test("a day off takes the late session of that day with it", () => {
  const p = { hours: week("18:00", "01:00"), slotMinutes: 180, leadHours: 0, blockedDates: [THU] };
  assert.deepEqual(scheduledSlots(p, THU, NOW), []);
  assert.equal(scheduledSlots(p, FRI, NOW).includes("00:00"), false);
});

test("a blocked slot still drops an after midnight start time", () => {
  const p = { hours: week("18:00", "01:00"), slotMinutes: 180, leadHours: 0, blockedSlots: [FRI + "|00:00"] };
  assert.equal(scheduledSlots(p, FRI, NOW).includes("00:00"), false);
});

test("a closed day leaves no tail on the next one", () => {
  const hours = week("18:00", "01:00");
  hours[5] = { closed: true, open: "18:00", close: "01:00" }; // Friday off
  assert.equal(scheduledSlots({ hours, slotMinutes: 180, leadHours: 0 }, SAT, NOW).includes("00:00"), false);
});

test("an inverted day sells nothing, because it is a mistake and not a night shift", () => {
  // 6pm to 5pm is an opening time dragged past the closing one, not a 23 hour day.
  assert.deepEqual(scheduledSlots({ hours: week("18:00", "17:00"), slotMinutes: 60, leadHours: 0 }, THU, NOW), []);
  // The same time twice is not 24 hours either.
  assert.deepEqual(scheduledSlots({ hours: week("09:00", "09:00"), slotMinutes: 60, leadHours: 0 }, THU, NOW), []);
});

test("ordinary hours are untouched, and the notice and window still hold", () => {
  const p = { hours: week("09:00", "17:00"), slotMinutes: 60 };
  assert.deepEqual(scheduledSlots(p, THU, NOW), ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"]);
  assert.deepEqual(scheduledSlots({ ...p, leadHours: 72 }, THU, NOW), []);
  assert.deepEqual(scheduledSlots({ ...p, windowDays: 7 }, "2026-10-15", NOW), []);
});

test("the notice reaches an after midnight start time as the near thing it is", () => {
  // Wednesday 08:00, looking at Thursday 00:00, which is 16 hours away.
  const wed = new Date(2026, 8, 16, 8, 0, 0);
  const hours = week("18:00", "01:00");
  assert.equal(scheduledSlots({ hours, slotMinutes: 180, leadHours: 12 }, THU, wed).includes("00:00"), true);
  assert.equal(scheduledSlots({ hours, slotMinutes: 180, leadHours: 24 }, THU, wed).includes("00:00"), false);
});

/**
 * A website is under no obligation to publish hours on the half hour, and this engine is what a guest is
 * actually offered. Nothing here may round: a shop open 8:45 to 5:15 sells 8:45, and its twin in
 * src/lib/__tests__/calendar.test.ts draws the operator the same rows.
 */
test("hours off the half hour are offered on their own minutes", () => {
  assert.deepEqual(
    scheduledSlots({ hours: week("08:45", "17:15"), slotMinutes: 90, leadHours: 0 }, THU, NOW),
    ["08:45", "10:15", "11:45", "13:15", "14:45", "16:15"],
  );
});

test("an odd close after midnight leaves its tail on the next date", () => {
  assert.deepEqual(
    scheduledSlots({ hours: week("18:20", "01:20"), slotMinutes: 120, leadHours: 0 }, FRI, NOW),
    ["00:20", "18:20", "20:20", "22:20"],
  );
});
