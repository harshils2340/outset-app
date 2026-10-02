import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * The picked start time has to be dropped whenever the day on screen stops offering it, on both booking
 * surfaces, and both have to decide that from the times themselves.
 *
 * The desktop listing already did: `useEffect(..., [openSlots, time])` over the memo it draws the picker from.
 * The phone sheet watched `[dateIdx, live, openMap]`, which is the three things that usually move the list and
 * not the list. Two ways past it, and both end with Reserve live on a time nothing in the picker shows as
 * picked:
 *
 *   - today's chips shrink as `bookableStart`'s hour of notice passes them, so a 3 PM picked at half one is
 *     still picked at half two with 3 PM gone from the list;
 *   - the booking window rebuilds itself on the local day roll (see `bookingDates`), so the same index is a
 *     different date after midnight, with a different day's start times under it.
 *
 * Neither surface may go back to keying this on the index.
 */

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("the phone sheet drops a picked time on the times, not on the day index", () => {
  const sheet = read("../../components/booking/Sheets.tsx");
  const m = /if \(time && [^\n]*setTime\(null\);\n\s*\}, \[([^\]]*)\]\);/.exec(sheet);
  assert.ok(m, "Sheets.tsx still clears a picked time the picker no longer offers");
  const deps = m[1].split(",").map((d) => d.trim()).filter(Boolean);
  assert.ok(deps.includes("time"), "and re-checks when the picked time itself changes: " + deps.join(", "));
  assert.equal(deps.includes("dateIdx"), false, "the day index is not what decides it: " + deps.join(", "));
  assert.ok(
    deps.some((d) => /chip|slot|time/i.test(d) && d !== "time"),
    "something naming the offered times is a dependency: " + deps.join(", "),
  );
});

test("the desktop listing decides it the same way", () => {
  const page = read("../../components/web/WebListing.tsx");
  const m = /if \(time && !openSlots\.includes\(time\)\) setTime\(null\); \}, \[([^\]]*)\]\)/.exec(page);
  assert.ok(m, "WebListing.tsx still clears a picked time the picker no longer offers");
  const deps = m[1].split(",").map((d) => d.trim()).filter(Boolean);
  assert.deepEqual(deps.sort(), ["openSlots", "time"]);
});

/**
 * The other half of the same rule: the memo the desktop reads has to be built from the day it draws, or the
 * dependency above is a constant.
 */
test("the desktop's offered times are memoised on the day they are for", () => {
  const page = read("../../components/web/WebListing.tsx");
  assert.match(page, /const openSlots = useMemo\(\(\) => chipsFor\(day\)\.map\(\(c\) => c\.time\), \[chipsFor, day\]\)/);
});
