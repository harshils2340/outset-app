import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dateKey, startOfToday } from "../dates";
import { heldBookings, type OpBooking } from "../operator";

/**
 * Releasing a listing is the most destructive button in the dashboard: the profile goes on the server and on
 * this device, the owner is logged out, and the listing goes back to unclaimed. What it does not do is cancel
 * the bookings guests are holding, or tell them. The copy said only "Removes your edits everywhere", so an
 * owner tidying up on a quiet afternoon could walk away from four confirmed guests without being told they
 * were there, which is the same fault the trash on a service had until `upcomingBookingsFor` went in front of
 * it. This is that confirm, for the whole business instead of one service.
 */

const today = dateKey(startOfToday());
const yesterday = dateKey(new Date(startOfToday().getTime() - 86400000));
const tomorrow = dateKey(new Date(startOfToday().getTime() + 86400000));

const booking = (over: Partial<OpBooking>): OpBooking =>
  ({
    id: "b1", code: "AB-1", guest: "Dana", service: "Jet ski rental", variant: "", price: 120, qty: 2,
    total: 240, date: tomorrow, slot: "11:00", status: "accepted", created: Date.now(), source: "remote",
    ...over,
  }) as OpBooking;

test("a guest booked tomorrow counts, whichever service they are on", () => {
  assert.equal(heldBookings([booking({})]).length, 1);
  assert.equal(heldBookings([booking({ service: "Something else" })]).length, 1);
});

test("today still counts, because the trip has not happened yet", () => {
  assert.equal(heldBookings([booking({ date: today })]).length, 1);
});

test("a trip that has already been and gone does not", () => {
  assert.equal(heldBookings([booking({ date: yesterday })]).length, 0);
});

test("a request waiting on the owner counts; a declined or cancelled one does not", () => {
  assert.equal(heldBookings([booking({ status: "new" })]).length, 1);
  assert.equal(heldBookings([booking({ status: "declined" })]).length, 0);
  assert.equal(heldBookings([booking({ status: "cancelled" })]).length, 0);
  assert.equal(heldBookings([booking({ status: "completed" })]).length, 0);
  assert.equal(heldBookings([booking({ status: "noshow" })]).length, 0);
});

test("a booking made in this browser's guest app counts: a claimed shop's rows all come from elsewhere", () => {
  assert.equal(heldBookings([booking({ source: "guest" })]).length, 1);
});

/**
 * The demo's own fixtures are not people. Warning "3 guests are still booked with you" over rows the product
 * seeded itself would be a count of nobody, which is the half of the service-delete fault that ran the other
 * way: a demo profile raising the alarm about guests who do not exist.
 */
test("sample rows are never counted as guests", () => {
  assert.equal(heldBookings([booking({ source: "sample" })]).length, 0);
  assert.equal(heldBookings([booking({ source: "sample" }), booking({ id: "b2", code: "AB-2" })]).length, 1);
});

test("an empty dashboard holds nobody", () => {
  assert.deepEqual(heldBookings([]), []);
});

/** The page has to read the list the dashboard draws, and say the sentence. */
const TSX = readFileSync(new URL("../../components/operator/OpMore.tsx", import.meta.url), "utf8");

test("Settings reads heldBookings off the dashboard's own booking list", () => {
  assert.match(TSX, /heldBookings\(bookings\)/);
  assert.match(TSX, /const \{ p, set, bookings,/);
});

test("the Release copy says the bookings are not cancelled and the guests are not told", () => {
  assert.match(TSX, /still booked with you/);
  assert.match(TSX, /does not cancel/);
  assert.match(TSX, /does not tell them/);
  // The sentence has to reach the row a sighted owner reads before pressing Release.
  assert.match(TSX, /Release this listing<\/b><small>[^<]*\{heldLine\}<\/small>/);
});

test("no em dash in the new copy", () => {
  assert.doesNotMatch(TSX, /—/);
});
