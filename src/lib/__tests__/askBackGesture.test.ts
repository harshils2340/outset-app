import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Back has to close what is on top of the app, not leave the app.
 *
 * An open sheet and an open chat each get their own history entry, so one back gesture closes them and only
 * the next one leaves the site. Ask Outset did not: it is the whole screen, it holds a typed question and a
 * thread, and driven at 400px in a real Chromium one back gesture with it open took the guest off the site
 * and the conversation with it. Measured at 1280px too, where the agent moves the guest into the phone frame.
 *
 * The three cannot stack: `openAsk` clears an open sheet, and the agent closes itself before opening a
 * listing, so one entry covers whichever is up.
 *
 * Ask Outset and the chat screen are switched off for guests since 3 October 2026 (`GUEST_AGENT` in
 * lib/flags.ts; `guestAgentOff.test.ts` holds that). The history handling stays, because a sheet still uses it
 * and the agent comes back with it when the switch does.
 */

const prov = readFileSync(new URL("../../state/AppProvider.tsx", import.meta.url), "utf8");

test("the agent counts as an overlay, so opening it pushes a history entry", () => {
  const m = /const overlay = ([^;]+);/.exec(prov);
  assert.ok(m, "the provider still decides what an overlay is in one place");
  const expr = m[1];
  assert.match(expr, /state\.sheet !== null/);
  assert.match(expr, /state\.screen === "chat"/);
  assert.match(expr, /state\.asking !== null/);
});

test("back closes the agent rather than the sheet underneath it", () => {
  // Read off the ref: the popstate effect is re-subscribed on the screen alone, so the closure is stale.
  assert.match(prov, /if \(stateRef\.current\.asking !== null\) dispatch\(\{ type: "closeAsk" \}\);\n\s*else if \(state\.screen === "chat"\) dispatch\(\{ type: "back" \}\);\n\s*else dispatch\(\{ type: "closeSheet" \}\);/);
});

test("closing it with its own control drops the entry again", () => {
  // Otherwise the stack grows a step the guest cannot see, and back does nothing once.
  assert.match(prov, /if \(\(window\.history\.state as \{ outsetOverlay\?: boolean \} \| null\)\?\.outsetOverlay\) window\.history\.back\(\);/);
});

test("a boot that lands straight on an overlay still leaves on back", () => {
  // `#o=` and `#ask=` are links a guest arrived by, so back means where they came from: the push is gated on
  // the boot having finished.
  assert.match(prov, /if \(!booted\.current\) return;\n\s*if \(overlay && !pushedOverlay\.current\)/);
});
