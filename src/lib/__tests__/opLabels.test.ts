import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Two controls in the dashboard that a keyboard or a screen reader could not tell apart.
 *
 * The Calendar's week view draws up to seven empty cells per time row, each holding one button with no words
 * in it, and every one of them was called "Block slot". A reader tabbing the grid heard the same two words
 * over and over, and the only way to know which Tuesday at 11 it was on was to count Tab presses across a row
 * that skips every closed, past and booked cell. The Services editor has the same shape in a column: one
 * trash per price option, all called "Remove option", and on a service's last option it is disabled with
 * nothing said about why, so the owner meets a dimmed icon and no reason.
 *
 * Both are in markup, so this reads the source the way `bookingsWidth.test.ts` reads the stylesheet.
 */

const CAL = readFileSync(new URL("../../components/operator/OpCalendar.tsx", import.meta.url), "utf8");
const SVC = readFileSync(new URL("../../components/operator/OpServices.tsx", import.meta.url), "utf8");

/**
 * The one attribute that names a button with no text in it. Taken from the first `aria-label` after the class,
 * because what sits between them is an `onClick` arrow, and a reader that stops at the first `>` stops inside it.
 */
function label(src: string, cls: string): string {
  const at = src.indexOf(cls);
  if (at < 0) return "";
  const m = /aria-label=\{([^}]*)\}/.exec(src.slice(at, at + 600));
  return m ? m[1] : "";
}

test("a calendar cell's block button names the time and the day it would close", () => {
  const l = label(CAL, "odcalfill");
  assert.notEqual(l, "", "the block button has an aria-label");
  assert.match(l, /where/, "the label carries the cell, not just the verb");
  // The day itself comes from `dayPickLabel`, the one reader all four booking calendars share, rather than
  // from a fourth hand-written `toLocaleDateString`.
  assert.match(CAL, /const where = fmtTime\(slot\) \+ " on " \+ dayPickLabel\(d\);/);
  // Both states still say which way the click goes.
  assert.match(l, /Reopen/);
  assert.match(l, /Block/);
});

test("the day the label names is the cell's own day, not the week's anchor", () => {
  // `d` is the column being drawn; `anchor` is where the week starts and would name Sunday for all seven.
  const m = /const where = ([^;]*);/.exec(CAL);
  assert.ok(m, "the cell label is built in one place");
  assert.match(m![1], /\(d\)/);
  assert.doesNotMatch(m![1], /anchor/);
});

test("a price option's trash names the option it would remove", () => {
  const l = label(SVC, "disabled={!canRemove}");
  assert.notEqual(l, "", "the trash has an aria-label");
  assert.match(l, /v\.label/, "the label carries the option's own name");
});

test("the trash on a service's last price option says why it will not work", () => {
  const l = label(SVC, "disabled={!canRemove}");
  assert.match(l, /canRemove/, "the disabled state changes the name a reader gets");
  assert.match(l, /at least one price option/);
  // A tooltip for a mouse too, and only when it has something to explain.
  assert.match(SVC, /title=\{canRemove \? undefined : "A service keeps at least one price option\./);
});

test("neither label carries an em dash", () => {
  assert.doesNotMatch(label(CAL, "odcalfill"), /—/);
  assert.doesNotMatch(label(SVC, "disabled={!canRemove}"), /—/);
});

/**
 * The same shape, swept. Three more trash buttons in the dashboard sat inside a `.map()` and were all called
 * "Remove": one per day off on Availability, one per line in a Listing list, one per photo. The row beside each
 * one says which it is, and the button does not, so a reader hears a column of identical words. The two beside
 * them on the Listing lists ("Edit line 3", "Move up") have always been indexed, so the trash between them was
 * the odd one out.
 */
const HOURS = readFileSync(new URL("../../components/operator/OpHours.tsx", import.meta.url), "utf8");
const LISTING = readFileSync(new URL("../../components/operator/OpListing.tsx", import.meta.url), "utf8");

test("no trash button in the dashboard is called just Remove any more", () => {
  for (const [name, src] of [["OpHours", HOURS], ["OpListing", LISTING], ["OpServices", SVC], ["OpCalendar", CAL]] as const) {
    assert.doesNotMatch(src, /aria-label="Remove"/, name + " still has an unnamed trash button");
  }
});

test("a day off is put back by its own date", () => {
  assert.match(HOURS, /aria-label=\{"Put " \+ name \+ " back"\}/);
  // The name is the date already drawn in the row, not a second spelling of it.
  assert.match(HOURS, /const name = isoToDate\(d\)\.toLocaleDateString\(/);
  assert.match(HOURS, /<b>\{name\}<\/b>/);
});

test("a Listing line and a photo are removed by their own number", () => {
  // Five of these lists share one page, so the line's own list is in the name as well as its number.
  assert.match(LISTING, /aria-label=\{"Remove " \+ label \+ " line " \+ \(i \+ 1\)\}/);
  assert.match(LISTING, /aria-label=\{"Remove photo " \+ \(i \+ 1\)\}/);
});
