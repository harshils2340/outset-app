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
  assert.match(CAL, /const where = fmtTime\(slot\) \+ " on " \+ d\.toLocaleDateString\(/);
  // Both states still say which way the click goes.
  assert.match(l, /Reopen/);
  assert.match(l, /Block/);
});

test("the day the label names is the cell's own day, not the week's anchor", () => {
  // `d` is the column being drawn; `anchor` is where the week starts and would name Sunday for all seven.
  const m = /const where = ([^;]*);/.exec(CAL);
  assert.ok(m, "the cell label is built in one place");
  assert.match(m![1], /\bd\./);
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
