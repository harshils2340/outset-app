import { test } from "node:test";
import assert from "node:assert/strict";
import { capacityFor, openDaysFor, scheduledSlots, slotOpen } from "../openSlots.ts";
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
