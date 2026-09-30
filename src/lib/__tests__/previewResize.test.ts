import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * The drag handle down the left edge of the guest preview, which is how an operator makes the preview beside
 * their editor wider or narrower.
 *
 * Driven in a real Chromium against the wiring it had, headless at 900px: press the edge, move left with the
 * button held, then let go where the page cannot hear it (outside the browser window) and move the pointer
 * back over the page with no button at all. The panel went on resizing, and `dragging` stayed true, which
 * keeps the shield over the preview frame: the operator could not click into their own listing again until
 * they reloaded the dashboard, and the panel followed their mouse across the screen meanwhile. A pointer the
 * browser takes back, which is what a `pointercancel` is, left it the same way, because nothing listened for
 * one.
 *
 * Three things end the drag now, and the same drive leaves the width where the operator let go: the edge
 * captures the pointer, so a release outside the window arrives at all; a cancelled pointer ends the drag the
 * way a release does; and a move carrying no button is read as a release that went missing.
 */

const SRC = readFileSync(new URL("../../components/operator/OpPreview.tsx", import.meta.url), "utf8");
const DRAG = SRC.slice(SRC.indexOf("const startDrag"), SRC.indexOf("useEffect(() => {", SRC.indexOf("const startDrag")));

test("the resize handle captures the pointer, so a release outside the window still arrives", () => {
  assert.match(DRAG, /setPointerCapture\(pointer\)/);
});

test("a cancelled pointer ends the resize drag the way a release does", () => {
  assert.ok(DRAG.includes('window.addEventListener("pointercancel", up)'), "pointercancel is listened for");
  assert.ok(DRAG.includes('window.removeEventListener("pointercancel", up)'), "and taken off again");
});

test("a move with no button held ends the resize drag rather than resizing", () => {
  const guard = DRAG.indexOf("ev.buttons === 0");
  const resize = DRAG.indexOf("onWidth(last)");
  assert.ok(guard >= 0, "the move handler checks whether a button is still held");
  assert.ok(guard < resize, "and checks it before it resizes anything");
});

test("both resize listeners answer only their own drag", () => {
  assert.equal(DRAG.match(/ev\.pointerId !== pointer/g)?.length, 2);
});

test("the preview still draws its shield from the same state the drag sets", () => {
  // The shield is what stops the iframe swallowing the pointer, so a drag that never ends is a preview that
  // can never be clicked. Held here because the state and the class are what tie the two together.
  assert.match(SRC, /"odpreview" \+ \(dragging \? " dragging" : ""\)/);
});
