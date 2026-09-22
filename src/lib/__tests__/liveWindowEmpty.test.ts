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

const dates = (n: number): LiveAvailability["days"] =>
  Array.from({ length: n }, (_, i) => ({ date: "2026-10-" + String(i + 1).padStart(2, "0"), slots: [] }));

const ctx = (live: LiveAvailability | null): CompanyContext => ({
  item: {
    id: "u-x", title: "Gulf Coast Parasail", cat: "water", art: "jetski", area: "Clearwater Beach, FL",
    metroId: "tampa", src: "example.com", options: [{ name: "Flight", price: 85 }], specs: [], includes: [],
    hoursText: HOURS,
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

test("a shop with a real departure is untouched by any of this", () => {
  const c = ctx({
    vendor: "xola",
    live: true,
    days: [{ date: "2026-10-01", slots: [{ startsAt: "2026-10-01T14:00", label: "2:00 PM · Flight", bookUrl: "x" }] }, ...dates(3)],
  });
  assert.match(companyAnswer(c, "when's the next opening?").text, /2:00 PM/);
});
