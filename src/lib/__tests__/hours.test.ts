import assert from "node:assert/strict";
import test from "node:test";
import { parseHours } from "../operator";

/**
 * The week a shop gets the first time it claims, read from the hour lines its own website published.
 *
 * Every unnamed day used to keep an invented 9 to 5: "open Saturday & Sunday only" came out as a shop open
 * Monday to Friday, and a dropzone flying Friday through Sunday took Monday bookings. A day the site did not
 * name is a day it did not say it opens, so it starts closed and the owner switches on the ones they want.
 */

const D = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "Sun 11:00-19:00, Mon off, ..." so a failure reads as a week rather than as seven objects. */
const week = (lines: string[]) => parseHours(lines).map((h, i) => D[i] + (h.closed ? " off" : " " + h.open + "-" + h.close)).join(", ");
const open = (o: string, c: string) => [0, 1, 2, 3, 4, 5, 6].map((i) => D[i] + " " + o + "-" + c).join(", ");

test("a shop that published nothing starts on a plain nine to five it can correct", () => {
  assert.equal(week([]), open("09:00", "17:00"));
});

test("two days named only means the other five are not open", () => {
  assert.equal(week(["open Saturday & Sunday only from 11:00am to 7:00pm"]), "Sun 11:00-19:00, Mon off, Tue off, Wed off, Thu off, Fri off, Sat 11:00-19:00");
});

test("a range that wraps past Saturday keeps all three of its days", () => {
  assert.equal(week(["open year round, Friday through Sunday from 8:00 am to 6:00 pm"]), "Sun 08:00-18:00, Mon off, Tue off, Wed off, Thu off, Fri 08:00-18:00, Sat 08:00-18:00");
  // Thursday round to Monday is five days: Thu, Fri, Sat, Sun, Mon. Only Tuesday and Wednesday are off.
  assert.equal(week(["Thursday - Monday 10am-4pm"]), "Sun 10:00-16:00, Mon 10:00-16:00, Tue off, Wed off, Thu 10:00-16:00, Fri 10:00-16:00, Sat 10:00-16:00");
});

test("hours written with dots are still hours", () => {
  // Before this the whole line was dropped and the shop was handed a nine to five it never published.
  assert.equal(week(["Monday – Saturday: 9:00 a.m. – 6:00 p.m.", "Sundays: 12:00 – 5:00 p.m."]), "Sun 12:00-17:00, Mon 09:00-18:00, Tue 09:00-18:00, Wed 09:00-18:00, Thu 09:00-18:00, Fri 09:00-18:00, Sat 09:00-18:00");
});

test("a list of days is a list, not a range", () => {
  assert.equal(week(["Mon, Wed & Fri 10am-4pm"]), "Sun off, Mon 10:00-16:00, Tue off, Wed 10:00-16:00, Thu off, Fri 10:00-16:00, Sat off");
});

test("a day named with no hours on it is not an open day", () => {
  assert.equal(week(["Saturday & Sunday: 9am-5pm", "Monday-Friday: Open with reservation only"]), "Sun 09:00-17:00, Mon off, Tue off, Wed off, Thu off, Fri off, Sat 09:00-17:00");
});

test("daily, every day and seven days a week all mean the whole week", () => {
  assert.equal(week(["Monday-Sunday 7:00am-9:00pm"]), open("07:00", "21:00"));
  assert.equal(week(["Office open 7 days a week 9:00 am to 5:00 pm"]), open("09:00", "17:00"));
  assert.equal(week(["Open daily 8am-8pm"]), open("08:00", "20:00"));
});

test("hours with no day named at all still cover the week", () => {
  assert.equal(week(["10:00am - 6:00pm"]), open("10:00", "18:00"));
});

test("a closed line takes its day back off an open week", () => {
  assert.equal(week(["Open daily 9am-5pm", "Closed Sundays"]), "Sun off, Mon 09:00-17:00, Tue 09:00-17:00, Wed 09:00-17:00, Thu 09:00-17:00, Fri 09:00-17:00, Sat 09:00-17:00");
});

test("a line with no hours and no day changes nothing", () => {
  assert.equal(week(["Call ahead for private events"]), open("09:00", "17:00"));
  assert.equal(week(["Daily, 10am - last departure"]), open("09:00", "17:00"));
});

test("the later line wins, so a seasonal list ends on the season it is in", () => {
  assert.equal(week(["Jun 22 - Aug 9: 9am-8pm daily", "Sep 8 - Sep 27: 9am-5pm daily"]), open("09:00", "17:00"));
});
