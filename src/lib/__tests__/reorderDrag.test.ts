import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { rowUnder, type RowNode } from "../../components/operator/useReorder";

/**
 * Reordering a service, an add-on or a price option with the mouse, which is the way an operator at a desk
 * will do it and the one path nothing had ever driven.
 *
 * Driven in a real Chromium, headless at 900px, over the hook itself: grab a row's handle, drag it down onto
 * a row two below, let go. The list reordered under the cursor exactly as it should, and then on release it
 * snapped straight back to where it started and the live region said "Reorder cancelled, the original order
 * is back." Every mouse drag in the dashboard did that.
 *
 * `onDragEnd` put the list back unless a `drop` event had landed, and no drop ever landed. The list reorders
 * as the drag passes over each row, so the row being dragged slides under the cursor, and the dragged row was
 * the one target `onDragOver` refused to accept. Chrome will not drop on a target that never accepted, so the
 * drag ended with nothing but `dragend`, which the hook read as giving up. The dragged row accepts the drop
 * now, and where the operator let go is what settles it: over a row of this list is a drop, anywhere else is
 * still a cancel, which is what keeps the promise that letting go over the page header puts the list back.
 *
 * All six paths were driven again afterwards: a mouse drag down, a mouse drag up, a mouse drag released over
 * a nested row belonging to the inner list, a mouse drag abandoned above the list, the keyboard grab with
 * Escape, and the touch drag. Only the first three changed.
 */

const SRC = readFileSync(new URL("../../components/operator/useReorder.ts", import.meta.url), "utf8");

/**
 * A stand-in for the element tree `document.elementFromPoint` hands back, innermost row first. A null entry
 * is an ancestor with no row around it at all, which is where the walk has to stop.
 */
function fakeRows(chain: (string | null)[]): RowNode | null {
  let outer: RowNode | null = null;
  for (let i = chain.length - 1; i >= 0; i--) {
    const rid = chain[i];
    if (rid === null) {
      const plain: RowNode = { parentElement: outer, closest: () => null };
      outer = plain;
      continue;
    }
    const row: RowNode = { dataset: { rid }, parentElement: outer, closest: () => row };
    outer = row;
  }
  return outer;
}

test("a point inside a row of this list is that row", () => {
  assert.equal(rowUnder(fakeRows(["svc-2"]), (rid) => rid === "svc-2"), "svc-2");
});

test("a point inside a nested row of another list finds the row of this one around it", () => {
  // An open service card holds its own price option rows, each with a `data-rid` of its own.
  assert.equal(rowUnder(fakeRows(["var-9", "svc-2"]), (rid) => rid.startsWith("svc-")), "svc-2");
});

test("a point in no row of this list at all is nothing", () => {
  assert.equal(rowUnder(fakeRows(["var-9", null]), (rid) => rid.startsWith("svc-")), null);
  assert.equal(rowUnder(null, () => true), null);
});

test("the row walk stops rather than looping when a list holds a row twice", () => {
  assert.equal(rowUnder(fakeRows(["svc-2", "svc-2"]), () => false), null);
});

test("the dragged row accepts the drop, because the reorder puts it under the cursor", () => {
  const over = SRC.slice(SRC.indexOf("onDragOver:"), SRC.indexOf("onDragEnd:"));
  const guard = over.indexOf('dragging === id');
  const prevent = over.indexOf("e.preventDefault()");
  assert.ok(prevent >= 0 && guard >= 0, "onDragOver still calls preventDefault and still knows its own row");
  assert.ok(prevent < guard, "preventDefault must run before the dragged row is skipped, or the drop is refused");
});

test("a drag that ended over this list is a drop, not a cancel", () => {
  const end = SRC.slice(SRC.indexOf("onDragEnd:"), SRC.indexOf("onDrop:"));
  assert.match(end, /!landed\.current && !endedOnThisList\(/);
  assert.match(SRC, /Reorder cancelled, the original order is back\./);
});
