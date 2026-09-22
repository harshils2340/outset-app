import assert from "node:assert/strict";
import test from "node:test";
import { companyAnswer, type CompanyContext } from "../companyAgent";
import type { LiveAvailability } from "../api";
import type { Unclaimed } from "../../data/types";

/**
 * A shop whose own booking system we read, and which has nothing open in the window we asked about.
 *
 * Everything on the page treated that as "no feed": the pickers drew our published nine, eleven and one over
 * it and let a guest book one, and Otto fell through to the shop's published hours and said "Open Monday 9 AM
 * to 5 PM, pick a time on this page" beside a calendar with nothing in it. The vendor answered, though, and
 * what it answered is a fact about the shop. A read that stopped short of the shop's whole catalog is the one
 * case that still says nothing, because an empty date there is only empty as far as we looked.
 */

const HOURS = ["Monday: 9:00 AM - 5:00 PM", "Tuesday: 9:00 AM - 5:00 PM", "Wednesday: 9:00 AM - 5:00 PM", "Thursday: 9:00 AM - 5:00 PM", "Friday: 9:00 AM - 5:00 PM", "Saturday: 9:00 AM - 5:00 PM", "Sunday: 9:00 AM - 5:00 PM"];

/**
 * Dates counted off today rather than written down. Otto reads the calendar through the same `bookableStart`
 * the pickers do, so a departure named by a fixed date stops being in the future one morning and takes the
 * test with it, which is exactly how the concierge's window test went red on its own.
 */
function dayAt(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const dates = (n: number): LiveAvailability["days"] =>
  Array.from({ length: n }, (_, i) => ({ date: dayAt(i + 1), slots: [] }));

const ctx = (live: LiveAvailability | null, extra: Partial<Unclaimed> = {}): CompanyContext => ({
  item: {
    id: "u-x", title: "Gulf Coast Parasail", cat: "water", art: "jetski", area: "Clearwater Beach, FL",
    metroId: "tampa", src: "example.com", options: [{ name: "Flight", price: 85 }], specs: [], includes: [],
    hoursText: HOURS, ...extra,
  } as unknown as Unclaimed,
  contact: null,
  live,
});

test("a calendar we read and found empty is said out loud, not papered over with published hours", () => {
  const c = ctx({ vendor: "fareharbor", live: true, days: dates(14) });
  for (const q of ["do you have anything Saturday at 10am?", "when's the next opening?", "can I book?"]) {
    const text = companyAnswer(c, q).text;
    assert.match(text, /next 14 days/, q + " -> " + text);
    assert.ok(!/9 AM|pick a time on this page and they confirm/i.test(text), q + " -> " + text);
    assert.ok(!text.includes("can't see their live"), q + " -> " + text);
  }
});

test("a read that stopped short of the shop's catalog speaks for nothing", () => {
  const c = ctx({ vendor: "peek", live: true, partial: true, days: dates(14) });
  const text = companyAnswer(c, "when's the next opening?").text;
  assert.ok(!text.includes("next 14 days"), text);
});

test("with no feed at all Otto says so, exactly as before", () => {
  const text = companyAnswer(ctx(null), "when's the next opening?").text;
  assert.match(text, /can't see their live times/);
});

/**
 * The exception `liveWins` already makes for both pickers, which Otto has to make too now that it can see a
 * calendar at all. A claimed shop sells its own hours here minus what is booked, and the catalog may still hold
 * a booking link of theirs from before they claimed: an empty fortnight on that stale calendar would have had
 * Otto telling a guest a shop taking bookings on this very page has nothing open, standing beside a picker
 * offering that shop's own times. Otto cannot see those times, so it says nothing about the window.
 */
test("an empty vendor calendar does not close a claimed shop that is taking bookings here", () => {
  const empty = { vendor: "fareharbor" as const, live: true, days: dates(14) };
  for (const q of ["do you have anything Saturday at 10am?", "when's the next opening?", "can I book?"]) {
    assert.match(companyAnswer(ctx(empty), q).text, /next 14 days/, "unclaimed: " + q);
    const claimed = companyAnswer(ctx(empty, { claimed: true }), q).text;
    assert.ok(!/next 14 days/.test(claimed), "claimed: " + q + " -> " + claimed);
  }
  assert.match(companyAnswer(ctx(empty, { claimed: true }), "can I book?").text, /Pick a service and time on this page/);
});

test("a claimed shop's real departures still reach a guest, the way they reach the picker", () => {
  const c = ctx(
    { vendor: "fareharbor", live: true, days: [{ date: dayAt(3), slots: [{ startsAt: dayAt(3) + "T14:00", label: "2:00 PM · Flight", bookUrl: "x" }] }] },
    { claimed: true },
  );
  assert.match(companyAnswer(c, "when's the next opening?").text, /2:00 PM/);
});

test("a shop with a real departure is untouched by any of this", () => {
  const c = ctx({
    vendor: "xola",
    live: true,
    days: [...dates(4), { date: dayAt(5), slots: [{ startsAt: dayAt(5) + "T14:00", label: "2:00 PM · Flight", bookUrl: "x" }] }],
  });
  assert.match(companyAnswer(c, "when's the next opening?").text, /2:00 PM/);
});
