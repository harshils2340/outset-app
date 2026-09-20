import assert from "node:assert/strict";
import test from "node:test";
import { ottoCanPay } from "../wallet";

test("Otto only pays when the saved card is on, under the cap", () => {
  const w = { ready: true, brand: "visa", last4: "4242", maxDollars: 250, otto: true };
  assert.equal(ottoCanPay(w, 250), true);
  assert.equal(ottoCanPay(w, 250.4), false);
  assert.equal(ottoCanPay({ ...w, otto: false }, 40), false);
  assert.equal(ottoCanPay({ ...w, ready: false }, 40), false);
  assert.equal(ottoCanPay(null, 40), false);
});
