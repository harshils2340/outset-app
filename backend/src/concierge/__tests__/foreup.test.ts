import { strict as assert } from "node:assert";
import test from "node:test";
import { foreupRef } from "../readers/foreup.ts";
import { readerFor, isReadable } from "../readable.ts";
import { usableBookingUrl } from "../plan.ts";

/**
 * Four places had to agree that ForeUp is readable, and `readable.ts`'s own header names this exact failure
 * mode: a vendor added to one list and left out of another is routed nowhere, silently, with no test to catch
 * it. This shipped once already in this session — `readerFor` and `vendors.ts` both knew ForeUp, and
 * `usableBookingUrl`'s `BOOKING_HOSTS` allowlist did not, so a real course's real link was discarded before
 * the route was ever decided, and Beekman Golf Course came back a phone call. These are the four checked here.
 */

test("a ForeUp course link, with and without a named tee sheet", () => {
  assert.deepEqual(foreupRef("https://foreupsoftware.com/index.php/booking/21688#/teetimes"), { courseId: "21688", scheduleId: null });
  assert.deepEqual(foreupRef("https://foreupsoftware.com/index.php/booking/22404/10696#teetimes"), { courseId: "22404", scheduleId: "10696" });
  assert.equal(foreupRef("https://example.com/booking/21688"), null);
});

test("readerFor and usableBookingUrl agree that ForeUp is a booking host, not somebody else's site", () => {
  const url = "https://foreupsoftware.com/index.php/booking/21688#/teetimes";
  assert.equal(readerFor(url), "foreup");
  assert.equal(isReadable(url), true);
  // The second argument is the shop's own domain; foreupsoftware.com must clear as a vendor regardless of it.
  assert.equal(usableBookingUrl(url, "beekmangolf.com"), url, "a known booking vendor must survive usableBookingUrl unchanged");
});
