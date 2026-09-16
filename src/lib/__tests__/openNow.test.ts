import assert from "node:assert/strict";
import test from "node:test";
import type { Unclaimed } from "../../data/types";
import { itemOpenState, itemWeek, openStateAt, parseWeek, type Week } from "../openNow";

/**
 * "Open now" on a card, on the listing page, in the booking sheet and in Otto's answers, read off whatever
 * hours line the crawl found on the operator's own site.
 *
 * A crawled line is one run of text, and the crawler often glues the shop's phone number on to the front of
 * it with no space between. Read left to right, the digits in a phone number are a perfectly good time range,
 * so the hours behind it were never reached. Seventeen shops in the shipped catalog opened at an hour no
 * clock has: an Austin boat rental at 36:00, a Pennsylvania theatre at 52:00. The listing said "Closed,
 * opens 12 PM" at every hour of every day, and a balloon ride in Albuquerque told guests at three in the
 * morning that it was open until 5 AM.
 */

const D = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "Sun 9:00-18:00, Mon off, ..." so a failure reads as a week rather than as seven objects. */
const show = (w: Week | null) =>
  w === null
    ? "(no hours)"
    : w
        .map((d, i) => {
          if (!d) return D[i] + " -";
          if (d.open === 0 && d.close === 0) return D[i] + " closed";
          const at = (m: number) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
          return D[i] + " " + at(d.open) + "-" + at(d.close);
        })
        .join(", ");
const everyDay = (span: string) => [0, 1, 2, 3, 4, 5, 6].map((i) => D[i] + " " + span).join(", ");

test("a phone number glued to the hours line is not a time range", () => {
  // o-rentalboataustin-com: opened at 36:00 and closed at 47:00, every day of the week.
  assert.equal(show(parseWeek(["(512) 436-3505Office Hours: 9am-6pm"])), everyDay("09:00-18:00"));
  // o-worldballoon-com: "05-293" read as 5 AM to 5 AM, so it claimed to be open right through the night.
  assert.equal(show(parseWeek([")Telephone505-293-6800 (7am to 9pm"])), everyDay("07:00-21:00"));
  // o-statetheatre-org: "52-31" swallowed Tuesday through Friday and left one day at 52 o'clock.
  assert.equal(show(parseWeek(["(610) 252-3132Tuesday - Friday, 10AM - 4PM"])), "Sun -, Mon -, Tue 10:00-16:00, Wed 10:00-16:00, Thu 10:00-16:00, Fri 10:00-16:00, Sat -");
});

test("hours behind a phone number are found rather than lost", () => {
  // Both of these published nothing at all before: the phone number matched first and failed the sanity
  // check inside the old parser, so the shop looked like it had never stated its hours.
  assert.equal(show(parseWeek(["for 1-833-907-3087 Mon - Fri: 9am-6pm"])), "Sun -, Mon 09:00-18:00, Tue 09:00-18:00, Wed 09:00-18:00, Thu 09:00-18:00, Fri 09:00-18:00, Sat -");
  assert.equal(show(parseWeek(["630-896-6666 OPEN MON-SAT 10AM-6PM"])), "Sun -, Mon 10:00-18:00, Tue 10:00-18:00, Wed 10:00-18:00, Thu 10:00-18:00, Fri 10:00-18:00, Sat 10:00-18:00");
});

test("a date in front of the hours does not become the opening time", () => {
  // o-baltimoreinnerharbormarina-com read "23 - 26" and opened at 11 PM.
  assert.equal(show(parseWeek(["Dec 23 - 26: CLOSED Dec 26 - 31: 9am - 1pm"])), everyDay("09:00-13:00"));
  // o-barneysdrumheller-com read "13-28" and opened at 1 PM until 4 AM.
  assert.equal(show(parseWeek(["June 13-28th Weekends 9AM-5PM"])), "Sun 09:00-17:00, Mon -, Tue -, Wed -, Thu -, Fri -, Sat 09:00-17:00");
  // o-glenmorecurling-com read "26-09" out of an ISO date and opened at 2 AM.
  assert.equal(show(parseWeek(["Open House Fri, 2026-09-25 7:00 pm -10:00 pm"])), "Sun -, Mon -, Tue -, Wed -, Thu -, Fri 19:00-22:00, Sat -");
});

test("a line whose only readable time is a date says nothing rather than guessing", () => {
  // o-hagginmuseum-org put a one-off open house on all seven days at 26 o'clock. A shop that has not stated
  // its weekly hours has not stated them: silence is the honest answer, not a time taken off a calendar.
  assert.equal(show(parseWeek(["Open House November 7, 2026 - 10:00 AM - 5:00 PM"])), "(no hours)");
  assert.equal(show(parseWeek(["2026 - 10am to 4pm"])), "(no hours)");
  // o-martinezhistory-org: "2411am" is the fourteenth of April and eleven o'clock, and 24am is not a time.
  assert.equal(show(parseWeek(["open to the public Sunday 4/14/2411am-1pm"])), "(no hours)");
});

test("the three ways a shop writes a time that is still a time", () => {
  // A dot for the colon (o-atxmarinabarge-com, o-carsonvalleygolf-com).
  assert.equal(show(parseWeek(["Monday–Sunday 6.30 am – 7 pm"])), everyDay("06:30-19:00"));
  assert.equal(show(parseWeek(["Open 7 days, 7.30am to 6pm"])), everyDay("07:30-18:00"));
  // Seconds on the clock (o-detroitcharterco-com).
  assert.equal(show(parseWeek(["? We are open 7 days a week from 9:30:00 AM to 9:30 PM"])), everyDay("09:30-21:30"));
  // No separator at all (o-burnindaylightbrewing-com, o-aircity360-com).
  assert.equal(show(parseWeek(["Scroll HoursMONDAY 1130am-9PM"])), everyDay("11:30-21:00"));
  assert.equal(show(parseWeek(["of OperationMonday: 330pm-8pm"])), everyDay("15:30-20:00"));
});

test("a space before the marker means the digits in front are a date, not a clock", () => {
  // o-ogdgc-org: "October 317 am" is the thirty-first and seven o'clock, never 3:17 in the morning.
  const w = parseWeek(["Open (Course Closed)Saturday, October 317 am - 6pm"]);
  assert.ok(!w?.[6] || w[6].open >= 6 * 60, "a Saturday opening before 6 AM came out of the date, not the hours");
});

test("a week already baked into the catalog that no clock could show is not believed", () => {
  // `catalog.json` is regenerated by the nightly sync, so the seventeen impossible weeks outlive this fix on
  // every guest's copy until it next runs. o-rentalboataustin-com opens at 36:00 there and its own line says
  // 9am-6pm: the card and the listing read the line rather than repeating "Closed, opens 12 PM" all day.
  const shipped = {
    id: "o-rentalboataustin-com",
    title: "Float On - Lake Austin Boat Rentals",
    area: "Austin, TX",
    src: "rentalboataustin.com",
    lat: 30.3485572,
    lon: -97.7974679,
    hrs: [0, 1, 2, 3, 4, 5, 6].map(() => [2160, 2820] as [number, number]),
    hoursText: ["(512) 436-3505Office Hours: 9am-6pm"],
  } as unknown as Unclaimed;
  assert.equal(show(itemWeek(shipped)), everyDay("09:00-18:00"));
  // Noon in Austin, which is Central: open, and not "opens 12 PM" while it is already 12 PM.
  assert.equal(itemOpenState(shipped, new Date("2026-09-16T17:00:00Z"))?.line, "Open · closes 6 PM");
  // A shop whose compact week is fine is still read straight off it, with no fallback.
  const fine = { ...shipped, hrs: [0, 1, 2, 3, 4, 5, 6].map(() => [600, 1200] as [number, number]) } as unknown as Unclaimed;
  assert.equal(show(itemWeek(fine)), everyDay("10:00-20:00"));
  // A stated day off survives: [0, 0] is "closed", not "unreadable".
  const off = { ...fine, hrs: [[0, 0], [600, 1200], [600, 1200], [600, 1200], [600, 1200], [600, 1200], [600, 1200]] } as unknown as Unclaimed;
  assert.equal(show(itemWeek(off)), "Sun closed, " + [1, 2, 3, 4, 5, 6].map((i) => D[i] + " 10:00-20:00").join(", "));
});

test("the hours a shop keeps are still the hours it keeps", () => {
  assert.equal(show(parseWeek(["Mon-Fri 9am-5pm"])), "Sun -, Mon 09:00-17:00, Tue 09:00-17:00, Wed 09:00-17:00, Thu 09:00-17:00, Fri 09:00-17:00, Sat -");
  assert.equal(show(parseWeek(["Daily 10:00 AM to 6:00 PM"])), everyDay("10:00-18:00"));
  assert.equal(show(parseWeek(["Sat: 8-4"])), "Sun -, Mon -, Tue -, Wed -, Thu -, Fri -, Sat 08:00-16:00");
  assert.equal(show(parseWeek(["Daily 6pm-2am"])), everyDay("18:00-26:00"));
  assert.equal(show(parseWeek(["Daily 9am-5pm", "Closed Sunday"])), "Sun closed, Mon 09:00-17:00, Tue 09:00-17:00, Wed 09:00-17:00, Thu 09:00-17:00, Fri 09:00-17:00, Sat 09:00-17:00");
  assert.equal(show(parseWeek(["Tu-Fr 16:00-21:00; Sa 10:00-22:00; Su off"])), "Sun closed, Mon -, Tue 16:00-21:00, Wed 16:00-21:00, Thu 16:00-21:00, Fri 16:00-21:00, Sat 10:00-22:00");
});

test("a shop no longer tells a guest at three in the morning that it is open", () => {
  const w = parseWeek([")Telephone505-293-6800 (7am to 9pm"]);
  // 3 AM on a Wednesday, the hour the old reading called open.
  assert.equal(openStateAt(w, { day: 3, minutes: 3 * 60 })?.line, "Closed · opens 7 AM");
  assert.equal(openStateAt(w, { day: 3, minutes: 12 * 60 })?.line, "Open · closes 9 PM");
  // A late closer is still open after midnight: the fix must not take that away.
  const late = parseWeek(["Daily 6pm-2am"]);
  assert.equal(openStateAt(late, { day: 3, minutes: 30 })?.line, "Open · closes 2 AM");
  assert.equal(openStateAt(late, { day: 3, minutes: 90 })?.line, "Closes soon · 2 AM");
});
