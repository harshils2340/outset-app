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

test("a marker written once at the end of a range covers both ends of it", () => {
  // o-adventurebrewing-com opened at three in the morning, seven days a week, and so did 141 other shops:
  // breweries, tap rooms, theatres, a kart track. Every one of them writes the marker once, at the end.
  assert.equal(show(parseWeek(["Mon-Thurs: 3:00 – 10:00 pm"])), "Sun -, Mon 15:00-22:00, Tue 15:00-22:00, Wed 15:00-22:00, Thu 15:00-22:00, Fri -, Sat -");
  assert.equal(show(parseWeek(["Wednesday - Friday: 7-9:00PM"])), "Sun -, Mon -, Tue -, Wed 19:00-21:00, Thu 19:00-21:00, Fri 19:00-21:00, Sat -");
  assert.equal(show(parseWeek(["Wednesday-Sunday, 1-6 PM"])), "Sun 13:00-18:00, Mon -, Tue -, Wed 13:00-18:00, Thu 13:00-18:00, Fri 13:00-18:00, Sat 13:00-18:00");
  assert.equal(show(parseWeek(["Everyday we are open! 4:07 – 5:33 PM"])), everyDay("16:07-17:33"));
});

test("a morning is still a morning", () => {
  // The marker is only shared when the opening hour is the earlier of the two on a twelve hour clock. These
  // are the shapes that would break if it were shared blindly.
  assert.equal(show(parseWeek(["Daily 9-5"])), everyDay("09:00-17:00"));
  assert.equal(show(parseWeek(["Fri-Sat: 8:30-5"])), "Sun -, Mon -, Tue -, Wed -, Thu -, Fri 08:30-17:00, Sat 08:30-17:00");
  assert.equal(show(parseWeek(["Daily 10-6"])), everyDay("10:00-18:00"));
  assert.equal(show(parseWeek(["Daily 11-7"])), everyDay("11:00-19:00"));
  // Noon, which is where a twelve hour clock wraps, and the hour the marker is shared into.
  assert.equal(show(parseWeek(["Saturday 12 – 10 PM"])), "Sun -, Mon -, Tue -, Wed -, Thu -, Fri -, Sat 12:00-22:00");
  assert.equal(show(parseWeek(["Daily 12-5"])), everyDay("12:00-17:00"));
  // Both hours before noon: there is no afternoon marker to share.
  assert.equal(show(parseWeek(["Wednesday 7am – 9am"])), "Sun -, Mon -, Tue -, Wed 07:00-09:00, Thu -, Fri -, Sat -");
  // A range from an hour to the same hour is a twelve hour day, not a day that starts and ends at 8 PM.
  assert.equal(show(parseWeek(["Daily 8-8"])), everyDay("08:00-20:00"));
  // A twenty four hour clock carries no marker to share.
  assert.equal(show(parseWeek(["Daily 09:00-17:00"])), everyDay("09:00-17:00"));
  assert.equal(show(parseWeek(["Daily 11:00-23:00"])), everyDay("11:00-23:00"));
  assert.equal(show(parseWeek(["Daily 0:00-12:00"])), everyDay("00:00-12:00"));
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

test("a campground's quiet hours are not its opening hours", () => {
  // o-alpinelodgeandrv-com and 36 more publish one hours line and it is the hours nobody may make a noise.
  // Read as opening hours it is the week turned inside out: shut all afternoon, open all night.
  assert.equal(show(parseWeek(["Quiet Hours are from 10:00 PM to 8:00 AM"])), "(no hours)");
  assert.equal(show(parseWeek(["? Yes, quiet hours are from 11:00pm - 8:00am"])), "(no hours)");
  assert.equal(show(parseWeek(["Quiet hours are observed daily from 10:30 PM to 7:00 AM"])), "(no hours)");
  // The compact week already in `catalog.json` came out of that same line, so it is not believed either.
  const shipped = {
    id: "o-alpinelodgeandrv-com",
    title: "Alpine Lodge & RV Park",
    area: "Denver, CO",
    src: "alpinelodgeandrv.com",
    hrs: [0, 1, 2, 3, 4, 5, 6].map(() => [1320, 1920] as [number, number]),
    hoursText: ["Quiet Hours are from 10:00 PM to 8:00 AM"],
  } as unknown as Unclaimed;
  assert.equal(show(itemWeek(shipped)), "(no hours)");
  assert.equal(itemOpenState(shipped, new Date("2026-09-16T08:00:00Z")), null);
  // A shop that states both keeps the one that is its hours.
  const both = { ...shipped, hrs: undefined, hoursText: ["Daily 9am-5pm", "Quiet hours from 11:00 PM to 8:00 AM"] } as unknown as Unclaimed;
  assert.equal(show(itemWeek(both)), everyDay("09:00-17:00"));
});

test("a bar's happy hour does not close it four hours early", () => {
  // o-deviantwolfebrewing-com states its real week and then its happy hour, and the later line wins, so
  // Wednesday to Friday shut at 6 PM instead of 10. o-triplebottombrewing-com lost the same three days.
  const real = ["Wed 12:00 PM - 10:00 PM", "Thu 12:00 PM - 10:00 PM", "Fri 12:00 PM - 10:00 PM", "Happy Hour Wednesday-Friday 12-6 PM"];
  assert.equal(show(parseWeek(real)), "Sun -, Mon -, Tue -, Wed 12:00-22:00, Thu 12:00-22:00, Fri 12:00-22:00, Sat -");
  // o-marina27-com's happy hour line named two day ranges at once and opened the place at 2 AM.
  assert.equal(show(parseWeek(["Happy Hour is Sunday 2:00-5:00PM, Mon-Fri 3:00-6:00PM"])), "(no hours)");
  // o-brewingaugust-com publishes nothing else, so it publishes nothing.
  assert.equal(show(parseWeek(["Happy Hours Hours Monday 2 pm - 9 pm"])), "(no hours)");
});

test("a day that never closes is not a day a shop stated its hours", () => {
  // "12:00 AM - 11:59 PM" and "12:00 AM - 12:00 AM" are what a site builder writes into the markup when the
  // owner never set hours. 166 operators shipped one, 132 of them on all seven days.
  assert.equal(show(parseWeek(["Mon-Sun 12:00 AM - 11:59 PM"])), "(no hours)");
  assert.equal(show(parseWeek(["Mon 12:00 AM - 12:00 AM"])), "(no hours)");
  // The shop's real days on the same record survive: o-jsma-uoregon-edu is a museum shut Monday and Tuesday.
  assert.equal(
    show(parseWeek(["Mon 12:00 AM - 12:00 AM", "Tue 12:00 AM - 12:00 AM", "Wed 11:00 AM - 8:00 PM", "Thu-Sun 11:00 AM - 5:00 PM"])),
    "Sun 11:00-17:00, Mon -, Tue -, Wed 11:00-20:00, Thu 11:00-17:00, Fri 11:00-17:00, Sat 11:00-17:00",
  );
  // A day that runs to the small hours is a stated closing time and still counts.
  assert.equal(show(parseWeek(["Daily 6pm-2am"])), everyDay("18:00-26:00"));
  assert.equal(show(parseWeek(["Daily 0:00-12:00"])), everyDay("00:00-12:00"));
});

test("a whole-day week already in the catalog is not believed either", () => {
  // o-aerohelicoptertours-com and 165 more stood in "Open right now near you" at four in the morning under
  // "Open · closes 11:59 PM", a closing time none of them ever stated. A lite record carries no hour lines,
  // so the compact week has to refuse itself.
  const heli = {
    id: "o-aerohelicoptertours-com",
    title: "Aero Helicopter Tours of South Beach",
    area: "Miami Beach, FL",
    src: "aerohelicoptertours.com",
    hrs: [0, 1, 2, 3, 4, 5, 6].map(() => [0, 1439] as [number, number]),
  } as unknown as Unclaimed;
  assert.equal(show(itemWeek(heli)), "(no hours)");
  // 4 AM in Miami, which is Eastern.
  assert.equal(itemOpenState(heli, new Date("2026-09-16T08:00:00Z")), null);
  // o-lakefrontbrewery-com keeps the four days it did state.
  const brewery = { ...heli, area: "Milwaukee, WI", hrs: [[0, 1440], [660, 1260], [660, 1260], [660, 1260], [660, 1260], [0, 1440], [0, 1440]] } as unknown as Unclaimed;
  assert.equal(show(itemWeek(brewery)), "Sun -, Mon 11:00-21:00, Tue 11:00-21:00, Wed 11:00-21:00, Thu 11:00-21:00, Fri -, Sat -");
});

/**
 * OpenStreetMap writes a week as a list of rules, and the separator between two of them is a semicolon, "||"
 * for a fallback, or a comma once the rule before it has stated its hours. Reading only the semicolon left a
 * pilates studio open one day a week out of five, a gallery with no Sunday and a barre studio with no
 * weekend, on 5 of the 112 listings that publish their hours this way.
 */
test("a comma after a rule's hours starts the next rule, and a comma before them lists days", () => {
  const studio = parseWeek(["Tu 08:00-12:00, We 16:15-19:30, Th 08:00-13:00, Fr 07:30-12:00, Sa 09:00-12:00 || \"by appointment\""]);
  assert.equal(studio?.filter(Boolean).length, 5);
  assert.deepEqual(studio?.[2], { open: 8 * 60, close: 12 * 60 });
  assert.deepEqual(studio?.[6], { open: 9 * 60, close: 12 * 60 });
  assert.equal(studio?.[0], null);
  const gallery = parseWeek(["Fr,Sa 12:00-19:00, Su 12:00-16:00; \"by appointment\""]);
  assert.deepEqual(gallery?.[5], { open: 12 * 60, close: 19 * 60 });
  assert.deepEqual(gallery?.[6], { open: 12 * 60, close: 19 * 60 });
  assert.deepEqual(gallery?.[0], { open: 12 * 60, close: 16 * 60 });
});
