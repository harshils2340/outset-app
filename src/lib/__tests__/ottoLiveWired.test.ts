import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { availabilityNow, fetchAvailability, type LiveAvailability } from "../api";
import { companyAnswer, companySuggestions, type CompanyContext } from "../companyAgent";
import type { Unclaimed } from "../../data/types";

/**
 * Otto reading the shop's own booking calendar, which for as long as it has been able to read one it never did.
 *
 * `CompanyContext.live` is the whole of what the assistant knows about live availability: `liveSlots` reads it,
 * the "When's the next opening?" chip is only offered when it holds a departure, and a window it covers and
 * finds empty is the one thing that stops Otto reading out published hours over a shut calendar. Nothing ever
 * filled it in. All three places that built a context passed the item and the contact record and stopped, so
 * every one of those rules was dead code in the product: a guest asking "anything Saturday?" at a shop whose
 * calendar the booking box on the same page had already read was answered from the published hours, and at a
 * shop whose calendar we read and found empty Otto said "pick a time on this page" beside a picker correctly
 * offering nothing on any date. The comment above `fetchAvailability` had said for weeks that "the booking box,
 * the phone sheet and the assistant" all ask for the same dates. Two of them did.
 *
 * So this reads the wiring out of the source of all three, because that is the thing that was missing, and a
 * context built without `live` is invisible from inside `companyAgent`.
 */

const here = dirname(fileURLToPath(import.meta.url));

const HOURS = ["Monday: 9:00 AM - 5:00 PM", "Tuesday: 9:00 AM - 5:00 PM", "Wednesday: 9:00 AM - 5:00 PM", "Thursday: 9:00 AM - 5:00 PM", "Friday: 9:00 AM - 5:00 PM", "Saturday: 9:00 AM - 5:00 PM", "Sunday: 9:00 AM - 5:00 PM"];

const ctx = (live: LiveAvailability | null): CompanyContext => ({
  item: {
    id: "o-example-com", title: "Gulf Coast Parasail", cat: "water", art: "jetski", area: "Clearwater Beach, FL",
    metroId: "tampa", src: "example.com", options: [{ name: "Flight", price: 85 }], specs: [], includes: [],
    hoursText: HOURS,
  } as unknown as Unclaimed,
  contact: null,
  live,
});

/**
 * A date this many days out, rather than one written down. Otto now reads the calendar through the same
 * `bookableStart` the pickers do, so a departure named by a fixed date stops being in the future one morning
 * and takes the test with it.
 */
function dayAt(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const withTimes: LiveAvailability = {
  vendor: "fareharbor",
  live: true,
  days: [
    { date: dayAt(2), slots: [] },
    { date: dayAt(3), slots: [{ startsAt: dayAt(3) + "T14:00", label: "2:00 PM · Parasail Flight", bookUrl: "x", seatsLeft: 3 }] },
  ],
};

test("the three surfaces that ask Otto a question fill in the calendar it answers from", () => {
  const app = readFileSync(join(here, "../../state/AppProvider.tsx"), "utf8");
  /**
   * One helper, read three times: the greeting, the suggestion chips and the reply. Three literals were what
   * let two of them drift from the third for the whole life of the field, so the test asks for the helper.
   */
  assert.match(app, /function companyCtx\([^)]*\)/, "AppProvider builds one context for Otto");
  assert.match(app, /live: availabilityNow\(/, "and fills in the shop's own calendar");
  for (const call of ["companySuggestions(companyCtx(", "companyGreeting(companyCtx(", "companyAnswer(ctx,"]) {
    assert.ok(app.includes(call), "AppProvider: " + call + " reads the shared context");
  }
  // A chat opened from the Inbox has no booking box behind it, so something has to ask.
  assert.match(app, /fetchAvailability\(/, "the chat screen asks for the calendar itself");
  assert.ok(!/\{ item: company, contact: contactFor\(company\) \}/.test(app), "no context is built without the calendar");
  assert.ok(!/companySuggestions\(\{ item: u, contact: contactFor\(u\) \}\)/.test(app), "including the thread's chips");

  const op = readFileSync(join(here, "../../components/operator/OpAssistant.tsx"), "utf8");
  // The operator's test chat promises, in its own comment, to run "the same code guests get".
  assert.match(op, /fetchAvailability\(/, "the operator's test chat reads the same calendar");
  assert.match(op, /contact: contactFor\(u\), live\b/, "and passes it to Otto");
  /**
   * The same window, too. It asked for `fetchAvailability`'s wider default of 14 days while every guest
   * surface asked for ten, so a shop with nothing in the next ten days and a departure on the twelfth had
   * Otto naming that opening to the operator and telling their guest the calendar was empty, on the one page
   * whose promise is that the two agree. One exported number now, read by everything that asks.
   */
  assert.match(op, /BOOKING_WINDOW_DAYS/, "the operator's test chat asks for the guest's window");
  assert.match(app, /makeDates\(BOOKING_WINDOW_DAYS\)/, "and the guest's window is that same number");
  for (const src of [app, op]) assert.ok(!/fetchAvailability\(\s*u\.id\s*\)/.test(src), "nobody falls back to the wider default");
});

test("a departure the calendar names is what Otto answers with, and the chip is offered", () => {
  const c = ctx(withTimes);
  assert.match(companyAnswer(c, "when's the next opening?").text, /2:00 PM/);
  assert.match(companyAnswer(c, "can I book?").text, /2:00 PM/);
  // "When's the next opening?" is only offered when there is an opening to name, so an unwired context meant
  // a chip the guest was never shown and a question the fiftieth run had just spent a commit answering.
  assert.ok(companyAnswer(c, "how much is it?").chips.some((s) => /next opening/i.test(s)), "the chip needs a live slot to be offered at all");
  // And with no calendar, exactly what it said before: published hours, and no chip about an opening.
  const blind = ctx(null);
  assert.ok(!/2:00 PM/.test(companyAnswer(blind, "can I book?").text));
  assert.ok(!companyAnswer(blind, "how much is it?").chips.some((s) => /next opening/i.test(s)));
  // The thread's opening chips are a fixed set, and the calendar is not one of the things they read.
  assert.deepEqual(companySuggestions(c), companySuggestions(blind));
});

/**
 * The snapshot the assistant reads. Otto answers synchronously, out of a reducer, so it cannot await anything:
 * the answer has to already be in hand, and be the answer for this listing and no other.
 */
test("the calendar is remembered per listing once it arrives, and never guessed at", async () => {
  assert.equal(availabilityNow("o-never-asked-com"), null, "nothing is claimed before anything is asked");
  const answer = await fetchAvailability("o-asked-com", "2026-10-01", 10);
  assert.deepEqual(availabilityNow("o-asked-com"), answer, "what arrived is what Otto reads");
  assert.equal(availabilityNow("o-another-com"), null, "one shop's calendar is not another's");
  // With no API this is the no-feed answer, and `liveSlots` treats it exactly as it treats null.
  assert.equal(answer.live, false);
  assert.equal(companyAnswer(ctx(answer), "can I book?").text, companyAnswer(ctx(null), "can I book?").text);
});
