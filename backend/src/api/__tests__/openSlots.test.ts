import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SLOTS, capacityFor, openDaysFor, scheduledSlots, slotOpen } from "../openSlots.ts";
import type { StoredBooking } from "../bookings.ts";

/**
 * openDaysFor is the fast path the public slot route uses. slotOpen is the authoritative single-slot check that
 * the booking route enforces under the row lock. They must never disagree: a time the picker offers and the
 * booking route then refuses is the "that time was just booked" message on a time nobody booked.
 */

const day = (closed: boolean, open = "09:00", close = "17:00") => ({ closed, open, close });
const PROFILE = {
  hours: [day(true), day(false), day(false), day(false, "08:00", "12:30"), day(false), day(false), day(false, "10:00", "23:30")],
  slotMinutes: 60,
  leadHours: 2,
  windowDays: 60,
  blockedDates: ["2026-10-07"],
  blockedSlots: ["2026-10-06|11:00", "2026-10-06|12:00"],
  services: [
    { name: "Sunset sail", live: true, capacity: 4 },
    { name: "Private charter", live: true, capacity: 1 },
  ],
};

const booking = (date: string, slot: string, qty: number, status: StoredBooking["status"] = "accepted"): StoredBooking =>
  ({ code: date + slot, listing: "o-x", date, slot, qty, service: "Sunset sail", variant: "", addons: [], total: null, guest: { name: "G", phone: "1", email: "" }, status, created: new Date("2026-10-01T00:00:00Z").toISOString() }) as StoredBooking;

const NOW = new Date("2026-10-05T07:00:00");
const START = new Date(2026, 9, 5); // 5 October 2026

/** The same answer the obvious loop would give, one slotOpen call per slot. */
function slowPath(profile: typeof PROFILE | null, list: StoredBooking[], service: string, guests: number, days: number) {
  const out: { date: string; slots: string[] }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(START.getFullYear(), START.getMonth(), START.getDate() + i);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push({ date, slots: scheduledSlots(profile, date, NOW).filter((t) => slotOpen(profile, list, date, t, service, guests, NOW).open) });
  }
  return out;
}

test("the fast path agrees with the authoritative check, across hours, days off, blocked slots and capacity", () => {
  const list = [
    booking("2026-10-06", "09:00", 4), // fills a 4-capacity time
    booking("2026-10-06", "10:00", 2), // half fills one
    booking("2026-10-08", "09:00", 1, "new"), // a request still holds the time
    booking("2026-10-08", "10:00", 1, "declined"), // a declined one does not
  ];
  for (const guests of [1, 2, 3, 4]) {
    for (const service of ["Sunset sail", "Private charter", "Not a service we sell"]) {
      assert.deepEqual(openDaysFor(PROFILE, list, START, 14, service, guests, NOW), slowPath(PROFILE, list, service, guests, 14), `guests ${guests}, service ${service}`);
    }
  }
});

test("it agrees for a listing nobody has claimed, which has no hours at all", () => {
  assert.deepEqual(openDaysFor(null, [], START, 10, "", 1, NOW), slowPath(null, [], "", 1, 10));
});

test("a booked time really does disappear, and the rest of the day does not", () => {
  const full = openDaysFor(PROFILE, [booking("2026-10-06", "09:00", 4)], START, 3, "Sunset sail", 1, NOW);
  const oct6 = full.find((d) => d.date === "2026-10-06")!;
  assert.equal(oct6.slots.includes("09:00"), false);
  assert.equal(oct6.slots.includes("10:00"), true);
});

test("a party that does not fit is not offered the time, but a smaller one still is", () => {
  const list = [booking("2026-10-06", "10:00", 2)]; // 2 of 4 taken
  const forTwo = openDaysFor(PROFILE, list, START, 3, "Sunset sail", 2, NOW).find((d) => d.date === "2026-10-06")!;
  const forThree = openDaysFor(PROFILE, list, START, 3, "Sunset sail", 3, NOW).find((d) => d.date === "2026-10-06")!;
  assert.equal(forTwo.slots.includes("10:00"), true);
  assert.equal(forThree.slots.includes("10:00"), false);
});

test("a day off and a blocked time are closed, and capacity is read per service", () => {
  const days = openDaysFor(PROFILE, [], START, 5, "Sunset sail", 1, NOW);
  assert.deepEqual(days.find((d) => d.date === "2026-10-07")!.slots, []); // blocked date
  const oct6 = days.find((d) => d.date === "2026-10-06")!;
  assert.equal(oct6.slots.includes("11:00"), false); // blocked slot
  assert.equal(capacityFor(PROFILE, "Private charter"), 1);
  assert.equal(capacityFor(PROFILE, "Sunset sail"), 4);
});

/**
 * A shop's opening times are wall clock times where it stands. The API runs in UTC on Render, and every shop in
 * North America is behind UTC, so building those times in the server's zone quietly removed the back half of
 * every shop's day: a 9-to-5 Pacific shop at 11 AM Pacific offered nothing at all for today.
 */

const PACIFIC = {
  hours: Array.from({ length: 7 }, () => ({ closed: false, open: "09:00", close: "17:00" })),
  slotMinutes: 60,
  leadHours: 2,
  windowDays: 60,
  blockedDates: [],
  blockedSlots: [],
  services: [{ name: "Sail", live: true, capacity: 8 }],
};

test("a shop's afternoon survives, whatever zone the server is in", () => {
  const at11Pacific = new Date("2026-10-06T18:00:00Z");
  const slots = scheduledSlots(PACIFIC, "2026-10-06", at11Pacific, "America/Los_Angeles");
  // 11 AM there, two hours' notice, so one o'clock onwards.
  assert.deepEqual(slots, ["13:00", "14:00", "15:00", "16:00"]);
});

test("the shop's own day decides what counts as today, not the server's", () => {
  // 01:00 UTC on the 7th is still 6 PM on the 6th in Los Angeles, after closing.
  const evening = new Date("2026-10-07T01:00:00Z");
  assert.deepEqual(scheduledSlots(PACIFIC, "2026-10-06", evening, "America/Los_Angeles"), []);
  assert.equal(scheduledSlots(PACIFIC, "2026-10-07", evening, "America/Los_Angeles").length, 8);
  // The server, meanwhile, already thinks it is the 7th. That must not bring the 7th's morning forward.
  assert.equal(scheduledSlots(PACIFIC, "2026-10-07", evening, "America/Los_Angeles")[0], "09:00");
});

test("an eastern shop and a pacific shop get different answers at the same instant", () => {
  const at = new Date("2026-10-06T18:00:00Z"); // 2 PM Eastern, 11 AM Pacific
  const east = scheduledSlots(PACIFIC, "2026-10-06", at, "America/New_York");
  const west = scheduledSlots(PACIFIC, "2026-10-06", at, "America/Los_Angeles");
  assert.deepEqual(east, ["16:00"]); // 2 PM + two hours' notice
  assert.deepEqual(west, ["13:00", "14:00", "15:00", "16:00"]);
});

test("with no zone the old behaviour is kept, for a listing we cannot place", () => {
  const at = new Date("2026-10-06T18:00:00Z");
  // Not asserting the values, which depend on the server's zone by design; only that it still answers.
  assert.equal(Array.isArray(scheduledSlots(PACIFIC, "2026-10-06", at)), true);
});

/**
 * An unclaimed listing has no dashboard, so its picker offers the six fixed times. Its own website still
 * publishes hours, and offering 7 AM at a brewery that opens at four is inventing availability: 13,386 shipped
 * listings did it, 1,014 of them on days they state as closed.
 */

const MONDAY = "2026-10-05"; // a Monday
const NOON = new Date("2026-10-04T12:00:00"); // the Sunday before, so nothing is cut by the notice

/** A week with one weekday stated and the rest left unsaid, Sunday first. */
const weekWith = (dayIdx: number, day: { open: number; close: number } | null) =>
  [null, null, null, null, null, null, null].map((d, i) => (i === dayIdx ? day : d));

test("an unclaimed listing offers only the fixed times its own hours are open for", () => {
  // o-10kbrew-com opens at 4 PM on a Monday and was offering every time from 7 AM.
  assert.deepEqual(scheduledSlots(null, MONDAY, NOON, undefined, weekWith(1, { open: 16 * 60, close: 21 * 60 })), ["17:00"]);
  // o-1000islandsheritagemuseum-com, 10 to 4.
  assert.deepEqual(scheduledSlots(null, MONDAY, NOON, undefined, weekWith(1, { open: 10 * 60, close: 16 * 60 })), ["11:00", "13:00", "15:00"]);
});

test("a day the shop states as closed offers nothing at all", () => {
  assert.deepEqual(scheduledSlots(null, MONDAY, NOON, undefined, weekWith(1, { open: 0, close: 0 })), []);
});

test("a day the shop says nothing about keeps all six, because nobody has called it shut", () => {
  assert.deepEqual(scheduledSlots(null, MONDAY, NOON, undefined, weekWith(1, null)), DEFAULT_SLOTS);
  assert.deepEqual(scheduledSlots(null, MONDAY, NOON, undefined, null), DEFAULT_SLOTS);
  assert.deepEqual(scheduledSlots(null, MONDAY, NOON), DEFAULT_SLOTS);
});

test("hours none of the six land in still leave the shop bookable, on its own opening time", () => {
  // o-5280karate-org, 6 PM to 9 PM. 626 listings would otherwise have lost every start time they had.
  assert.deepEqual(scheduledSlots(null, MONDAY, NOON, undefined, weekWith(1, { open: 18 * 60, close: 21 * 60 })), ["18:00", "20:00"]);
  // o-7cswimschool-com, 5:30 to 6:30 in the morning.
  assert.deepEqual(scheduledSlots(null, MONDAY, NOON, undefined, weekWith(1, { open: 5 * 60 + 30, close: 6 * 60 + 30 })), ["05:30"]);
});

test("a claimed shop is untouched: its own dashboard hours still decide", () => {
  const shut = weekWith(1, { open: 0, close: 0 });
  assert.deepEqual(scheduledSlots(PROFILE, "2026-10-05", NOW, undefined, shut), scheduledSlots(PROFILE, "2026-10-05", NOW));
});

test("the booking route takes exactly the times the picker offered, and no others", () => {
  const week = weekWith(1, { open: 16 * 60, close: 21 * 60 });
  const offered = scheduledSlots(null, MONDAY, NOON, undefined, week);
  for (const t of DEFAULT_SLOTS) {
    assert.equal(slotOpen(null, [], MONDAY, t, "", 1, NOON, undefined, week).open, offered.includes(t), t);
  }
});
