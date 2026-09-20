import { test } from "node:test";
import assert from "node:assert/strict";
import { agentMayCharge, WALLET_DEFAULT_CENTS, walletLimitCents, walletLimitDollars } from "../wallet.ts";

test("Otto only charges when it is on, a card is saved, and the total fits the cap", () => {
  const w = { otto: true, paymentMethod: "pm_1", maxCents: 25_000 };
  assert.equal(agentMayCharge(w, 250), true);
  assert.equal(agentMayCharge(w, 250.01), false);
  assert.equal(agentMayCharge({ ...w, otto: false }, 40), false);
  assert.equal(agentMayCharge({ ...w, paymentMethod: null }, 40), false);
  assert.equal(agentMayCharge(w, 0.5), false);
});

test("the Profile slider cannot set a limit outside $20 to $2,000", () => {
  assert.equal(walletLimitCents(250), WALLET_DEFAULT_CENTS);
  assert.equal(walletLimitCents(1), 2_000);
  assert.equal(walletLimitCents(9_999), 200_000);
  assert.equal(walletLimitDollars(WALLET_DEFAULT_CENTS), 250);
});
