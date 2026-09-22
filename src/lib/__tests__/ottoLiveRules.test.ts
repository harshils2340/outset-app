import assert from "node:assert/strict";
import test from "node:test";
import { companyAnswer, type CompanyContext } from "../companyAgent";
import type { LiveAvailability } from "../api";
import { liveRead } from "../liveTimes";
import { bookableStart, clockIn, dayKeyIn, zoneFor } from "../openNow";
import type { Unclaimed } from "../../data/types";

/**
 * Otto and the picker two inches from it read one `GET /availability` answer, and they were reading it by
 * different rules.
 *
 * `liveTimes.ts` is the one reader both pickers use, and it drops four kinds of row before a guest sees a
 * chip: a departure the vendor says has no seats left, a row whose clock we could not read at all, a price of
 * nothing, and two trips at one start collapsed into the one time a guest can actually pick. The pickers then
 * put `bookableStart` over the top, which is what stops this morning's nine o'clock being offered at eight in
 * the evening, asked on the shop's clock rather than the guest's.
 *
 * Otto had its own twelve lines instead, and they kept all of that. The worst of it is the clock: "Next open
 * time is Sunday 9:00 AM" for a boat that sailed eleven hours ago, printed beside a picker correctly showing
 * nothing left today. `liveSlots` also feeds the "When's the next opening?" chip and `liveWindowEmpty`, so a
 * shop whose last departure of the fortnight has already left read to Otto as open for business.
 *
 * These tests name no date and no hour of their own: they are written against the real clock, the way the
 * product meets it, because a test that names a date goes red on its own the next morning.
 */

const HOURS = ["Monday: 9:00 AM - 5:00 PM", "Tuesday: 9:00 AM - 5:00 PM", "Wednesday: 9:00 AM - 5:00 PM", "Thursday: 9:00 AM - 5:00 PM", "Friday: 9:00 AM - 5:00 PM", "Saturday: 9:00 AM - 5:00 PM", "Sunday: 9:00 AM - 5:00 PM"];

const item = (extra: Partial<Unclaimed> = {}): Unclaimed =>
  ({
    id: "u-x", title: "Gulf Coast Parasail", cat: "water", art: "jetski", area: "Clearwater Beach, FL",
    metroId: "tampa", src: "example.com", options: [{ name: "Flight", price: 85 }], specs: [], includes: [],
    hoursText: HOURS, ...extra,
  }) as unknown as Unclaimed;

const ctx = (live: LiveAvailability | null, extra: Partial<Unclaimed> = {}): CompanyContext => ({ item: item(extra), contact: null, live });

/** A date key this many days after today where the shop stands, so no test here can name a day that goes stale. */
function dayAt(offset: number): string {
  const zone = zoneFor(item());
  const base = new Date(dayKeyIn(zone) + "T12:00:00Z");
  base.setUTCDate(base.getUTCDate() + offset);
  return base.toISOString().slice(0, 10);
}

const slot = (date: string, time: string, extra: Record<string, unknown> = {}) => ({
  startsAt: date + "T" + time,
  label: time + " · Flight",
  bookUrl: "x",
  ...extra,
});

const feed = (days: LiveAvailability["days"]): LiveAvailability => ({ vendor: "fareharbor", live: true, days });

/**
 * The whole invariant in one test, and the only honest way to write it without a clock to inject: every hour
 * of today and of tomorrow is on offer, and whatever Otto names as the next open time has to be the chip the
 * picker's own rules put first. Run at any hour, in any zone, this says the two surfaces agree.
 */
test("Otto names the departure the picker would offer first, at whatever hour it is asked", () => {
  const today = dayAt(0);
  const tomorrow = dayAt(1);
  const hours = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0") + ":00");
  const avail = feed([
    { date: today, slots: hours.map((t) => slot(today, t)) },
    { date: tomorrow, slots: hours.map((t) => slot(tomorrow, t)) },
  ]);

  const read = liveRead(avail);
  const stillOpen = bookableStart(item());
  const first = [today, tomorrow]
    .flatMap((d) => (read.chips.get(d) || []).map((c) => ({ date: d, chip: c })))
    .find((x) => stillOpen(x.date, x.chip.time));
  assert.ok(first, "the picker itself has something to offer");

  const text = companyAnswer(ctx(avail), "when's the next opening?").text;
  assert.match(text, new RegExp(first.chip.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "picker offers " + first.date + " " + first.chip.time + ", Otto said: " + text);
});

/**
 * The same thing stated the way a guest meets it, on the one shape that cannot be read two ways: a shop whose
 * whole window is this morning, and this morning is over. The picker draws an empty day. Otto used to answer
 * "Yes. Next open time is ..." and name a boat that had gone.
 */
test("a departure that has already left today is never named as the next open time", () => {
  const today = dayAt(0);
  const zone = zoneFor(item());
  const nowMin = clockIn(zone).minutes;
  // Every start of the day that is already behind the shop's clock, and nothing else in the window.
  const past = Array.from({ length: 24 }, (_, h) => h * 60).filter((m) => m + 60 < nowMin).map((m) => String(m / 60).padStart(2, "0") + ":00");
  if (!past.length) return; // Before 1 AM where the shop stands there is no past start to test with.
  const avail = feed([{ date: today, slots: past.map((t) => slot(today, t)) }]);

  for (const q of ["when's the next opening?", "can I book?", "do you have anything today?"]) {
    const text = companyAnswer(ctx(avail), q).text;
    for (const t of past) assert.ok(!text.includes(t), q + " named " + t + ", which has already left: " + text);
  }
});

/** A departure the vendor says is full is not a departure. Both pickers drop it; Otto was offering it. */
test("a sold out departure is not offered", () => {
  const d = dayAt(3);
  const avail = feed([{ date: d, slots: [slot(d, "09:00", { seatsLeft: 0 }), slot(d, "14:00", { seatsLeft: 6 })] }]);
  const text = companyAnswer(ctx(avail), "when's the next opening?").text;
  assert.ok(!text.includes("09:00"), text);
  assert.match(text, /14:00/, text);
});

/** A whole window of full departures is a shut calendar, and says so, exactly as the picker's note does. */
test("a window whose every departure is sold out reads as a shut calendar", () => {
  const days = Array.from({ length: 14 }, (_, i) => dayAt(i + 1)).map((d) => ({ date: d, slots: [slot(d, "09:00", { seatsLeft: 0 })] }));
  const text = companyAnswer(ctx(feed(days)), "can I book?").text;
  assert.match(text, /nothing open in it/, text);
  assert.ok(!text.includes("09:00"), text);
});

/** A row we cannot put a clock on is a vendor shape we do not understand, not a start time to read out. */
test("a departure with no readable clock is not read out as a start time", () => {
  const d = dayAt(3);
  const avail = feed([{ date: d, slots: [{ startsAt: d, label: "Ask us · Flight", bookUrl: "x" }, slot(d, "14:00")] }]);
  const text = companyAnswer(ctx(avail), "when's the next opening?").text;
  assert.ok(!text.includes("Ask us"), text);
  assert.match(text, /14:00/, text);
});

/** A price of nothing is no price. The pickers already refuse to print one; Otto was quoting "$0". */
test("a departure priced at nothing is named without a price", () => {
  const d = dayAt(3);
  const avail = feed([{ date: d, slots: [slot(d, "09:00", { priceCents: 0 })] }]);
  const text = companyAnswer(ctx(avail), "when's the next opening?").text;
  assert.ok(!text.includes("$0"), text);
  assert.match(text, /09:00/, text);
});

/**
 * Which day Otto says a departure is on. The booking window is ten days, so a weekday name on its own is the
 * same sentence for tonight and for a departure a week away, and the nearer reading is the one a guest acts
 * on: asked on a Tuesday, "Next open time is Tuesday 11:30 PM" sent them to the wrong one.
 */
test("a departure is named on a day a guest cannot read two ways", () => {
  const named = (offset: number, at: string): string => {
    const d = dayAt(offset);
    return companyAnswer(ctx(feed([{ date: d, slots: [slot(d, at)] }])), "when's the next opening?").text;
  };
  // Today's example has to be a start the shop's own clock has not passed, whatever hour this suite runs at.
  const ahead = clockIn(zoneFor(item())).minutes + 150;
  if (ahead < 24 * 60) {
    const t = String(Math.floor(ahead / 60)).padStart(2, "0") + ":00";
    assert.match(named(0, t), new RegExp("today " + t), named(0, t));
  }
  assert.match(named(1, "10:00"), /tomorrow 10:00/, named(1, "10:00"));
  // Inside the coming week a weekday says which day on its own, and carries no date.
  const soon = named(3, "10:00");
  assert.match(soon, /(Sun|Mon|Tues|Wednes|Thurs|Fri|Satur)day 10:00/, soon);
  assert.ok(!/January|February|March|April|May|June|July|August|September|October|November|December/.test(soon), soon);
  // A week out and further, the weekday alone is this week's day by any ordinary reading, so it names its date.
  for (const off of [7, 9]) {
    const far = named(off, "10:00");
    assert.match(far, /, (January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2} 10:00/, off + " days out: " + far);
  }
});

/**
 * Dates the vendor says are open and whose clock times the call budget never reached. An empty date there is
 * only empty as far as we looked, so nothing may call the shop shut, which is the rule `liveEmptyNote` keeps
 * for the picker. Peek marks such an answer partial as well, and did the work here on its own; this is the
 * same window with that flag off, which is the case a vendor shape we cannot read produces.
 */
test("a window of dates whose times we never read is never called shut", () => {
  const days = Array.from({ length: 14 }, (_, i) => dayAt(i + 1)).map((d) => ({ date: d, slots: [{ startsAt: d + "T00:00", label: "Available", bookUrl: "x", timeUnknown: true as const }] }));
  const text = companyAnswer(ctx(feed(days)), "can I book?").text;
  assert.ok(!/nothing open in it|next 14 days/.test(text), text);
});
