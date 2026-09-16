import assert from "node:assert/strict";
import test from "node:test";
import type { Unclaimed } from "../../data/types";
import { openStateAt, regionOf, zoneFor, type Week } from "../openNow";

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

/**
 * The sync writes the area as "town, code", but an operator whose town was never scraped gets the code on its
 * own, which is the honest gap the rules ask for: 4,736 rows in the shipped catalog. Asking for a comma in
 * front of the code threw all of them away and fell back to a longitude band, so a Tucson stable was on
 * Denver time and moved an hour every spring, a Kalispell outfitter was on Pacific, and a Saskatchewan
 * campground kept a daylight saving Saskatchewan does not observe. 1,669 operators were on the wrong clock.
 */
test("a listing whose area is only its region code still has a region", () => {
  assert.equal(regionOf("Clearwater Beach, FL"), "FL");
  assert.equal(regionOf("ON"), "ON");
  assert.equal(regionOf("AZ"), "AZ");
  // Whatever case the operator's own site wrote it in.
  assert.equal(regionOf("Hollywood, fl"), "FL");
  assert.equal(regionOf("Winters, Ca"), "CA");
  // A place name is never mistaken for a region: the town is not read at all, and a two letter word inside
  // one is not a code. Both are real rows in the catalog.
  assert.equal(regionOf("Mt, NJ"), "NJ");
  assert.equal(regionOf("Weedon Island, St. Petersburg, FL"), "FL");
  assert.equal(regionOf("Cavan-Monaghan,, ON"), "ON");
  assert.equal(regionOf("Somewhere"), undefined);
  assert.equal(regionOf(""), undefined);
  assert.equal(regionOf(undefined), undefined);
});

test("the bare code puts these operators back on their own clock", () => {
  // Circle Z, a Patagonia ranch. Arizona keeps standard time all year; Denver does not.
  assert.equal(zoneFor(at("AZ", 31.5006, -110.8124)), "America/Phoenix");
  // Bigfork Outdoor Rentals, in Montana, which the longitude band put in Pacific time.
  assert.equal(zoneFor(at("MT", 48.0951, -114.0300)), "America/Denver");
  // Birch Hills Historical Museum. Saskatchewan does not move in the spring; Denver and Winnipeg both do.
  assert.equal(zoneFor(at("SK", 52.9826, -105.4390)), "America/Regina");
  // Bannerman Brewing, St John's, and its half hour.
  assert.equal(zoneFor(at("NL", 47.5705, -52.7011)), "America/St_Johns");
  // Aurora Village, Yellowknife. Aspen Valley RV Park, Idaho. The Owyhee Dam, in Malheur County.
  assert.equal(zoneFor(at("NT", 62.5336, -114.2016)), "America/Yellowknife");
  assert.equal(zoneFor(at("ID", 44.4980, -116.0310)), "America/Boise");
  assert.equal(zoneFor(at("OR", 43.6503, -117.2467)), "America/Boise");
  // A bare code still loses to a real area line, and an area with neither still falls back to the longitude.
  assert.equal(zoneFor(at("Honolulu, HI", 21.3069, -157.8583)), "Pacific/Honolulu");
  assert.equal(zoneFor(at("Somewhere", 34, -118)), "America/Los_Angeles");
});
