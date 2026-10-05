import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

import { itemWeek } from "../openNow";
import { noStartTimesNote, startTimesOn } from "../startTimes";
import { minutesIn } from "../duration";
import { durationLabel } from "../listingDerive";
import { SLOT_TIMES } from "../../data/slots";
import type { Unclaimed } from "../../data/types";
import { weekIn } from "../../../backend/src/api/openSlots";

/**
 * The start times an unclaimed listing offers, against the hours the same page prints above them. Every shop
 * below is a real one in `public/o` and is named by the listing it came from.
 */

const dir = new URL("../../../public/o/", import.meta.url);
const detail = (id: string): Unclaimed => JSON.parse(readFileSync(new URL(id + ".json", dir), "utf8")) as Unclaimed;
const hm = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

test("a shop that opens in the afternoon is not offered from seven in the morning", () => {
  // o-10kbrew-com opens at 4 PM, o-10thstreetdistillery-com at 3 PM.
  assert.deepEqual(startTimesOn({ open: 16 * 60, close: 21 * 60 }, SLOT_TIMES), ["17:00"]);
  assert.deepEqual(startTimesOn({ open: 15 * 60, close: 20 * 60 }, SLOT_TIMES), ["15:00", "17:00"]);
  // o-1000islandsheritagemuseum-com, 10 to 4: the 7, the 9 and the 5 go.
  assert.deepEqual(startTimesOn({ open: 10 * 60, close: 16 * 60 }, SLOT_TIMES), ["11:00", "13:00", "15:00"]);
});

test("a day the shop states as closed offers nothing, and a day it says nothing about is untouched", () => {
  assert.deepEqual(startTimesOn({ open: 0, close: 0 }, SLOT_TIMES), []);
  assert.deepEqual(startTimesOn(null, SLOT_TIMES), SLOT_TIMES);
});

test("hours that hold none of the fixed times still leave a shop bookable", () => {
  // o-5280karate-org 6 to 9 PM, o-7cswimschool-com 5:30 to 6:30 AM, o-aberdeendriftwood-com 4 to 5 PM.
  assert.deepEqual(startTimesOn({ open: 18 * 60, close: 21 * 60 }, SLOT_TIMES), ["18:00", "20:00"]);
  assert.deepEqual(startTimesOn({ open: 5 * 60 + 30, close: 6 * 60 + 30 }, SLOT_TIMES), ["05:30"]);
  assert.deepEqual(startTimesOn({ open: 16 * 60, close: 17 * 60 }, SLOT_TIMES), ["16:00"]);
});

test("hours that run past midnight are read up to midnight, because the tail is the next date's", () => {
  // o-4lakescampground-com publishes 10 PM to 8 AM, which the parser stores as 22:00 to 32:00.
  assert.deepEqual(startTimesOn({ open: 22 * 60, close: 32 * 60 }, SLOT_TIMES), ["22:00"]);
  // o-10pinchicago-com, 10 AM to 1 AM: every fixed time from 11 is inside it.
  assert.deepEqual(startTimesOn({ open: 10 * 60, close: 25 * 60 }, SLOT_TIMES), ["11:00", "13:00", "15:00", "17:00"]);
});

test("no start time offered is one the shop's own week calls shut, over the whole shipped catalog", () => {
  let checked = 0;
  let days = 0;
  for (const f of readdirSync(dir)) {
    const item = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as Unclaimed;
    const week = itemWeek(item);
    if (!week) continue;
    checked++;
    for (let d = 0; d < 7; d++) {
      const stated = week[d];
      if (!stated) continue;
      days++;
      const offered = startTimesOn(stated, SLOT_TIMES);
      if (stated.close <= stated.open) {
        assert.deepEqual(offered, [], item.id + " offers times on a day it says it is closed");
        continue;
      }
      assert.ok(offered.length, item.id + " lost every start time on an open day");
      for (const t of offered) {
        assert.ok(hm(t) >= stated.open && hm(t) < Math.min(stated.close, 24 * 60), `${item.id} offers ${t} outside ${stated.open}-${stated.close}`);
      }
    }
  }
  assert.ok(checked > 10000, "read the shipped catalog, saw only " + checked);
  assert.ok(days > 10000, "stated days, saw only " + days);
});

test("the shops this was found on read right now, end to end from their own detail file", () => {
  // Monday at o-10kbrew-com: the page says "Closed, opens 4 PM" and the picker used to start at 7 AM.
  const brew = itemWeek(detail("o-10kbrew-com"))!;
  assert.deepEqual(startTimesOn(brew[1], SLOT_TIMES), ["17:00"]);
  // o-10thstreetmotocross-com is shut six days a week and was taking requests on every one of them.
  const track = itemWeek(detail("o-10thstreetmotocross-com"))!;
  assert.equal(track.filter((d) => d && d.close <= d.open).every((d) => startTimesOn(d, SLOT_TIMES).length === 0), true);
});

test("both booking surfaces read the one helper, so neither offers a time the other hides", () => {
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
  for (const [name, src] of [
    ["the phone listing sheet", read("../../components/booking/Sheets.tsx")],
    ["the desktop listing page", read("../../components/web/WebListing.tsx")],
  ] as const) {
    assert.match(src, /startTimesOn\(week \? week\[d\.getDay\(\)\] \?\? null : null, SLOT_TIMES, runsFor\)/, name + " filters its fixed times");
  }
  assert.match(read("../../../backend/src/api/openSlots.ts"), /startTimesOn\(week \? week\[d\.getDay\(\)\] \?\? null : null, DEFAULT_SLOTS, runsFor\)/, "the API filters the same way");
});

test("an empty picker says why, and does not call next Saturday today", () => {
  assert.equal(noStartTimesNote({ open: 0, close: 0 }, "Saturday"), "They are closed on Saturdays. Pick another day.");
  assert.equal(noStartTimesNote({ open: 10 * 60, close: 16 * 60 }, "Saturday"), "No more start times today. Pick another day.");
  assert.equal(noStartTimesNote(null, "Saturday"), "No more start times today. Pick another day.");
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
  for (const [name, src] of [
    ["the phone listing sheet", read("../../components/booking/Sheets.tsx")],
    ["the desktop listing page", read("../../components/web/WebListing.tsx")],
  ] as const) {
    assert.match(src, /noStartTimesNote\(/, name + " asks why the day is empty");
    assert.doesNotMatch(src, /: "No more start times today\. Pick another day\."/, name + " keeps no hardcoded copy of it");
  }
});

test("the API reads a shop's week the same way the page does, on every listing that ships one", () => {
  let same = 0;
  for (const f of readdirSync(dir)) {
    const item = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as Unclaimed;
    const mine = itemWeek(item);
    const theirs = weekIn(item as Parameters<typeof weekIn>[0]);
    assert.deepEqual(theirs, mine, item.id + ": the API and the listing page read different hours");
    if (mine) same++;
  }
  assert.ok(same > 10000, "read the shipped catalog, saw only " + same + " weeks");
});

/**
 * A start the listing's own stated length cannot finish by closing time. The page prints the length in its
 * key facts and the hours a few lines above that, so the picker under both may not contradict either.
 */
test("a start the shop's own stated length cannot finish by closing time is not offered", () => {
  // o-a-bayfishing-com: 8 to 3 every day, and its own menu calls the trip 7 hours. The fixed grid offered
  // 9, 11 and 1; only the eight o'clock the shop opens on can finish.
  assert.deepEqual(startTimesOn({ open: 8 * 60, close: 15 * 60 }, SLOT_TIMES, 7 * 60), ["08:00"]);
  // o-1620anglers-com: 8 to 6, an 8 hour charter. Nine is the last fixed time that lands.
  assert.deepEqual(startTimesOn({ open: 8 * 60, close: 18 * 60 }, SLOT_TIMES, 8 * 60), ["09:00"]);
  // A length that fits everywhere takes nothing away, and no length at all leaves the day exactly as it was.
  assert.deepEqual(startTimesOn({ open: 9 * 60, close: 19 * 60 }, SLOT_TIMES, 60), startTimesOn({ open: 9 * 60, close: 19 * 60 }, SLOT_TIMES));
  assert.deepEqual(startTimesOn({ open: 9 * 60, close: 19 * 60 }, SLOT_TIMES, 0), startTimesOn({ open: 9 * 60, close: 19 * 60 }, SLOT_TIMES));
});

test("a window too short to hold the shop's own trip keeps the times it had, rather than emptying", () => {
  // Three hours open and a four hour trip: one of the two crawled facts is wrong, and neither is a reason to
  // tell a guest the shop takes no bookings at all.
  const short = { open: 12 * 60, close: 15 * 60 };
  assert.deepEqual(startTimesOn(short, SLOT_TIMES, 4 * 60), startTimesOn(short, SLOT_TIMES));
  assert.deepEqual(startTimesOn(short, SLOT_TIMES, 4 * 60), ["13:00"]);
  // And a day that is closed, or that the site says nothing about, is unchanged by a length.
  assert.deepEqual(startTimesOn({ open: 0, close: 0 }, SLOT_TIMES, 8 * 60), []);
  assert.deepEqual(startTimesOn(null, SLOT_TIMES, 8 * 60), SLOT_TIMES);
});

test("no shipped listing loses every start time it had to its own stated length", () => {
  let changed = 0;
  const all = readdirSync(dir);
  // Every seventh file: the catalog is alphabetical, so a slice off the front is all partner rows.
  for (const f of all.filter((_x, i) => i % 7 === 0)) {
    const u = detail(f.replace(/\.json$/, ""));
    const week = itemWeek(u);
    if (!week) continue;
    const runsFor = minutesIn(u.dur || durationLabel(u) || "");
    if (!runsFor) continue;
    for (const day of week) {
      const before = startTimesOn(day ?? null, SLOT_TIMES);
      const after = startTimesOn(day ?? null, SLOT_TIMES, runsFor);
      if (before.join() !== after.join()) changed++;
      if (before.length) assert.ok(after.length, u.id + " kept no start time at all");
      for (const t of after) assert.ok(before.includes(t) || !!day, u.id + " invented " + t);
    }
  }
  assert.ok(changed > 100, "the rule bites on the shipped catalog: " + changed + " day lines");
});
