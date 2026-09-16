import { test } from "node:test";
import assert from "node:assert/strict";
import { instantOf, regionOfArea, todayIn, zoneForArea } from "../zone.ts";

/** These run under whatever TZ the machine has; the point is that none of the answers depend on it. */

test("the zone comes from the listing's region", () => {
  assert.equal(zoneForArea("Clearwater Beach, FL"), "America/New_York");
  assert.equal(zoneForArea("Tobermory, ON"), "America/Toronto");
  assert.equal(zoneForArea("San Diego, CA"), "America/Los_Angeles");
  assert.equal(zoneForArea("Phoenix, AZ"), "America/Phoenix"); // no daylight saving
  assert.equal(zoneForArea("St John's, NL"), "America/St_Johns"); // half hour offset
});

test("the western halves of split states are corrected by longitude", () => {
  assert.equal(zoneForArea("Pensacola, FL", 30.4, -87.2), "America/Chicago");
  assert.equal(zoneForArea("El Paso, TX", 31.8, -106.5), "America/Denver");
  assert.equal(zoneForArea("Marquette, MI", 46.5, -87.4), "America/Detroit");
});

/**
 * Oregon's Mountain time is Malheur County, in the south east corner, so it is the east of the state that
 * moves. The rule read `lon < -117.1`, which is everything west of the Idaho border, so the API put the
 * whole state on Mountain: an hour was taken off every Oregon shop's remaining start times, and after 11 PM
 * Pacific the API had already moved on to tomorrow.
 */
test("Oregon is Pacific, except the Malheur County corner", () => {
  assert.equal(zoneForArea("Portland, OR", 45.5231, -122.6765), "America/Los_Angeles");
  assert.equal(zoneForArea("Coquille, OR", 43.1762, -124.1903), "America/Los_Angeles");
  assert.equal(zoneForArea("Baker City, OR", 44.7749, -117.8324), "America/Los_Angeles");
  assert.equal(zoneForArea("Ontario, OR", 44.0233, -116.9531), "America/Boise");
});

/** The two parsers are twins: a shop's card and the times the API offers it must be read on one clock. */
test("a Portland shop's five o'clock is five o'clock in Portland", () => {
  // 17:00 Pacific on 16 September 2026 is 00:00 UTC the next day, and still the sixteenth where the shop is.
  const zone = zoneForArea("Portland, OR", 45.5231, -122.6765)!;
  assert.equal(new Date(instantOf("2026-09-16", "17:00", zone)).toISOString(), "2026-09-17T00:00:00.000Z");
  assert.equal(todayIn(zone, new Date("2026-09-17T00:30:00Z")), "2026-09-16");
});

/**
 * An operator whose town was never scraped publishes its area as the code alone ("ON"). Asking for a comma in
 * front of the code threw 4,736 of the catalog's rows away and fell back to a longitude band, which put 1,669
 * operators on a clock an hour out, Arizona, Saskatchewan and Montana among them.
 */
test("a listing whose area is only its region code still has a region", () => {
  assert.equal(regionOfArea("Clearwater Beach, FL"), "FL");
  assert.equal(regionOfArea("ON"), "ON");
  assert.equal(regionOfArea("Hollywood, fl"), "FL");
  // The town is never read, so a "Mt, NJ" stays in New Jersey and a St. Petersburg is not a region.
  assert.equal(regionOfArea("Mt, NJ"), "NJ");
  assert.equal(regionOfArea("Weedon Island, St. Petersburg, FL"), "FL");
  assert.equal(regionOfArea("Somewhere"), undefined);
  assert.equal(regionOfArea(undefined), undefined);

  assert.equal(zoneForArea("AZ", 31.5006, -110.8124), "America/Phoenix");
  assert.equal(zoneForArea("MT", 48.0951, -114.03), "America/Denver");
  assert.equal(zoneForArea("SK", 52.9826, -105.439), "America/Regina");
  assert.equal(zoneForArea("NL", 47.5705, -52.7011), "America/St_Johns");
  assert.equal(zoneForArea("OR", 43.6503, -117.2467), "America/Boise");
});

test("no region and no coordinates means we do not know, and say so", () => {
  assert.equal(zoneForArea(""), null);
  assert.equal(zoneForArea(undefined), null);
  assert.equal(zoneForArea("Somewhere"), null);
  // A coordinate alone is still enough.
  assert.equal(zoneForArea("Somewhere", 34, -118), "America/Los_Angeles");
});

test("a wall clock time resolves to the right instant, in summer and in winter", () => {
  // 1 PM Pacific on 6 October 2026 is daylight time, UTC-7, so 20:00 UTC.
  assert.equal(new Date(instantOf("2026-10-06", "13:00", "America/Los_Angeles")).toISOString(), "2026-10-06T20:00:00.000Z");
  // 1 PM Pacific in January is standard time, UTC-8, so 21:00 UTC. The offset is not hardcoded anywhere.
  assert.equal(new Date(instantOf("2027-01-06", "13:00", "America/Los_Angeles")).toISOString(), "2027-01-06T21:00:00.000Z");
  // Eastern, and a half hour zone, to prove the correction is not assuming whole hours.
  assert.equal(new Date(instantOf("2026-10-06", "09:00", "America/New_York")).toISOString(), "2026-10-06T13:00:00.000Z");
  assert.equal(new Date(instantOf("2026-10-06", "09:00", "America/St_Johns")).toISOString(), "2026-10-06T11:30:00.000Z");
  // Arizona never moves.
  assert.equal(new Date(instantOf("2026-07-01", "09:00", "America/Phoenix")).toISOString(), "2026-07-01T16:00:00.000Z");
  assert.equal(new Date(instantOf("2027-01-01", "09:00", "America/Phoenix")).toISOString(), "2027-01-01T16:00:00.000Z");
});

test("the day daylight saving ends still resolves every hour correctly", () => {
  // Clocks go back at 2 AM on 1 November 2026 in the US. 9 AM that day is standard time, UTC-5 in New York.
  assert.equal(new Date(instantOf("2026-11-01", "09:00", "America/New_York")).toISOString(), "2026-11-01T14:00:00.000Z");
  // The day before is still daylight time, UTC-4.
  assert.equal(new Date(instantOf("2026-10-31", "09:00", "America/New_York")).toISOString(), "2026-10-31T13:00:00.000Z");
  // And the spring forward day, when 2 AM does not exist.
  assert.equal(new Date(instantOf("2027-03-14", "09:00", "America/New_York")).toISOString(), "2027-03-14T13:00:00.000Z");
});

test("today is the shop's today, not the server's", () => {
  // 01:00 UTC on 7 October is still the evening of the 6th in Los Angeles.
  const at = new Date("2026-10-07T01:00:00Z");
  assert.equal(todayIn("America/Los_Angeles", at), "2026-10-06");
  assert.equal(todayIn("America/New_York", at), "2026-10-06");
  assert.equal(todayIn("America/Toronto", at), "2026-10-06");
  // And in UTC itself it really is the 7th.
  assert.equal(todayIn("UTC", at), "2026-10-07");
});
