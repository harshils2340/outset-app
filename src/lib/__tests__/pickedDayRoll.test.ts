import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { bookingDates, dateKey } from "../dates";

/**
 * A guest's picked day has to survive the local day roll, on both booking surfaces.
 *
 * The ten-day window is rebuilt when the day rolls (see `bookingDates`), so the index a day was picked at is
 * the next day a minute later. Driven in a real Chromium with the page's clock moved on: a guest sitting on
 * Sunday 1 November at 23:50 was on Monday 2 November at 00:50 on both the desktop listing (1440px) and the
 * phone sheet (400px), with nothing touched, the mark on the grid moved under them and, on the phone, their
 * 3 PM still showing as picked for the new date.
 *
 * So neither surface may hold the picked day as a position alone: the desktop keeps `dayKey` beside its index
 * and re-finds it on the roll, the phone sheet holds the day itself and reads the index back off it. A day
 * that has fallen out of the window is the day that has just ended, so that guest lands on the first day
 * still in it and the picked start time goes with it.
 */

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("the window a day is picked out of is always the window as it stands", () => {
  const first = bookingDates();
  assert.equal(dateKey(first[0]), dateKey(new Date()));
  // The same array between rolls, because both surfaces memo and fetch on its identity.
  assert.equal(bookingDates(), first);
});

test("the provider remembers the day, not only the position", () => {
  const prov = read("../../state/AppProvider.tsx");
  // The picked day is written down whenever one is picked.
  assert.match(prov, /case "date":[\s\S]{0,400}dayKey: dateKey\(bookingDates\(\)\[action\.dateIdx\]/);
  // And read back on the roll rather than the index being kept.
  assert.match(prov, /case "dayRolled"[\s\S]{0,1700}days\.findIndex\(\(d\) => dateKey\(d\) === state\.dayKey\)/);
  // A day that has gone takes the picked start time with it.
  assert.match(prov, /case "dayRolled"[\s\S]{0,2000}slot: i >= 0 \? state\.slot : null/);
});

test("the midnight timer tells the reducer the day rolled rather than only nudging a redraw", () => {
  const prov = read("../../state/AppProvider.tsx");
  assert.match(prov, /dispatch\(\{ type: "dayRolled" \}\);\n\s*arm\(\);/);
});

test("the phone sheet holds the day itself and reads its position back off the window", () => {
  const sheet = read("../../components/booking/Sheets.tsx");
  assert.match(sheet, /const \[dayKey, setDayKey\] = useState/);
  assert.match(sheet, /const dateIdx = Math\.max\(0, dates\.findIndex\(\(d\) => dateKey\(d\) === dayKey\)\)/);
  assert.match(sheet, /const setDateIdx = \(i: number\) => setDayKey\(dateKey\(dates\[i\] \?\? dates\[0\]\)\)/);
  assert.equal(/useState\(\(\) => \{\s*const w = getPrefs\(\)\.when;[\s\S]{0,200}return i >= 0 \? i : 0;/.test(sheet), false, "the sheet no longer keeps a bare index in state");
});

test("the phone sheet drops the day and its time when the window no longer holds that day", () => {
  const sheet = read("../../components/booking/Sheets.tsx");
  const m = /if \(dates\.some\(\(d\) => dateKey\(d\) === dayKey\)\) return;\n\s*setDayKey\(dateKey\(dates\[0\]\)\);\n\s*setTime\(null\);\n\s*\}, \[([^\]]*)\]\);/.exec(sheet);
  assert.ok(m, "the sheet re-anchors a picked day that has fallen out of the window");
  const deps = m[1].split(",").map((d) => d.trim()).filter(Boolean);
  assert.deepEqual(deps.sort(), ["dates", "dayKey"]);
});
