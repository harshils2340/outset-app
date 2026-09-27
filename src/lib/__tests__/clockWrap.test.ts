import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { clockOfMinutes, fmtTime } from "../format";
import { itemWeek } from "../openNow";
import type { Unclaimed } from "../../data/types";

/**
 * A clock past 24, which is how a week that runs into the small hours is carried: `parseWeek` adds a day to a
 * closing time earlier than its opening one, so a bar open until 4 AM closes at minute 1680 and midnight
 * itself is 1440. `fmt` in openNow.ts has always wrapped; `fmtTime` did not, so the "Plan your visit" Hours
 * block on the listing page printed the wrong half of the day on 874 lines across 213 shipped listings.
 */

test("an hour past midnight is the small hours, not the afternoon", () => {
  assert.equal(fmtTime("24:00"), "12:00 AM", "midnight, not noon");
  assert.equal(fmtTime("26:00"), "2:00 AM");
  assert.equal(fmtTime("25:30"), "1:30 AM");
  assert.equal(fmtTime("31:00"), "7:00 AM");
  // The ordinary clock is untouched.
  assert.equal(fmtTime("00:00"), "12:00 AM");
  assert.equal(fmtTime("09:05"), "9:05 AM");
  assert.equal(fmtTime("12:00"), "12:00 PM");
  assert.equal(fmtTime("13:45"), "1:45 PM");
  assert.equal(fmtTime("23:59"), "11:59 PM");
});

test("minutes since midnight read as the clock a guest is shown", () => {
  assert.equal(clockOfMinutes(0), "12:00 AM");
  assert.equal(clockOfMinutes(600), "10:00 AM");
  assert.equal(clockOfMinutes(840), "2:00 PM");
  assert.equal(clockOfMinutes(1440), "12:00 AM", "an arcade open until midnight");
  assert.equal(clockOfMinutes(1500), "1:00 AM", "a bowling alley open until 1 AM");
  assert.equal(clockOfMinutes(1680), "4:00 AM", "169 Bar in New York");
  assert.equal(clockOfMinutes(1860), "7:00 AM", "an RV park's overnight desk");
});

/** The arts whose listing page draws the Hours block instead of a booking box: see VISIT_ARTS in WebListing. */
const VISIT_ARTS = new Set(["zoo", "aquarium", "themepark", "waterpark", "museum", "garden", "theatre", "arcade", "icerink", "trampoline", "bowling", "minigolf", "billiards", "camping", "sauna", "swim", "tennis", "discgolf", "venue", "brewery", "winery", "distillery"]);

test("no shipped visit panel turns a small-hours close into an afternoon one", () => {
  const dir = path.join(process.cwd(), "public", "o");
  if (!fs.existsSync(dir)) return;
  const bad: string[] = [];
  let late = 0;
  for (const f of fs.readdirSync(dir)) {
    const item = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Unclaimed;
    if ((item.options || []).length > 0 || !VISIT_ARTS.has(item.art)) continue;
    const week = itemWeek(item);
    if (!week) continue;
    for (const d of week) {
      // A close between midnight and eleven in the morning of the next day, which is every late closer a shop
      // actually publishes. The half dozen lines whose own two ends name the same clock face are left out: what
      // to do with a span of a full day is a question about the parser, not about the clock.
      if (!d || d.close <= 24 * 60 || d.close > 24 * 60 + 11 * 60) continue;
      late++;
      const shown = clockOfMinutes(d.close);
      if (!/ AM$/.test(shown)) bad.push(item.id + " closes at minute " + d.close + ", shown as " + shown);
    }
  }
  assert.ok(late > 100, "the shipped catalog still holds late closers to check: " + late);
  assert.deepEqual(bad.slice(0, 10), [], bad.length + " day lines print a small-hours close as an afternoon one");
});
