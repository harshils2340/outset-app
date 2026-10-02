import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dayPickLabel, fmtTime } from "../format";

/**
 * Every button in the dashboard's week grid says which day and time it belongs to.
 *
 * A week view is the one screen in this product where the same control repeats down and across. Read through
 * Chrome's own accessible-name computation at 1280px, the demo shop's calendar was 13 buttons all called
 * "Block slot" and, where one guest had booked the same trip three times, three all called
 * "Priya N. 1 · Guided tour". An operator working the grid with a screen reader had no way to tell which
 * Tuesday afternoon they were about to close, on the screen whose whole job is to say who is turning up when.
 */

test("a cell's name carries the time and the day, not just the action", () => {
  const d = new Date(2026, 9, 6); // Tuesday 6 October 2026
  assert.equal("Block " + fmtTime("14:30") + " on " + dayPickLabel(d), "Block 2:30 PM on Tuesday, October 6");
  assert.equal("Reopen " + fmtTime("09:00") + " on " + dayPickLabel(d), "Reopen 9:00 AM on Tuesday, October 6");
});

test("the calendar names both of its cell buttons by their own day and time", () => {
  const src = readFileSync(new URL("../../components/operator/OpCalendar.tsx", import.meta.url), "utf8");
  const row = src.slice(src.indexOf("function CalRow"));
  assert.ok(row.length > 0, "CalRow has moved; this check is reading nothing");
  // The empty cell: block or reopen, named and titled the same way so a mouse reads what a reader hears.
  assert.match(row, /const where = fmtTime\(slot\) \+ " on " \+ dayPickLabel\(d\);/, "the cell's day no longer reads the shared reader");
  assert.match(row, /aria-label=\{\(blocked \? "Reopen " : "Block "\) \+ where\}/);
  assert.match(row, /title=\{\(blocked \? "Reopen " : "Block "\) \+ where\}/);
  // The booking in a cell: the guest, the party, the service, then when.
  const event = row.slice(row.indexOf('className={"odevent '));
  assert.match(event.slice(0, 400), /aria-label=\{b\.guest \+/, "a booking in the grid is named by its content alone again");
  assert.match(event.slice(0, 400), /\+ where\}/, "a booking in the grid no longer says which day it is on");
  assert.doesNotMatch(row, /aria-label=\{blocked \? "Reopen slot" : "Block slot"\}/, "the bare label is back");
});
