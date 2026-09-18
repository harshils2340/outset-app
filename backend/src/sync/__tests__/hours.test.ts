import assert from "node:assert/strict";
import test from "node:test";
import { encodeWeek } from "../hours.ts";

/**
 * `encodeWeek` writes the compact week into `catalog.json` and `catalog-lite.json`, so it decides what a card
 * says before any detail file is fetched. It is the twin of `parseWeek` in `src/lib/openNow.ts` and the two
 * have to read a line the same way, or a card and the listing page it opens disagree about whether the shop
 * is open. Seventeen shops shipped a week no clock could show, because a phone number glued to the front of
 * the hours line reads as a time range: see the guest-side test for the whole story.
 */

const D = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const show = (w: ([number, number] | null)[] | null) =>
  w === null
    ? "(no hours)"
    : w
        .map((d, i) => {
          if (!d) return D[i] + " -";
          if (d[0] === 0 && d[1] === 0) return D[i] + " closed";
          const at = (m: number) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
          return D[i] + " " + at(d[0]) + "-" + at(d[1]);
        })
        .join(", ");
const everyDay = (span: string) => [0, 1, 2, 3, 4, 5, 6].map((i) => D[i] + " " + span).join(", ");

test("a phone number glued to the hours line is not a time range", () => {
  assert.equal(show(encodeWeek(["(512) 436-3505Office Hours: 9am-6pm"])), everyDay("09:00-18:00"));
  assert.equal(show(encodeWeek([")Telephone505-293-6800 (7am to 9pm"])), everyDay("07:00-21:00"));
});

test("a phone number glued to the day hides the day too", () => {
  // "3132Tuesday" has no word boundary in front of Tuesday, so the theatre published Friday alone at 52 o'clock.
  assert.equal(
    show(encodeWeek(["(610) 252-3132Tuesday - Friday, 10AM - 4PM"])),
    "Sun -, Mon -, Tue 10:00-16:00, Wed 10:00-16:00, Thu 10:00-16:00, Fri 10:00-16:00, Sat -",
  );
});

test("a line whose only readable time came out of a date says nothing", () => {
  assert.equal(show(encodeWeek(["Open House November 7, 2026 - 10:00 AM - 5:00 PM"])), "(no hours)");
  assert.equal(show(encodeWeek(["open to the public Sunday 4/14/2411am-1pm"])), "(no hours)");
});

test("a dot, a second and a missing separator are all still times", () => {
  assert.equal(show(encodeWeek(["Monday–Sunday 6.30 am – 7 pm"])), everyDay("06:30-19:00"));
  assert.equal(show(encodeWeek(["? We are open 7 days a week from 9:30:00 AM to 9:30 PM"])), everyDay("09:30-21:30"));
  assert.equal(show(encodeWeek(["Scroll HoursMONDAY 1130am-9PM"])), everyDay("11:30-21:00"));
});

test("a marker written once at the end of a range covers both ends of it", () => {
  // These are the hours the nightly sync bakes into the catalog, so a brewery that opens at three in the
  // afternoon has to be encoded as one, or every card and rail in the app says it is open all night.
  assert.equal(show(encodeWeek(["Mon-Thurs: 3:00 – 10:00 pm"])), "Sun -, Mon 15:00-22:00, Tue 15:00-22:00, Wed 15:00-22:00, Thu 15:00-22:00, Fri -, Sat -");
  assert.equal(show(encodeWeek(["Wednesday-Sunday, 1-6 PM"])), "Sun 13:00-18:00, Mon -, Tue -, Wed 13:00-18:00, Thu 13:00-18:00, Fri 13:00-18:00, Sat 13:00-18:00");
  // ...and a morning is still a morning.
  assert.equal(show(encodeWeek(["Daily 9-5"])), everyDay("09:00-17:00"));
  assert.equal(show(encodeWeek(["Daily 8-8"])), everyDay("08:00-20:00"));
  assert.equal(show(encodeWeek(["Daily 11:00-23:00"])), everyDay("11:00-23:00"));
});

test("the hours a shop keeps are still the hours it keeps", () => {
  assert.equal(show(encodeWeek(["Mon-Fri 9am-5pm"])), "Sun -, Mon 09:00-17:00, Tue 09:00-17:00, Wed 09:00-17:00, Thu 09:00-17:00, Fri 09:00-17:00, Sat -");
  assert.equal(show(encodeWeek(["Sat: 8-4"])), "Sun -, Mon -, Tue -, Wed -, Thu -, Fri -, Sat 08:00-16:00");
  assert.equal(show(encodeWeek(["Daily 6pm-2am"])), everyDay("18:00-26:00"));
  assert.equal(show(encodeWeek(["Tu-Fr 16:00-21:00; Sa 10:00-22:00; Su off"])), "Sun closed, Mon -, Tue 16:00-21:00, Wed 16:00-21:00, Thu 16:00-21:00, Fri 16:00-21:00, Sat 10:00-22:00");
});

test("no line can encode an hour the clock does not have", () => {
  const lines = [
    "(512) 436-3505Office Hours: 9am-6pm",
    "Open House November 7, 2026 - 10:00 AM - 5:00 PM",
    "June 13-28th Weekends 9AM-5PM",
    "Dec 23 - 26: CLOSED Dec 26 - 31: 9am - 1pm",
    "Open Heart General May 20, 20233:00pm - 5:00pm",
    "Open Hours May 10- May 31 - 9:00am - 5:00pm",
  ];
  for (const l of lines) {
    for (const d of encodeWeek([l]) || []) {
      if (!d || (d[0] === 0 && d[1] === 0)) continue;
      assert.ok(d[0] < 24 * 60, `${l} opens at ${d[0]} minutes`);
      assert.ok(d[1] > d[0] && d[1] - d[0] <= 24 * 60, `${l} spans ${d[0]} to ${d[1]}`);
    }
  }
});

test("quiet hours and happy hour are not opening hours", () => {
  // o-alpinelodgeandrv-com and 36 more campgrounds publish their quiet hours and nothing else, so the week
  // shipped in `catalog.json` was their opening hours turned inside out: [1320, 1920] on all seven days.
  assert.equal(show(encodeWeek(["Quiet Hours are from 10:00 PM to 8:00 AM"])), "(no hours)");
  assert.equal(show(encodeWeek(["? Yes, quiet hours are from 11:00pm - 8:00am"])), "(no hours)");
  // o-deviantwolfebrewing-com stated its real week first and its happy hour last, and the later line wins.
  assert.equal(
    show(encodeWeek(["Wed 12:00 PM - 10:00 PM", "Happy Hour Wednesday-Friday 12-6 PM"])),
    "Sun -, Mon -, Tue -, Wed 12:00-22:00, Thu -, Fri -, Sat -",
  );
  assert.equal(show(encodeWeek(["Happy Hour is Sunday 2:00-5:00PM, Mon-Fri 3:00-6:00PM"])), "(no hours)");
});

test("a day that never closes is not a day a shop stated its hours", () => {
  assert.equal(show(encodeWeek(["Mon-Sun 12:00 AM - 11:59 PM"])), "(no hours)");
  assert.equal(show(encodeWeek(["Mon 12:00 AM - 12:00 AM"])), "(no hours)");
  // o-jsma-uoregon-edu, a museum shut Monday and Tuesday: the days it did state survive.
  assert.equal(
    show(encodeWeek(["Mon 12:00 AM - 12:00 AM", "Tue 12:00 AM - 12:00 AM", "Wed 11:00 AM - 8:00 PM", "Thu-Sun 11:00 AM - 5:00 PM"])),
    "Sun 11:00-17:00, Mon -, Tue -, Wed 11:00-20:00, Thu 11:00-17:00, Fri 11:00-17:00, Sat 11:00-17:00",
  );
  // A stated closing time in the small hours still counts.
  assert.equal(show(encodeWeek(["Daily 6pm-2am"])), everyDay("18:00-26:00"));
  assert.equal(show(encodeWeek(["Daily 0:00-12:00"])), everyDay("00:00-12:00"));
});

/**
 * OpenStreetMap writes a week as a list of rules, separated by a semicolon, by "||" for a fallback rule, or
 * by a comma once the rule before it has stated its hours. Reading only the semicolon left a pilates studio
 * open one day out of five and a gallery with no Sunday, on both sides of the app at once.
 */
test("a comma after a rule's hours starts the next rule, and a comma before them lists days", () => {
  assert.equal(
    show(encodeWeek(["Tu 08:00-12:00, We 16:15-19:30, Th 08:00-13:00, Fr 07:30-12:00, Sa 09:00-12:00 || \"by appointment\""])),
    "Sun -, Mon -, Tue 08:00-12:00, Wed 16:15-19:30, Thu 08:00-13:00, Fri 07:30-12:00, Sat 09:00-12:00",
  );
  assert.equal(
    show(encodeWeek(["Fr,Sa 12:00-19:00, Su 12:00-16:00; \"by appointment\""])),
    "Sun 12:00-16:00, Mon -, Tue -, Wed -, Thu -, Fri 12:00-19:00, Sat 12:00-19:00",
  );
});
