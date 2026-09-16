import assert from "node:assert/strict";
import test from "node:test";
import { harvestHours } from "../hoursMarkup.ts";

/**
 * `harvestHours` reads a page's JSON-LD, microdata and "Hours" text into the lines the sync encodes into
 * `catalog.json`. Two of its readings were guesses rather than facts, and 166 operators shipped with one:
 * a day named in the markup with no time at all, and a span covering the whole day.
 */
const page = (body: string) => "<html><body>" + body + "</body></html>";
const ld = (json: string) => page('<script type="application/ld+json">' + json + "</script>");

test("a day named with no time states no hours for that day", () => {
  // o-jsma-uoregon-edu lists "Mo" and "Tu" bare because the museum is shut on both. Reading that as open
  // around the clock put it in "Open right now near you" at four on a Tuesday morning.
  assert.deepEqual(
    harvestHours(ld('{"@type":"LocalBusiness","openingHours":["Mo","Tu","We 11:00-20:00","Th-Su 11:00-17:00"]}')),
    ["Wed 11:00 AM - 8:00 PM", "Thu-Sun 11:00 AM - 5:00 PM"],
  );
});

test("a span covering the whole day is a site builder's default, not opening hours", () => {
  // The two shapes behind the 166: "Mo-Su 00:00-23:59" as a string, and opens/closes on a specification.
  assert.deepEqual(harvestHours(ld('{"@type":"LocalBusiness","openingHours":"Mo-Su 00:00-23:59"}')), []);
  assert.deepEqual(
    harvestHours(ld('{"@type":"LocalBusiness","openingHoursSpecification":[{"dayOfWeek":["Monday"],"opens":"00:00","closes":"23:59"}]}')),
    [],
  );
  assert.deepEqual(harvestHours(page('<p>Hours: open 12:00 AM - 11:59 PM daily</p>')), []);
});

test("a shop that did state its hours still publishes them", () => {
  assert.deepEqual(harvestHours(ld('{"@type":"LocalBusiness","openingHours":"Mo-Fr 09:00-17:00"}')), ["Mon-Fri 9:00 AM - 5:00 PM"]);
  // A late closer opens at a stated hour, so it is kept.
  assert.deepEqual(harvestHours(ld('{"@type":"LocalBusiness","openingHours":"Mo-Su 18:00-02:00"}')), ["Mon-Sun 6:00 PM - 2:00 AM"]);
  // A stated closed day is still a fact.
  assert.deepEqual(
    harvestHours(ld('{"@type":"LocalBusiness","openingHoursSpecification":[{"dayOfWeek":["Sunday"],"opens":"00:00","closes":"00:00"},{"dayOfWeek":["Monday"],"opens":"09:00","closes":"17:00"}]}')),
    ["Mon 9:00 AM - 5:00 PM", "Sun Closed"],
  );
});
