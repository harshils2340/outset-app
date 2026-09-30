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

test("an hour the clock refuses does not take the hour behind it away", () => {
  // The twin of the guest-side rule. The scan read on from the end of a refused candidate, so whatever that
  // candidate covered went with it: o-maplemuseumcentre-org's one line, "2026 - 10am to 4pm", offers
  // "26 - 10am" first, and the ten o'clock behind it was never reached, so the card said nothing at all.
  assert.equal(show(encodeWeek(["2026 - 10am to 4pm"])), everyDay("10:00-16:00"));
  assert.equal(show(encodeWeek(["Open Hours May 10- May 31 - 9:00am - 5:00pm"])), everyDay("09:00-17:00"));
  // A range the clock can show and the whole-day or length rule then refuses is read past, not picked apart.
  assert.equal(show(encodeWeek(["Mon-Sun 12:00 AM - 11:59 PM"])), "(no hours)");
  assert.equal(show(encodeWeek(["Mon-Sun 1:00 AM - 1:00 AM"])), "(no hours)");
  assert.equal(show(encodeWeek(["open from 6:00pm - 6:25pm"])), "(no hours)");
});

test("a bracket in front of a rule's clock still opens the rule", () => {
  // The twin of the guest-side cut, on the two campgrounds whose brackets the crawl left open.
  assert.equal(
    show(encodeWeek(["Mon/Wed-Sat (Noon-6pm) Sun (11am-4pm"])),
    "Sun 11:00-16:00, Mon 12:00-18:00, Tue -, Wed 12:00-18:00, Thu 12:00-18:00, Fri 12:00-18:00, Sat 12:00-18:00",
  );
  assert.equal(
    show(encodeWeek(["Mon-Sat (Noon-7pm) Sun (11am-4pm"])),
    "Sun 11:00-16:00, Mon 12:00-19:00, Tue 12:00-19:00, Wed 12:00-19:00, Thu 12:00-19:00, Fri 12:00-19:00, Sat 12:00-19:00",
  );
  assert.equal(show(encodeWeek(["Mon-Fri 9am-5pm (Sat by appointment)"])), "Sun -, Mon 09:00-17:00, Tue 09:00-17:00, Wed 09:00-17:00, Thu 09:00-17:00, Fri 09:00-17:00, Sat -");
});

test("a date written in digits is one day too", () => {
  // The twin of the guest-side rule, on the four shipped lines that write the date in digits: one open house,
  // one guided tour, one open play and one Monday, each of which had become the shop's whole week.
  assert.equal(show(encodeWeek(["MONDAY 9/7/26 1pm-5pm"])), "(no hours)");
  assert.equal(show(encodeWeek(["Open Tour 09/13/2026 1:00 PM - 4:00 PM"])), "(no hours)");
  assert.equal(show(encodeWeek(["Open House Fri, 2026-09-25 7:00 pm -10:00 pm"])), "(no hours)");
  assert.equal(show(encodeWeek(["Open House Sat, 10-17-2026 8:30 am -11:30 am"])), "(no hours)");
  assert.equal(show(encodeWeek(["8/15/22Monday10:00am - 7:00pm"])), "(no hours)");
  assert.equal(
    show(encodeWeek(["Open Play- 8/22/26 11am-4pm", "Friday 11:00am - 7:00PM", "Saturday 11:00AM - 7:00PM"])),
    "Sun -, Mon -, Tue -, Wed -, Thu -, Fri 11:00-19:00, Sat 11:00-19:00",
  );
  // A year is what tells a date from a season, and a run word still opens a run of days rather than one.
  assert.equal(show(encodeWeek(["Early Season (5/30 - 6/12) 10:00 a.m. to 5:00 p.m."])), everyDay("10:00-17:00"));
  assert.equal(show(encodeWeek(["Open daily starting 9/1/26 10am-5pm"])), everyDay("10:00-17:00"));
});

test("a dot, a second and a missing separator are all still times", () => {
  assert.equal(show(encodeWeek(["Monday–Sunday 6.30 am – 7 pm"])), everyDay("06:30-19:00"));
  assert.equal(show(encodeWeek(["? We are open 7 days a week from 9:30:00 AM to 9:30 PM"])), everyDay("09:30-21:30"));
  // The heading glued to the front of the day is a seam now, so the line is the one day it names.
  assert.equal(show(encodeWeek(["Scroll HoursMONDAY 1130am-9PM"])), "Sun -, Mon 11:30-21:00, Tue -, Wed -, Thu -, Fri -, Sat -");
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

test("Thursday is a day however the shop abbreviates it", () => {
  // The twin of the guest side's day reader. 25 shops state a Thursday that "Thur" and "Thurs" kept out of it.
  assert.equal(
    show(encodeWeek(["Sun, Mon, Tue, Wed, Thur 11:00 AM - 9:00 PM"])),
    "Sun 11:00-21:00, Mon 11:00-21:00, Tue 11:00-21:00, Wed 11:00-21:00, Thu 11:00-21:00, Fri -, Sat -",
  );
  assert.equal(show(encodeWeek(["Weds & Thurs: 12 PM - 6 PM"])), "Sun -, Mon -, Tue -, Wed 12:00-18:00, Thu 12:00-18:00, Fri -, Sat -");
  assert.equal(show(encodeWeek(["THURS: 4PM-10PM"])), "Sun -, Mon -, Tue -, Wed -, Thu 16:00-22:00, Fri -, Sat -");
  // The words those prefixes open which are not days state no day, so none of them may add one.
  assert.equal(show(encodeWeek(["Sat 10am-4pm, last entry at sunset"])), "Sun -, Mon -, Tue -, Wed -, Thu -, Fri -, Sat 10:00-16:00");
  assert.equal(show(encodeWeek(["first Sunday of the month 10am-4pm"])), "Sun 10:00-16:00, Mon -, Tue -, Wed -, Thu -, Fri -, Sat -");
  assert.equal(show(encodeWeek(["Available for your wedding 9am-5pm"])), everyDay("09:00-17:00"));
});

test("a range of days is still a range with the clock glued on to its last day", () => {
  // The twin of the guest side's day reader, over the 186 listings whose range the crawl glued the clock to.
  assert.equal(show(encodeWeek(["Monday-Thursday9:00 AM - 5:00 PM"])), "Sun -, Mon 09:00-17:00, Tue 09:00-17:00, Wed 09:00-17:00, Thu 09:00-17:00, Fri -, Sat -");
  assert.equal(show(encodeWeek(["Monday - Sunday10am-10pm"])), everyDay("10:00-22:00"));
  assert.equal(show(encodeWeek(["OPEN Tuesday - Saturdayfrom 9:00 am - 4:00 pm"])), "Sun -, Mon -, Tue 09:00-16:00, Wed 09:00-16:00, Thu 09:00-16:00, Fri 09:00-16:00, Sat 09:00-16:00");
  assert.equal(show(encodeWeek(["Tuesday-SundayCLOSED MONDAYS10 am - 5 pm"])), "Sun 10:00-17:00, Mon closed, Tue 10:00-17:00, Wed 10:00-17:00, Thu 10:00-17:00, Fri 10:00-17:00, Sat 10:00-17:00");
  assert.equal(show(encodeWeek(["Mon - Fri 9am-5pm"])), "Sun -, Mon 09:00-17:00, Tue 09:00-17:00, Wed 09:00-17:00, Thu 09:00-17:00, Fri 09:00-17:00, Sat -");
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
  // A third subject: one entry from the shop's own event calendar, one date and one time. The guest side drops
  // the same lines, or a card and its listing page disagree.
  assert.equal(show(encodeWeek(["Open Studio November 21 @ 11:00 am - 2:00 pm"])), "(no hours)");
  assert.equal(show(encodeWeek(["Pinned Butterflies September 10 @ 5:30 PM - 7:00 PM"])), "(no hours)");
  assert.equal(show(encodeWeek(["September 17 @ 4:00 pm - 6:00 pm"])), "(no hours)");
  // An "@" between the days and the time is how three shops write an ordinary week, so it stays.
  assert.equal(show(encodeWeek(["Mon - Sun @ 8AM - 5PM"])), everyDay("08:00-17:00"));
  assert.equal(show(encodeWeek(["May 1 - November 1: 11am - 6pm"])), everyDay("11:00-18:00"));
});

test("a noise rule worded without the word hours is still a noise rule", () => {
  // Four shops state when nobody may make a noise and state nothing else, so each said "Closed, opens 10 PM"
  // at lunchtime: o-daytonaspeedwayrv-com, o-roystonehotsprings-com, o-redbearresort-com, o-rosepointpark-com.
  assert.equal(show(encodeWeek(["Quiet time is observed from 10:00 PM - 7:00 AM"])), "(no hours)");
  assert.equal(show(encodeWeek(["Quiet time is from 10:00 PM to 8:00 AM"])), "(no hours)");
  assert.equal(show(encodeWeek(["designated as quiet time?Yes, 11pm to 8 am"])), "(no hours)");
  assert.equal(show(encodeWeek(["Quiet to be maintained from 11:00PM to 8:00AM"])), "(no hours)");
  // Quiet Times Golf Course is a real business, and a shop's own name in front of its hours is still its hours.
  assert.equal(show(encodeWeek(["Quiet Times Golf Course: Mon-Sun 7am-7pm"])), everyDay("07:00-19:00"));
  assert.equal(show(encodeWeek(["Inner Quiet Yoga, Monday to Friday 8:30 - 9:30am"])), "Sun -, Mon 08:30-09:30, Tue 08:30-09:30, Wed 08:30-09:30, Thu 08:30-09:30, Fri 08:30-09:30, Sat -");
});

test("the last thing a shop sells is not when its door shuts", () => {
  // o-jcprd-com's whole Hours block, which read as a county park open for one hour a day, seven days a week.
  assert.equal(show(encodeWeek(["Last rental 2:30 - 3:30 pm"])), "(no hours)");
  // o-cloudchasers-skydiving-com, whose other line states no range, so the centre opened at 3 PM.
  assert.equal(show(encodeWeek(["First appointment at 8 am", "Last appointment 3 to 5 pm depending on season"])), "(no hours)");
  // One time rather than a range never built a week, so those 14 lines stay beside the hours they belong to.
  assert.equal(
    show(encodeWeek(["open 7 days a week from 9am-4pm", "Last ticket sold at 3 p.m."])),
    everyDay("09:00-16:00"),
  );
  assert.equal(
    show(encodeWeek(["Mon-Sun 10:00am-5:00pm", "Last entry into the park for Day Pass Holders is 4:30 pm"])),
    everyDay("10:00-17:00"),
  );
  // A last admission in brackets behind the real hours is the shop's own line and keeps its week.
  assert.equal(show(encodeWeek(["Open Daily 10 a.m.-8 p.m. (last admission 7 p.m.)"])), everyDay("10:00-20:00"));
  // 16 businesses are named Last something, and none of them is selling a last rental.
  assert.equal(show(encodeWeek(["Last Wave Brewing Company, Mon-Sun 12 to 9 pm"])), everyDay("12:00-21:00"));
});

test("one closed date is one day, and a run of days is the shop's week", () => {
  // Most of the 245 listings whose hour line names a date write no "@" at all. One closed date is one
  // afternoon: an open house, an open mic, a Fourth of July, a Christmas Day. The guest side drops the same
  // lines, or a card and its listing page disagree.
  assert.equal(show(encodeWeek(["Open House September 30, 2026 4:00pm - 6:00pm"])), "(no hours)");
  assert.equal(show(encodeWeek(["Sunday, August 16, 2026 - 1:00 pm - 3:00 pm"])), "(no hours)");
  assert.equal(show(encodeWeek(["Open Mic Night Sep 11 7 pm - 9 pm"])), "(no hours)");
  assert.equal(show(encodeWeek(["Thursday, May 8: 11AM - 8PM"])), "(no hours)");
  assert.equal(show(encodeWeek(["June 19: Public Swim Only 1:00pm - 6:45pm"])), "(no hours)");
  assert.equal(
    show(encodeWeek(["Fri, Sat 11:00 AM - 10:00 PM", "Sun, Mon, Tue, Wed, Thu 11:00 AM - 9:00 PM", "July 4th Hours: 11 AM - 7:00 PM"])),
    "Sun 11:00-21:00, Mon 11:00-21:00, Tue 11:00-21:00, Wed 11:00-21:00, Thu 11:00-21:00, Fri 11:00-22:00, Sat 11:00-22:00",
  );
  // A run of days is a season, named by a second month, by a second day of the month, or by a run word.
  assert.equal(show(encodeWeek(["May through August 9: 5:30am-5:30pm"])), everyDay("05:30-17:30"));
  assert.equal(show(encodeWeek(["Sep 28 - Oct 18: 12pm - 6pm"])), everyDay("12:00-18:00"));
  assert.equal(show(encodeWeek(["10am-6pm Daily starting Monday, Sept 7th"])), everyDay("10:00-18:00"));
  assert.equal(show(encodeWeek(["Open daily until October 31st from 11:00AM-5:00PM"])), everyDay("11:00-17:00"));
  // A day number is not a clock, and the syntax's own exception clause is not one afternoon.
  assert.equal(show(encodeWeek(["October 11:00AM - 4:00PM"])), everyDay("11:00-16:00"));
  assert.equal(
    show(encodeWeek(["Fr-Sa 12:00-18:00; Dec 25 off"])),
    "Sun -, Mon -, Tue -, Wed -, Thu -, Fri 12:00-18:00, Sat 12:00-18:00",
  );
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
  // The same placeholder written from somewhere other than midnight: two ends naming one clock face. This is
  // the guest side's twin, so it has to answer the same way on each of the 6 shipped listings that carry one.
  assert.equal(show(encodeWeek(["Mon-Sun 1:00 AM - 1:00 AM"])), "(no hours)");
  assert.equal(show(encodeWeek(["Sat 12:00 PM - 12:00 PM"])), "(no hours)");
  assert.equal(show(encodeWeek(["Wed 8:00 AM - 8:00 AM"])), "(no hours)");
  assert.equal(show(encodeWeek(["Sun 11:00 AM - 11:00 AM"])), "(no hours)");
  assert.equal(
    show(encodeWeek(["Sat 12:00 PM - 12:00 PM", "Sun 12:00 PM - 10:00 PM"])),
    "Sun 12:00-22:00, Mon -, Tue -, Wed -, Thu -, Fri -, Sat -",
  );
  // A long day whose two ends really are different is still a long day.
  assert.equal(show(encodeWeek(["Daily 12:01 AM - 11:00 PM"])), everyDay("00:01-23:00"));
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

/**
 * A day off stated on a line that also states hours. The twin of the guest-side rule: 111 lines on 106
 * listings write both on one line, and the card, the picker and the listing page all had the day off open.
 */
test("a day a shop says it is shut is shut, on a line that states hours as well", () => {
  assert.equal(show(encodeWeek(["Mon Closed Tue 12pm-7pm Wed 12pm-7pm"])), "Sun -, Mon closed, Tue 12:00-19:00, Wed 12:00-19:00, Thu -, Fri -, Sat -");
  assert.equal(show(encodeWeek(["MON: Closed TUES-THU: 4:30pm - 9:00pm"])), "Sun -, Mon closed, Tue 16:30-21:00, Wed 16:30-21:00, Thu 16:30-21:00, Fri -, Sat -");
  assert.equal(show(encodeWeek(["Mon - Fri: Closed ​​Saturday: 10am - 5pm"])), "Sun -, Mon closed, Tue closed, Wed closed, Thu closed, Fri closed, Sat 10:00-17:00");
  assert.equal(show(encodeWeek(["Closed Monday & Tuesday Wednesday: 4:00 pm - 8:00 pm"])), "Sun -, Mon closed, Tue closed, Wed 16:00-20:00, Thu -, Fri -, Sat -");
  assert.equal(show(encodeWeek(["Open daily 10AM-7:30PM, closed Wednesdays"])), "Sun 10:00-19:30, Mon 10:00-19:30, Tue 10:00-19:30, Wed closed, Thu 10:00-19:30, Fri 10:00-19:30, Sat 10:00-19:30");
  assert.equal(show(encodeWeek(["Tuesday - Sunday CLOSED MONDAYS 10 am - 5 pm"])), "Sun 10:00-17:00, Mon closed, Tue 10:00-17:00, Wed 10:00-17:00, Thu 10:00-17:00, Fri 10:00-17:00, Sat 10:00-17:00");
  assert.equal(show(encodeWeek(["Driving range open daily 6:30AM - 7:00PM (closed Sundays after 3 PM for maintenance)"])), everyDay("06:30-19:00"));
  assert.equal(show(encodeWeek(["Monday: 9:00 am-6:00 pm Tuesday: 9:00 am-6:00 pm", "Monday - Saturday, closed Sunday"])), "Sun closed, Mon 09:00-18:00, Tue 09:00-18:00, Wed -, Thu -, Fri -, Sat -");
  assert.equal(show(encodeWeek(["Sunday: Closed"])), "Sun closed, Mon -, Tue -, Wed -, Thu -, Fri -, Sat -");
  // An hour behind the word is an hour the shop shuts for, and not an hour it opens either: o-pagelakepowellhub-com
  // publishes its real week and this line last, and the card read Saturday as the hour of the orientation.
  assert.equal(show(encodeWeek(["Saturday & Sunday closed 8:30 a.m. to 9:30 a.m. for Coyote Butte Orientation"])), "(no hours)");
  assert.equal(
    show(encodeWeek(["Monday-Friday 8 a.m. to 3:30 p.m.", "Saturday 8 a.m. to 2 p.m.", "Sunday 8 a.m. to 12 Noon", "Saturday & Sunday closed 8:30 a.m. to 9:30 a.m. for Coyote Butte Orientation"])),
    "Sun 08:00-12:00, Mon 08:00-15:30, Tue 08:00-15:30, Wed 08:00-15:30, Thu 08:00-15:30, Fri 08:00-15:30, Sat 08:00-14:00",
  );
  assert.equal(show(encodeWeek(["8:30 am - 4:30 pm, closed from 12:00 pm - 1:00 pm"])), everyDay("08:30-16:30"));
  // A rule whose only named days are the days it shuts states the hours of the rest of the week: o-msje-org.
  assert.equal(show(encodeWeek(["open six days a week (closed Tuesdays) 10:00am-5:00pm"])), "Sun 10:00-17:00, Mon 10:00-17:00, Tue closed, Wed 10:00-17:00, Thu 10:00-17:00, Fri 10:00-17:00, Sat 10:00-17:00");
  assert.equal(show(encodeWeek(["Office hours 8:00am-4pm (closed Tues / Wed)"])), "Sun 08:00-16:00, Mon 08:00-16:00, Tue closed, Wed closed, Thu 08:00-16:00, Fri 08:00-16:00, Sat 08:00-16:00");
  assert.equal(
    show(encodeWeek(["open six days a week (closed Tuesdays) 10:00am-5:00pm", "Sat 9am - 1pm"])),
    "Sun 10:00-17:00, Mon 10:00-17:00, Tue closed, Wed 10:00-17:00, Thu 10:00-17:00, Fri 10:00-17:00, Sat 09:00-13:00",
  );
});

/**
 * The same seams on the card's own week: 250 listings publish an hour line with a day name glued to a heading
 * or to the clock, and the twin has to open them where the guest side does or the two disagree.
 */
test("a day name the crawl glued to a heading or to the clock is still a day", () => {
  assert.equal(show(encodeWeek(["Public Visiting Hours Friday10AM - 4:30PM"])), "Sun -, Mon -, Tue -, Wed -, Thu -, Fri 10:00-16:30, Sat -");
  assert.equal(show(encodeWeek(["of OperationsMon - Fri8:00 am - 7:00 pm"])), "Sun -, Mon 08:00-19:00, Tue 08:00-19:00, Wed 08:00-19:00, Thu 08:00-19:00, Fri 08:00-19:00, Sat -");
  assert.equal(show(encodeWeek(["Monday11:30 AM - 10:00 PMTuesday9:00 AM - 5:00 PM"])), "Sun -, Mon 11:30-22:00, Tue 09:00-17:00, Wed -, Thu -, Fri -, Sat -");
  assert.equal(show(encodeWeek(["MondayClosedTuesdayClosedWednesday11:00 am - 4:00 pm"])), "Sun -, Mon closed, Tue closed, Wed 11:00-16:00, Thu -, Fri -, Sat -");
  assert.equal(show(encodeWeek(["MON - ClosedTUES-SAT - 11AM - 5pmsun - 12:30PM - 5PM"])), "Sun 12:30-17:00, Mon closed, Tue 11:00-17:00, Wed 11:00-17:00, Thu 11:00-17:00, Fri 11:00-17:00, Sat 11:00-17:00");
  assert.equal(show(encodeWeek(["Salmon fishing daily 6am-6pm"])), everyDay("06:00-18:00"));
  assert.equal(show(encodeWeek(["Open Saturdays 9am-1pm"])), "Sun -, Mon -, Tue -, Wed -, Thu -, Fri -, Sat 09:00-13:00");
});

/**
 * Two rules a shop separated with a space, on the card's own week. 558 lines on 485 listings write one, and
 * the compact week the card reads has to be cut where the listing page cuts it or the card and the page it
 * opens disagree about the hour a shop opens.
 */
test("a second rule a shop wrote after a space is a second rule here too", () => {
  assert.equal(show(encodeWeek(["Mon-Sat 10am - 5pm Sunday 12pm - 5pm"])),
    "Sun 12:00-17:00, Mon 10:00-17:00, Tue 10:00-17:00, Wed 10:00-17:00, Thu 10:00-17:00, Fri 10:00-17:00, Sat 10:00-17:00");
  assert.equal(show(encodeWeek(["Tuesday - Friday 10 am - 4 pm Saturday 10 am - 3 pm"])),
    "Sun -, Mon -, Tue 10:00-16:00, Wed 10:00-16:00, Thu 10:00-16:00, Fri 10:00-16:00, Sat 10:00-15:00");
  assert.equal(show(encodeWeek(["Mon - Fri 4:00pm - 10:00pm Sat & Sun 12:00pm - 7:00pm"])),
    "Sun 12:00-19:00, Mon 16:00-22:00, Tue 16:00-22:00, Wed 16:00-22:00, Thu 16:00-22:00, Fri 16:00-22:00, Sat 12:00-19:00");
  // And the shapes the cut refuses, which are the same three the guest side refuses.
  assert.equal(show(encodeWeek(["open from11am - 7pm Monday-Friday and 9am-8pm"])),
    "Sun -, Mon 11:00-19:00, Tue 11:00-19:00, Wed 11:00-19:00, Thu 11:00-19:00, Fri 11:00-19:00, Sat -");
  assert.equal(show(encodeWeek(["Mon - Fri: Closed Saturday: 10am - 5pm"])),
    "Sun -, Mon closed, Tue closed, Wed closed, Thu closed, Fri closed, Sat 10:00-17:00");
  assert.equal(show(encodeWeek(["Friday 6:00 pm - 10:00 pm Saturday"])),
    "Sun -, Mon -, Tue -, Wed -, Thu -, Fri 18:00-22:00, Sat 18:00-22:00");
});

/**
 * A rule a shop wrote clock first, on the card's own week. 40 shipped lines put the days behind the span they
 * belong to, and the card has to cut them where the listing page cuts them or the two disagree about the hour
 * a shop opens.
 */
test("a rule a shop wrote clock first is still a rule here too", () => {
  assert.equal(show(encodeWeek(["Lynden: 4pm \u2013 8pm Mon-Tue, 4pm \u2013 9pm Wed-Thu, 4pm - 10pm Fri, 12pm \u2013 10pm Sat, 12pm \u2013 8pm Sun"])),
    "Sun 12:00-20:00, Mon 16:00-20:00, Tue 16:00-20:00, Wed 16:00-21:00, Thu 16:00-21:00, Fri 16:00-22:00, Sat 12:00-22:00");
  assert.equal(show(encodeWeek(["TCC Admin Hours: 9:00am - 5:00pm Mon, 9:00am - 3:00pm Tue-Wed (Seasonal), 8:30am - 5:00pm Thu-Fri, 8:30am - 4:30pm Sat"])),
    "Sun -, Mon 09:00-17:00, Tue 09:00-15:00, Wed 09:00-15:00, Thu 08:30-17:00, Fri 08:30-17:00, Sat 08:30-16:30");
  // The ambiguous shape stays refused on this side as well: a span with no days behind it is a rule the crawl
  // cut the front off, and the line keeps the reading it had.
  assert.equal(show(encodeWeek(["Antigonish: 12pm\u20137pm, Thursday\u2013Saturday 10am\u201310pm, Monday-Wednesday 10am-8pm"])),
    "Sun -, Mon 12:00-19:00, Tue -, Wed 12:00-19:00, Thu 12:00-19:00, Fri 12:00-19:00, Sat 12:00-19:00");
});

/**
 * A span with no day in front of it, on the card's own week. It is a fallback rather than a statement about any
 * particular day, and the card has to read it the way the listing page does or the two disagree about the hour
 * a shop opens.
 */
test("a span that names no day fills only the days nothing else names here too", () => {
  assert.equal(show(encodeWeek(["open 1pm - 6pm", "Mon-Fri 10:00 AM - 5:00 PM", "Sat-Sun 1:00 PM - 4:00 PM"])),
    "Sun 13:00-16:00, Mon 10:00-17:00, Tue 10:00-17:00, Wed 10:00-17:00, Thu 10:00-17:00, Fri 10:00-17:00, Sat 13:00-16:00");
  assert.equal(show(encodeWeek(["Saturday-Sunday, 11 AM-5 PM", "10:00AM - 7:00PM (Last boat leaves at 6:00PM)"])),
    "Sun 11:00-17:00, Mon 10:00-19:00, Tue 10:00-19:00, Wed 10:00-19:00, Thu 10:00-19:00, Fri 10:00-19:00, Sat 11:00-17:00");
  // Among themselves the dayless spans are unchanged: the last one a page states still wins.
  assert.equal(show(encodeWeek(["12:00 AM - 01:00 AM", "04:00 PM - 01:00 AM"])),
    "Sun 16:00-25:00, Mon 16:00-25:00, Tue 16:00-25:00, Wed 16:00-25:00, Thu 16:00-25:00, Fri 16:00-25:00, Sat 16:00-25:00");
});

/** The same day off between two days of hours, on the card's own week. */
test("a day off that names its own day finishes its rule here too", () => {
  assert.equal(show(encodeWeek(["Mon 10:00 am - 4:00 pm Tues CLOSED Wed 10:00 am - 6:00 pm"])),
    "Sun -, Mon 10:00-16:00, Tue closed, Wed 10:00-18:00, Thu -, Fri -, Sat -");
  assert.equal(show(encodeWeek(["Open daily 10AM-7:30PM, closed Wednesdays"])),
    "Sun 10:00-19:30, Mon 10:00-19:30, Tue 10:00-19:30, Wed closed, Thu 10:00-19:30, Fri 10:00-19:30, Sat 10:00-19:30");
});

/**
 * The days a shop wrote as a code rather than a word. 72 shipped listings write their week that way and every
 * one of them was misread, because both readers wanted three letters before they would call a word a day. A
 * weekday-only shop named no day at all, which a week reads as every day of it, so 34 of them told a guest
 * they were open on a Sunday they are shut; the 9 that wrote a Saturday out in full beside the codes stood
 * closed all week with their weekday clock on the Saturday. Every line below is one a real shop published.
 */

test("a week written in one and two letter codes is the week the shop wrote", () => {
  assert.equal(show(encodeWeek(["M-F 9am-5pm"])), "Sun -, Mon 09:00-17:00, Tue 09:00-17:00, Wed 09:00-17:00, Thu 09:00-17:00, Fri 09:00-17:00, Sat -");
  assert.equal(show(encodeWeek(["open M-F from 9 am-5 pm"])), "Sun -, Mon 09:00-17:00, Tue 09:00-17:00, Wed 09:00-17:00, Thu 09:00-17:00, Fri 09:00-17:00, Sat -");
  assert.equal(show(encodeWeek(["Mo-Fr: 5am - 7pm"])), "Sun -, Mon 05:00-19:00, Tue 05:00-19:00, Wed 05:00-19:00, Thu 05:00-19:00, Fri 05:00-19:00, Sat -");
  // A range that closes on a code and opens on a word, and one that does the reverse.
  assert.equal(show(encodeWeek(["Sa-Sun: 7 AM - 10 PM"])), "Sun 07:00-22:00, Mon -, Tue -, Wed -, Thu -, Fri -, Sat 07:00-22:00");
  assert.equal(show(encodeWeek(["M - Th: 10am - 9pm"])), "Sun -, Mon 10:00-21:00, Tue 10:00-21:00, Wed 10:00-21:00, Thu 10:00-21:00, Fri -, Sat -");
  // A list rather than a range, where the shop names the days it does open.
  assert.equal(show(encodeWeek(["M, Tu, We, Sa: 6:00 AM - 8:00 PM"])), "Sun -, Mon 06:00-20:00, Tue 06:00-20:00, Wed 06:00-20:00, Thu -, Fri -, Sat 06:00-20:00");
});

test("a day is read where it sits here too, whatever the shop wrote around it", () => {
  assert.equal(
    show(encodeWeek(["Mo, Tu, Wed, Th, & Fr12:00pm-4:00pm"])),
    "Sun -, Mon 12:00-16:00, Tue 12:00-16:00, Wed 12:00-16:00, Thu 12:00-16:00, Fri 12:00-16:00, Sat -",
  );
  assert.equal(
    show(encodeWeek(["Mo - Fr, Sa 9am-5pm"])),
    "Sun -, Mon 09:00-17:00, Tue 09:00-17:00, Wed 09:00-17:00, Thu 09:00-17:00, Fri 09:00-17:00, Sat 09:00-17:00",
  );
});

test("a Saturday written out in full beside the codes is its own rule", () => {
  assert.equal(
    show(encodeWeek(["M - F 10am - 6pm Saturday 10am - 3pm"])),
    "Sun -, Mon 10:00-18:00, Tue 10:00-18:00, Wed 10:00-18:00, Thu 10:00-18:00, Fri 10:00-18:00, Sat 10:00-15:00",
  );
  assert.equal(
    show(encodeWeek(["M-F: 6:30am to 6pm Sat: 6:30am to 6:30pm"])),
    "Sun -, Mon 06:30-18:00, Tue 06:30-18:00, Wed 06:30-18:00, Thu 06:30-18:00, Fri 06:30-18:00, Sat 06:30-18:30",
  );
  // A day of its own in front, the rest of the week behind it, both in codes.
  assert.equal(
    show(encodeWeek(["M 4:30PM - 9PM tu - su 11:30AM - 9PM"])),
    "Sun 11:30-21:00, Mon 16:30-21:00, Tue 11:30-21:00, Wed 11:30-21:00, Thu 11:30-21:00, Fri 11:30-21:00, Sat 11:30-21:00",
  );
});

test("a code that means two days names neither, and a lone letter names none", () => {
  // "T" is Tuesday or Thursday and "S" is Saturday or Sunday, so a group holding one states no days and the
  // line falls back to the week it always did rather than to a guessed half of itself.
  assert.equal(show(encodeWeek(["M-T: 8:00AM - 5:30PM"])), everyDay("08:00-17:30"));
  assert.equal(show(encodeWeek(["S-S 9am-3pm"])), everyDay("09:00-15:00"));
  // A single letter on its own is as likely to be a street direction, a month or a temperature as a day.
  assert.equal(show(encodeWeek(["Call for Reservations 6am - 9pm, May 1st through October 1st"])), everyDay("06:00-21:00"));
  assert.equal(show(encodeWeek(["Open Bowling 3:00pm - 11:00pm, 11AM - Midnight"])), everyDay("15:00-23:00"));
  assert.equal(show(encodeWeek(["Boats can be checked out as early as 9:00 AM and must be returned by 6:00 PM (off season 9am-5pm)"])), everyDay("09:00-17:00"));
  assert.equal(show(encodeWeek(["Peak Season 9AM - 9PM, Mid Season 10AM - 7PM"])), everyDay("09:00-21:00"));
});

/**
 * The clock face a shop wrote as a word, which the compact week has to read the same way the listing page
 * does or the card says a tap room is shut on the afternoon its own page says it is open. The guest-side
 * test carries the whole story.
 */

test("noon and midnight are read as the hours a shop means by them", () => {
  assert.equal(show(encodeWeek(["Fri-Sat: Noon - 10:00 pm"])), "Sun -, Mon -, Tue -, Wed -, Thu -, Fri 12:00-22:00, Sat 12:00-22:00");
  assert.equal(show(encodeWeek(["10am-Midnight Every Day"])), everyDay("10:00-24:00"));
  // The "12" in front of the word goes with it: o-fasttrackkarting-ca closed its track at noon.
  assert.equal(show(encodeWeek(["Go Karting: 10AM - 12midnight 7 days / week"])), everyDay("10:00-24:00"));
  assert.equal(show(encodeWeek(["Sunday 8 a.m. to 12 Noon"])), "Sun 08:00-12:00, Mon -, Tue -, Wed -, Thu -, Fri -, Sat -");
  // A business can be called Noon something, so the word is only a clock where it is written as one.
  assert.equal(show(encodeWeek(["Noon Whistle Brewing Mon-Fri 4pm-10pm"])), "Sun -, Mon 16:00-22:00, Tue 16:00-22:00, Wed 16:00-22:00, Thu 16:00-22:00, Fri 16:00-22:00, Sat -");
  assert.equal(show(encodeWeek(["Afternoon 1-5 pm"])), everyDay("13:00-17:00"));
  // o-nsuartmuseum-org: the cut needs the first span as much as the reader does.
  assert.equal(
    show(encodeWeek(["Sunday: Noon - 5pm Tuesday-Saturday: 11am - 5pm"])),
    "Sun 12:00-17:00, Mon -, Tue 11:00-17:00, Wed 11:00-17:00, Thu 11:00-17:00, Fri 11:00-17:00, Sat 11:00-17:00",
  );
});

test("a rate card is not the hours a shop keeps", () => {
  // The twin of the guest-side rule: 20 listings shipped a week read off a price list.
  assert.equal(show(encodeWeek(["Open-10:50AM) $91 $115 $64 $84 Midday (11AM-2:50PM"])), "(no hours)");
  assert.equal(show(encodeWeek(["$749 1-4 Adults Book Now 7:30am to 12:30pm"])), "(no hours)");
  assert.equal(show(encodeWeek([") OR $700 per day (11am to 6pm", "Monday through Sunday 11AM - 7PM"])), everyDay("11:00-19:00"));
});
