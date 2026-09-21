import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * The Bookings list may not set the width of the page it sits on.
 *
 * `.odbklist` is a grid with one `auto` column, and each day's rows sit in a wrapper that is a grid item. A
 * grid item's `min-width` is `auto`, not 0, so that wrapper refuses to be narrower than the widest booking
 * row it holds, and the one column grows to fit it. The row is as wide as the avatar, the guest's name, the
 * price and the Needs answer badge laid side by side, which is 392px.
 *
 * On a phone the dashboard is 332px wide at 360px and 372px at 400px, and `.screen` clips what runs past it.
 * So every card on the operator's busiest page was drawn 20 to 46px too wide and cut off on the right: the
 * price, the status badge and the right side of the Accept button, with a gutter down the left and none down
 * the right. Nothing scrolled, nothing warned, it was simply gone. Measured in a real Chromium at 360, 375,
 * 390 and 400px before the fix and at none of them after it.
 *
 * Either answer keeps it right: `min-width: 0` on the wrapper (what ships) or a column track on `.odbklist`
 * that cannot grow past its container. This fails when both go, which is the way it came back.
 */

const TSX = readFileSync(new URL("../../components/operator/OpBookings.tsx", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../../styles/operator.css", import.meta.url), "utf8");

/** The `.odbklist { ... }` block as the stylesheet declares it, or "" when it declares none. */
function listRule(css: string): string {
  const m = /\.odbklist\s*\{([^}]*)\}/.exec(css);
  return m ? m[1] : "";
}

test("the booking list is a grid, so its items need a floor of their own", () => {
  const rule = listRule(CSS);
  assert.match(rule, /display\s*:\s*grid/, ".odbklist is expected to be a grid; if that changed, re-read this test");
});

test("a day of bookings cannot widen the page past the phone screen", () => {
  const rule = listRule(CSS);
  // A track that cannot grow past its container: minmax(0, ...), a percentage, or a fixed length.
  const trackHolds = /grid-template-columns\s*:\s*(minmax\(\s*0|100%|\d)/.test(rule);
  // The wrapper each day's rows sit in, given a floor in the markup instead.
  const wrapperHolds = /<div key=\{b\.id\}[^>]*style=\{\{[^}]*minWidth:\s*0/.test(TSX);
  assert.ok(
    trackHolds || wrapperHolds,
    "nothing stops one booking row setting the width of the Bookings page: give the day wrapper min-width 0, or .odbklist a grid-template-columns of minmax(0, 1fr)",
  );
});

test("the row itself still knows how to shorten its own lines", () => {
  // The floor above only helps because the row ellipsises rather than overflowing once it is allowed to shrink.
  assert.match(CSS, /\.odbkmain \.meta\s*\{[^}]*min-width\s*:\s*0/, ".odbkmain .meta must be allowed to shrink");
  assert.match(CSS, /\.odbkmain \.meta small\s*\{[^}]*text-overflow\s*:\s*ellipsis/, ".odbkmain .meta small must ellipsise");
});
