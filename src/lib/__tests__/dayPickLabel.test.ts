import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dayPickLabel } from "../format";

/**
 * What the booking calendar calls a date out loud.
 *
 * Every date in the window is a button whose visible content is a bare number, so the only thing naming it
 * is its label. The desktop listing's two month grids spelled out "Thursday, October 1, not available" by
 * hand; the phone's shared `SlotCalendar` gave the day number alone, and only when the listing happened to
 * carry live seat counts. Read in a real Chromium, the phone's booking sheet was a grid of buttons called
 * "1", "12", "13", with no month in any of them and nothing to say a greyed date could not be picked. One
 * reader for all three, the way every other place line and price line in this app already works.
 */

test("a date reads out as the day it is, with the month spelled out", () => {
  const d = new Date(2026, 9, 1); // Thursday 1 October 2026, local midnight
  assert.equal(dayPickLabel(d), "Thursday, October 1");
  assert.equal(dayPickLabel(d, "not available"), "Thursday, October 1, not available");
  assert.equal(dayPickLabel(d, "3 open"), "Thursday, October 1, 3 open");
  assert.equal(dayPickLabel(d, ""), "Thursday, October 1", "an empty note leaves no trailing comma");
});

test("the day of the week is the date's own, not the one before it", () => {
  // A bare "YYYY-MM-DD" through `new Date` would be UTC midnight, which is the day before west of Greenwich.
  assert.equal(dayPickLabel(new Date(2027, 0, 3)), "Sunday, January 3");
  assert.equal(dayPickLabel(new Date(2026, 11, 31)), "Thursday, December 31");
});

test("all three booking calendars name their days through the one reader", () => {
  const phone = readFileSync(new URL("../../components/booking/SlotCalendar.tsx", import.meta.url), "utf8");
  const desktop = readFileSync(new URL("../../components/web/WebListing.tsx", import.meta.url), "utf8");
  assert.match(phone, /aria-label=\{dayPickLabel\(d,/, "the phone's calendar names its days by hand again");
  assert.match(phone, /not available/, "the phone's calendar says nothing about a date it will not take");
  const labels = desktop.match(/aria-label=\{dayPickLabel\(d,/g) || [];
  assert.equal(labels.length, 2, "the desktop listing's two month grids no longer share the reader");
  assert.doesNotMatch(
    phone + desktop,
    /aria-label=\{d\.toLocaleDateString/,
    "a calendar is spelling a date out for itself again",
  );
});
