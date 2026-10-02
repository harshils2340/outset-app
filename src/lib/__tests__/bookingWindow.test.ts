import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { readFileSync, readdirSync } from "node:fs";

import { BOOKING_WINDOW_DAYS, bookingDates, dateKey, msToNextDay, startOfToday } from "../dates";

/**
 * The ten days a guest can pick from, across the one event nothing in the app used to notice: the local day
 * rolling over under a tab that is already open.
 *
 * The window was a `const` built when the module loaded, and every surface that offers a day read it: the
 * phone's `SlotCalendar`, the desktop listing's two month grids and its day-and-time picker, the shop's own
 * calendar fetch, and the date a reserve press sends to `POST /bookings`. Measured in a real Chromium on
 * o-islandkayaking-com with the page's clock moved on: a tab opened at 23:50 on Friday 2 October still
 * offered Saturday 3, Sunday 4 and Monday 5 as bookable at 00:50 on Tuesday 6, and struck 12 to 15 October
 * through as "not available" though they are inside the shop's real ten days. The route refuses a date more
 * than a day old ("date out of range"), so the guest reads an error on the last press of the flow.
 */

const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min, 0, 0).getTime();

test("the window starts on today and runs the booking window's length", () => {
  mock.timers.enable({ apis: ["Date"], now: at(2026, 10, 2, 23, 50) });
  try {
    const days = bookingDates();
    assert.equal(days.length, BOOKING_WINDOW_DAYS);
    assert.equal(dateKey(days[0]), "2026-10-02");
    assert.equal(dateKey(days[days.length - 1]), "2026-10-11");
  } finally {
    mock.timers.reset();
  }
});

test("a tab left open across midnight stops offering yesterday", () => {
  mock.timers.enable({ apis: ["Date"], now: at(2026, 10, 2, 23, 50) });
  try {
    assert.equal(dateKey(bookingDates()[0]), "2026-10-02");
    mock.timers.setTime(at(2026, 10, 3, 0, 50));
    const days = bookingDates();
    assert.equal(dateKey(days[0]), "2026-10-03");
    assert.equal(dateKey(days[days.length - 1]), "2026-10-12");
    assert.equal(days.some((d) => dateKey(d) === "2026-10-02"), false);
  } finally {
    mock.timers.reset();
  }
});

/** Three nights, which is a tab on a laptop lid rather than a tab left open for an hour. */
test("a window three days stale is not three days of past dates", () => {
  mock.timers.enable({ apis: ["Date"], now: at(2026, 10, 2, 23, 50) });
  try {
    bookingDates();
    mock.timers.setTime(at(2026, 10, 6, 0, 50));
    const keys = bookingDates().map(dateKey);
    assert.deepEqual(keys.slice(0, 3), ["2026-10-06", "2026-10-07", "2026-10-08"]);
    for (const gone of ["2026-10-03", "2026-10-04", "2026-10-05"]) assert.equal(keys.includes(gone), false);
    // The days the stale window was refusing are back inside it.
    assert.equal(keys.includes("2026-10-15"), true);
  } finally {
    mock.timers.reset();
  }
});

/**
 * The array is a `useMemo` and `useEffect` dependency on both booking surfaces: a fresh one per call would
 * refetch the shop's calendar on every render, which is the reason the window was a `const` in the first place.
 */
test("the same array comes back inside one day", () => {
  mock.timers.enable({ apis: ["Date"], now: at(2026, 10, 2, 9, 0) });
  try {
    const first = bookingDates();
    mock.timers.setTime(at(2026, 10, 2, 22, 30));
    assert.equal(bookingDates(), first);
    mock.timers.setTime(at(2026, 10, 3, 0, 1));
    assert.notEqual(bookingDates(), first);
  } finally {
    mock.timers.reset();
  }
});

test("the redraw is armed for the next local midnight, not an hour of UTC", () => {
  mock.timers.enable({ apis: ["Date"], now: at(2026, 10, 2, 23, 50) });
  try {
    assert.equal(msToNextDay(), 10 * 60 * 1000);
    mock.timers.setTime(at(2026, 10, 2, 0, 0));
    assert.equal(msToNextDay(), 24 * 60 * 60 * 1000);
  } finally {
    mock.timers.reset();
  }
});

/** A date strip is one thing; a day boundary across a DST change is where an hours-based sum goes wrong. */
test("the roll lands on the right day through a daylight saving boundary", () => {
  // 1 November 2026 is the US fall-back Sunday. 24 hours after midnight on the 1st is 23:00 on the 1st.
  mock.timers.enable({ apis: ["Date"], now: at(2026, 11, 1, 23, 30) });
  try {
    const keys = bookingDates().map(dateKey);
    assert.equal(keys[0], "2026-11-01");
    assert.equal(keys[1], "2026-11-02");
    mock.timers.setTime(at(2026, 11, 2, 0, 30));
    assert.equal(bookingDates().map(dateKey)[0], "2026-11-02");
  } finally {
    mock.timers.reset();
  }
});

/**
 * The rule, not the reading: nothing outside `lib/dates.ts` may freeze the booking window at module load
 * again. `startOfToday()` inside a render is fine, and is what every other surface already does.
 */
const ROOTS = ["../../components", "../../lib", "../../state"];

function sources(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  const walk = (dir: URL, label: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "__tests__") continue;
      if (e.isDirectory()) walk(new URL(e.name + "/", dir), label + e.name + "/");
      else if (/\.tsx?$/.test(e.name)) out.push({ file: label + e.name, text: readFileSync(new URL(e.name, dir), "utf8") });
    }
  };
  for (const r of ROOTS) walk(new URL(r + "/", import.meta.url), r.replace("../../", "src/") + "/");
  return out;
}

test("no module freezes a date or the booking window at load time", () => {
  const offenders: string[] = [];
  for (const { file, text } of sources()) {
    if (file.endsWith("lib/dates.ts")) continue;
    for (const line of text.split("\n")) {
      // A top-level `const` (no leading indent) whose value is read off the clock.
      if (/^(export )?const \w+\s*(:[^=]+)?=\s*(new Date\(\)|startOfToday\(\)|makeDates\(|bookingDates\(\))/.test(line)) {
        offenders.push(file + ": " + line.trim());
      }
    }
  }
  assert.deepEqual(offenders, [], "a date read at module load is the day the tab opened on, for ever:\n" + offenders.join("\n"));
});

test("startOfToday is midnight on the day it is called", () => {
  mock.timers.enable({ apis: ["Date"], now: at(2026, 10, 2, 23, 50) });
  try {
    assert.equal(dateKey(startOfToday()), "2026-10-02");
    assert.equal(startOfToday().getHours(), 0);
  } finally {
    mock.timers.reset();
  }
});
