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
