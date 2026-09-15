import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyWebhook } from "../stripe.ts";

/**
 * Stripe signs "<timestamp>.<body>" and sends both in the Stripe-Signature header. The HMAC covers the
 * timestamp, so a forged one was never possible, but Number("abc") is NaN and every comparison with NaN is
 * false, so a non-numeric timestamp used to slide past the freshness check that is supposed to stop replays.
 */

const SECRET = "whsec_test_verifyWebhook";
const sign = (t: string, body: string) => `t=${t},v1=${createHmac("sha256", SECRET).update(t + "." + body).digest("hex")}`;

test("a correctly signed, fresh event is accepted", (t) => {
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  t.after(() => delete process.env.STRIPE_WEBHOOK_SECRET);
  const body = '{"type":"checkout.session.completed"}';
  const now = String(Math.floor(Date.now() / 1000));
  assert.equal(verifyWebhook(body, sign(now, body)), true);
});

test("a timestamp that is not a number is refused, not treated as fresh", (t) => {
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  t.after(() => delete process.env.STRIPE_WEBHOOK_SECRET);
  const body = '{"type":"checkout.session.completed"}';
  for (const bad of ["abc", "", "NaN", "Infinity", "1e999"]) {
    assert.equal(verifyWebhook(body, sign(bad, body)), false, bad);
  }
});

test("an old event and a wrong signature are both refused", (t) => {
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  t.after(() => delete process.env.STRIPE_WEBHOOK_SECRET);
  const body = '{"type":"checkout.session.completed"}';
  const old = String(Math.floor(Date.now() / 1000) - 3600);
  assert.equal(verifyWebhook(body, sign(old, body)), false);
  const now = String(Math.floor(Date.now() / 1000));
  assert.equal(verifyWebhook(body, `t=${now},v1=${"0".repeat(64)}`), false);
  assert.equal(verifyWebhook(body + " ", sign(now, body)), false); // body tampered after signing
});

test("with no secret set, nothing is accepted", () => {
  delete process.env.STRIPE_WEBHOOK_SECRET;
  const body = "{}";
  assert.equal(verifyWebhook(body, sign(String(Math.floor(Date.now() / 1000)), body)), false);
});
