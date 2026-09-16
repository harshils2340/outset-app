import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Where the dashboard's two notices sit.
 *
 * `.odnotice` carries no grid placement of its own, and `.od` is a two column grid whose `.odmain` holds column
 * two, so an `.odnotice` rendered as a direct child of `.od` is auto-placed into column one: measured in
 * Chromium at x 8, width 248, y 764 on a 1440 by 900 screen, which is behind the fixed 248px sidebar and below
 * the fold. That is where "This listing was already claimed by ..." was, the one thing that tells an owner
 * somebody else has walked in through a forwarded claim link. In the phone frame `.od` is a flex column, so it
 * was under the tab bar instead. Inside `.odbody` the same element measures x 288, width 1112, y 90.
 */

const here = dirname(fileURLToPath(import.meta.url));

test("both dashboard notices render inside the page body, not loose in the grid", () => {
  const src = readFileSync(join(here, "../../components/operator/OperatorView.tsx"), "utf8");
  const bodyOpen = src.indexOf('<main className="odbody"');
  const bodyClose = src.indexOf("</main>", bodyOpen);
  assert.ok(bodyOpen > -1 && bodyClose > bodyOpen, "the dashboard no longer has an .odbody element");
  let from = 0;
  let found = 0;
  for (;;) {
    const at = src.indexOf('className="odnotice"', from);
    if (at < 0) break;
    found += 1;
    assert.ok(at > bodyOpen && at < bodyClose, "an .odnotice at index " + at + " is outside .odbody, where the grid hides it behind the sidebar");
    from = at + 1;
  }
  assert.equal(found, 2, "expected the claim notice and the signed-out notice");
});
