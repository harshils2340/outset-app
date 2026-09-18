import assert from "node:assert/strict";
import test from "node:test";
import type { Unclaimed } from "../../data/types";
import { defaultProfile, hoursLine, hoursRun, parseHours } from "../operator";
import { parseWeek } from "../openNow";

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

/**
 * The hours a claimed shop shows its guests. The dashboard keeps a 24 hour clock because that is what a time
 * input speaks, and the listing used to print it straight out: claiming a shop turned its own
 * "9:00 AM - 5:00 PM" into "Sun: 09:00 to 17:00", on the listing and in Otto's answer about opening time.
 */

const line = (open: string, close: string, closed = false) => hoursLine({ closed, open, close }, 0);

test("a claimed shop reads its hours to guests on a twelve hour clock", () => {
  assert.equal(line("09:00", "17:00"), "Sun: 9:00 AM to 5:00 PM");
  assert.equal(line("00:00", "12:00"), "Sun: 12:00 AM to 12:00 PM");
  assert.equal(line("18:30", "23:45"), "Sun: 6:30 PM to 11:45 PM");
  assert.equal(line("09:00", "17:00", true), "Sun: Closed");
});

test("the line a guest reads is still the week the app reads back", () => {
  // Open now, the calendar and the assistant all parse these lines again, including a close after midnight.
  const week = parseWeek([hoursLine({ closed: false, open: "18:00", close: "01:00" }, 5)]);
  assert.deepEqual(week?.[5], { open: 18 * 60, close: 25 * 60 });
  const plain = parseWeek([hoursLine({ closed: false, open: "10:00", close: "18:00" }, 2)]);
  assert.deepEqual(plain?.[2], { open: 10 * 60, close: 18 * 60 });
});

/**
 * The dashboard used to read these lines with a second parser of its own, and on 230 of the 4,482 shops
 * whose hours we hold it disagreed with the one the guest page uses. Every case below is a real shop's own
 * published line, and every one of them handed the owner a week their website never stated.
 */

test("an evening range keeps its pm on the hour it opens, not only the hour it shuts", () => {
  // adkkart.com: a karting track running 7pm to 9pm was handed a dashboard opening at 7 in the morning.
  assert.equal(week(["Wednesday - Friday: 7-9:00PM"]), "Sun off, Mon off, Tue off, Wed 19:00-21:00, Thu 19:00-21:00, Fri 19:00-21:00, Sat off");
  // ahoyrentals.com, where "1-5 PM" opened a boat rental at one in the morning.
  assert.equal(week(["Monday to Friday 1-5 PM"]), "Sun off, Mon 13:00-17:00, Tue 13:00-17:00, Wed 13:00-17:00, Thu 13:00-17:00, Fri 13:00-17:00, Sat off");
  // 18reasons.org: a 5 to 10:30 evening class, not a 5 AM one.
  assert.equal(week(["Monday through Thursday: 5-10:30 pm"]), "Sun off, Mon 17:00-22:30, Tue 17:00-22:30, Wed 17:00-22:30, Thu 17:00-22:30, Fri off, Sat off");
});

test("a shop that shuts after midnight closes on the next day's clock, and the calendar still finds its run", () => {
  // ajboatrental.com. A close at or before the open is what the two selects and `hoursRun` already speak.
  assert.equal(week(["Every day from 10AM to 12AM"]), open("10:00", "00:00"));
  assert.deepEqual(hoursRun(parseHours(["Every day from 10AM to 12AM"])[3]), { start: 10 * 60, end: 24 * 60 });
  // allseasonbrewing.com, open Friday and Saturday until two in the morning.
  assert.equal(week(["Friday-Saturday: 12pm-2am"]), "Sun off, Mon off, Tue off, Wed off, Thu off, Fri 12:00-02:00, Sat 12:00-02:00");
});

test("OpenStreetMap's own syntax is a week, not an unreadable line", () => {
  // acuitymaasc.com. 88 shops publish their hours this way, and every one of them got the invented 9 to 5.
  assert.equal(week(["Su off; Mo \"by appointment\"; Tu-Fr 09:00-16:30; Sa \"by appointment\""]), "Sun off, Mon off, Tue 09:00-16:30, Wed 09:00-16:30, Thu 09:00-16:30, Fri 09:00-16:30, Sat off");
});

test("a happy hour is not a trading hour on the dashboard either", () => {
  // deviantwolfebrewing.com published one line, and it was the two hours the beer is cheap.
  assert.equal(week(["Happy Hour Wednesday-Friday 12-6 PM"]), open("09:00", "17:00"));
});

test("a phone number glued to an hours line is not the hour it opens", () => {
  assert.equal(week(["(512) 436-3505Office Hours: 9am-6pm"]), open("09:00", "18:00"));
});

/**
 * Which lines the prefill reads at all. It read the synced contact record and nothing else, so 10,508 shops
 * whose hours a guest could read on their own listing page were handed a 9 to 5 the day they claimed, and the
 * page changed under them. `itemWeek` is what the listing page, the booking sheet and Otto read.
 */

const listing = (extra: Record<string, unknown>) =>
  ({ id: "o-test-com", title: "Test", src: "test.com", area: "Tampa, FL", cat: "water", art: "jetski", options: [], services: [], tags: [], includes: [], specs: [], gap: "", ...extra }) as unknown as Unclaimed;
const profileWeek = (u: Unclaimed) =>
  defaultProfile(u, { name: "O", email: "o@test.com", phone: "" }).hours.map((h, i) => D[i] + (h.closed ? " off" : " " + h.open + "-" + h.close)).join(", ");

test("a claim starts on the week the listing page was already showing", () => {
  assert.equal(profileWeek(listing({ hoursText: ["Fri-Sun 8:00 am - 6:00 pm"] })), "Sun 08:00-18:00, Mon off, Tue off, Wed off, Thu off, Fri 08:00-18:00, Sat 08:00-18:00");
  // The contact record is the fallback, the way the page falls back to it.
  assert.equal(profileWeek(listing({ contact: { domain: "test.com", hours: ["Mon-Fri 10am-4pm"] } })), "Sun off, Mon 10:00-16:00, Tue 10:00-16:00, Wed 10:00-16:00, Thu 10:00-16:00, Fri 10:00-16:00, Sat off");
  // Nothing published anywhere is still the plain 9 to 5 the owner confirms or corrects.
  assert.equal(profileWeek(listing({})), open("09:00", "17:00"));
});

test("a quiet hours line claims the same way it browses: no week at all", () => {
  // The 37 campgrounds whose only hours line is when nobody may make a noise.
  assert.equal(profileWeek(listing({ hoursText: ["Quiet hours are from 11:00pm - 8:00am"] })), open("09:00", "17:00"));
});
