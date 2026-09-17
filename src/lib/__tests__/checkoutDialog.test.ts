import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * The embedded card form is the newest screen in the booking flow and the only one with no way out but a single
 * button. It says `aria-modal` and did not behave like one: nothing moved focus into it, Escape did nothing,
 * and Tab walked out into the listing behind it. Driving it needs a real Stripe key, which this routine never
 * sets, so these read the source: they fail if any of the four pieces is taken out again.
 */

const SRC = readFileSync(new URL("../../components/booking/EmbeddedCheckout.tsx", import.meta.url), "utf8");

test("it is a dialog and says so", () => {
  assert.match(SRC, /role="dialog" aria-modal="true" aria-label="Pay for your booking"/);
});

test("focus starts inside it", () => {
  assert.match(SRC, /closeBtn\.current\?\.focus\(\)/);
  assert.match(SRC, /ref=\{closeBtn\}/);
});

test("Escape closes it without paying", () => {
  assert.match(SRC, /if \(e\.key === "Escape"\)/);
  const esc = SRC.slice(SRC.indexOf('e.key === "Escape"'));
  assert.match(esc.slice(0, 200), /cancel\.current\(\)/, "and it closes the same way the button does");
});

test("Tab stays inside it", () => {
  assert.match(SRC, /if \(e\.key !== "Tab"/);
  assert.match(SRC, /e\.shiftKey/);
  // Stripe draws the card fields in its own frame, so the frame has to be one of the stops.
  assert.match(SRC, /FOCUSABLE = '[^']*iframe/);
});

test("the two states that replace the card form announce themselves", () => {
  assert.match(SRC, /className="paycheckouterr" role="alert"/);
  assert.match(SRC, /className="paycheckoutwait" role="status"/);
});

test("the close button says what closing costs", () => {
  assert.match(SRC, /aria-label="Close without paying"/);
});
