import assert from "node:assert/strict";
import test from "node:test";
import type { Unclaimed } from "../../data/types";
import { openStateAt, zoneFor, type Week } from "../openNow";

/**
 * Which clock a shop's hours are read on.
 *
 * `zoneFor` decides what "Open now" says on every card, on the listing page, in the booking sheet, in the
 * "Open right now near you" rail and in Otto's answers, and it decides which of today's start times are still
 * far enough out to book. An hour out either way is an hour of the shop's day.
 *
 * Every operator here is a real row in the shipped catalog, named with the area and coordinates it ships with.
 */

const at = (area: string, lat: number, lon: number): Unclaimed =>
  ({ id: "t", title: "T", cat: "play", art: "bowling", area, lat, lon } as unknown as Unclaimed);

/**
 * Oregon's Mountain time is Malheur County, in the south east corner, so it is the east of the state that
 * moves. The test read it the other way round: `lon < -117.1` is everything WEST of the Idaho border, which
 * is the whole state bar one operator. 1,028 of the catalog's 1,029 Oregon rows with a comma in their area
 * were an hour ahead, Portland, Salem, Eugene and the coast among them.
 */
test("Oregon is Pacific, except the Malheur County corner", () => {
  assert.equal(zoneFor(at("Portland, OR", 45.5231, -122.6765)), "America/Los_Angeles");
  assert.equal(zoneFor(at("Salem, OR", 44.9429, -123.0351)), "America/Los_Angeles");
  assert.equal(zoneFor(at("Coquille, OR", 43.1762, -124.1903)), "America/Los_Angeles"); // the coast
  assert.equal(zoneFor(at("Bend, OR", 44.0582, -121.3153)), "America/Los_Angeles");
  // Baker and Wallowa counties are the far east of the state and still Pacific.
  assert.equal(zoneFor(at("Baker City, OR", 44.7749, -117.8324)), "America/Los_Angeles");
  assert.equal(zoneFor(at("Joseph, OR", 45.3514, -117.2294)), "America/Los_Angeles");
  // Malheur County, which really is Mountain: Ontario, on the Idaho line.
  assert.equal(zoneFor(at("Ontario, OR", 44.0233, -116.9531)), "America/Boise");
});

/** The other split states were right and must stay right, in both directions. */
test("the other split states keep their halves", () => {
  assert.equal(zoneFor(at("Pensacola, FL", 30.4213, -87.2169)), "America/Chicago");
  assert.equal(zoneFor(at("Clearwater Beach, FL", 27.9775, -82.8271)), "America/New_York");
  assert.equal(zoneFor(at("El Paso, TX", 31.7619, -106.485)), "America/Denver");
  assert.equal(zoneFor(at("Austin, TX", 30.2672, -97.7431)), "America/Chicago");
  assert.equal(zoneFor(at("Paducah, KY", 37.0834, -88.6)), "America/Chicago");
  assert.equal(zoneFor(at("Lexington, KY", 38.0406, -84.5037)), "America/New_York");
  assert.equal(zoneFor(at("Knoxville, TN", 35.9606, -83.9207)), "America/New_York");
  assert.equal(zoneFor(at("Nashville, TN", 36.1627, -86.7816)), "America/Chicago");
  assert.equal(zoneFor(at("Coeur d'Alene, ID", 47.6777, -116.7805)), "America/Los_Angeles");
  assert.equal(zoneFor(at("Boise, ID", 43.615, -116.2023)), "America/Boise");
  assert.equal(zoneFor(at("Ironwood, MI", 46.4547, -90.171)), "America/Chicago");
  assert.equal(zoneFor(at("Detroit, MI", 42.3314, -83.0458)), "America/Detroit");
  assert.equal(zoneFor(at("Fernie, BC", 49.503, -115.0619)), "America/Edmonton");
  assert.equal(zoneFor(at("Vancouver, BC", 49.2827, -123.1207)), "America/Vancouver");
});

/**
 * What the hour was costing a guest. LaLumiere Massage Boutique in Salem ships Monday to Friday 9 to 6, and
 * at half past five on a Wednesday afternoon in Salem the listing read "Closed, opens 9 AM tomorrow", because
 * the clock it was read on already said half past six.
 */
test("a Salem shop is open at half past five in Salem", () => {
  const week: Week = [null, ...Array(5).fill({ open: 540, close: 1080 }), null] as Week;
  const item = at("Salem, OR", 44.9429, -123.0351);
  const wed = new Date("2026-09-16T17:30:00-07:00");
  const zone = zoneFor(item);
  assert.equal(zone, "America/Los_Angeles");
  const clock = new Intl.DateTimeFormat("en-US", { timeZone: zone!, hour12: false, weekday: "short", hour: "numeric", minute: "numeric" }).formatToParts(wed);
  const get = (t: string) => clock.find((p) => p.type === t)!.value;
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const state = openStateAt(week, { day, minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")) });
  assert.equal(state?.open, true);
  assert.equal(state?.closesAt, "6 PM");
  // On the Mountain clock it read half past six, which is after the shop shuts.
  const mt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Boise", hour12: false, hour: "numeric", minute: "numeric" }).formatToParts(wed);
  const mtMin = (Number(mt.find((p) => p.type === "hour")!.value) % 24) * 60 + Number(mt.find((p) => p.type === "minute")!.value);
  assert.equal(openStateAt(week, { day, minutes: mtMin })?.open, false);
});
