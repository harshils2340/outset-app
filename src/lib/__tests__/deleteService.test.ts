import assert from "node:assert/strict";
import test from "node:test";
import { allBookings, upcomingBookingsFor, type OpBooking, type OperatorProfile } from "../operator";
import type { RemoteBooking } from "../api";

/**
 * The one guard between a slip on the trash button and a service disappearing from under guests who have
 * already paid for it. OpServices calls this and, when it counts anything, puts a confirm in the way: "has 2
 * upcoming bookings. Those bookings stay, but guests can no longer book it."
 *
 * It has to count the same bookings the dashboard itself draws (allBookings), not just the rows the profile
 * happens to carry: a booking made by a guest on another phone lives in Postgres and reaches the dashboard
 * through `remote`, and a booking made in this browser's guest app lives in the guest store and reaches it
 * through `guest`. Neither is ever in `p.bookings`, which holds the samples and nothing else on a real shop.
 */

const profile = (over: Partial<OperatorProfile> = {}): OperatorProfile =>
  ({
    id: "o-test", instantBook: false, decisions: {}, bookings: [], services: [], hours: [], blockedDates: [], blockedSlots: [],
    ownerEmail: "owner@realshop.com", ownerName: "Owner",
    ...over,
  }) as OperatorProfile;

const TOMORROW = new Date(Date.now() + 86400000);
const key = (d: Date) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const DATE = key(TOMORROW);

const remote = (over: Partial<RemoteBooking> = {}): RemoteBooking =>
  ({
    code: "ABC123", listing: "o-test", service: "Sunset cruise", variant: "Standard", qty: 2,
    total: 240, date: DATE, slot: "18:00", status: "accepted", created: new Date().toISOString(),
    guest: { name: "Dana", email: "dana@example.com", phone: null }, addons: [],
    ...over,
  }) as RemoteBooking;

test("a booking the API holds for the service is counted, so deleting it asks first", () => {
  const p = profile();
  const rows = allBookings(p, [], [remote()]);
  assert.equal(rows.length, 1, "the dashboard draws the remote booking");
  assert.equal(upcomingBookingsFor(rows, "Sunset cruise").length, 1);
});

test("the service name is matched however it was cased or spaced", () => {
  const rows = allBookings(profile(), [], [remote({ service: "  Sunset Cruise " })]);
  assert.equal(upcomingBookingsFor(rows, "sunset cruise").length, 1);
});

test("another service's bookings, a past one, and a cancelled one are not counted", () => {
  const rows = allBookings(profile(), [], [
    remote({ code: "A1", service: "Jet ski hour" }),
    remote({ code: "A2", date: "2020-01-01" }),
    remote({ code: "A3", status: "cancelled" }),
    remote({ code: "A4", status: "declined" }),
  ]);
  assert.equal(upcomingBookingsFor(rows, "Sunset cruise").length, 0);
});

test("a request still waiting on the operator counts as much as an accepted one", () => {
  const rows = allBookings(profile(), [], [remote({ status: "new" })]);
  assert.equal(upcomingBookingsFor(rows, "Sunset cruise").length, 1);
});

/** A row the profile itself carries still counts: that is how it worked before and nothing should lose it. */
test("a booking stored on the profile is counted too", () => {
  const own: OpBooking = {
    id: "x1", code: "OWN1", guest: "Pat", service: "Sunset cruise", variant: "", price: 120, qty: 1,
    total: 120, date: DATE, slot: "18:00", status: "accepted", created: Date.now(), source: "guest",
  };
  const rows = allBookings(profile({ bookings: [own] }), [], []);
  assert.equal(upcomingBookingsFor(rows, "Sunset cruise").length, 1);
});
