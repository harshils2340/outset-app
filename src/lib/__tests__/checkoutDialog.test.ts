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

test("Escape closes the form only, not the listing under it", () => {
  // AppProvider's window-level Escape closes whatever sheet is on top, and the listing is that sheet. Without
  // this stop, one Escape took down both and left the guest on the home page with the booking box gone.
  const esc = SRC.slice(SRC.indexOf('e.key === "Escape"'));
  assert.match(esc.slice(0, 600), /e\.stopPropagation\(\)/);
});

test("the page behind is locked on the root, not only on body", () => {
  // app.css clips html's overflow-x, so the viewport scrolls by html's overflow values; body's `hidden` alone
  // let a wheel roll the listing under the form.
  assert.match(SRC, /root\.style\.overflow = "hidden"/);
  assert.match(SRC, /root\.style\.overflow = prev\.root/);
});
