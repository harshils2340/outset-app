import assert from "node:assert/strict";
import test from "node:test";
import { fmtDate } from "../format";

/**
 * The date on the confirmation ticket, the Trips list, the booking box and the start-times header.
 *
 * It printed no year at all, so a trip booked in late December for the third of January read as "Sat, Jan 3",
 * which on that day is the January that has already been and gone. The emails have carried the year since the
 * first bug bash; this is the same rule on the screens.
 */

test("a date in the current year is short, with no year", () => {
  const now = new Date(2026, 8, 16);
  assert.equal(fmtDate(new Date(2026, 0, 3), now), "Sat, Jan 3");
  assert.equal(fmtDate(new Date(2026, 11, 31), now), "Thu, Dec 31");
});

test("a date in another year carries it", () => {
  const now = new Date(2026, 11, 28);
  assert.equal(fmtDate(new Date(2027, 0, 3), now), "Sun, Jan 3, 2027");
  assert.equal(fmtDate(new Date(2025, 0, 3), now), "Fri, Jan 3, 2025", "a trip already taken says which January too");
});
