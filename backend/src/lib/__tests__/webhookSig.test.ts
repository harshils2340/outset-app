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

/**
 * Stripe signs an event with every secret the endpoint currently holds, so a header carries two `v1` values
 * while a signing secret is being rolled. Only one of them was made with the secret this service has, and it
 * can be either one.
 */
const OTHER = "whsec_test_theOtherSecretInTheRoll";
const mac = (secret: string, t: string, body: string) => createHmac("sha256", secret).update(t + "." + body).digest("hex");

test("a header carrying two signatures is accepted whichever position ours is in", (t) => {
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  t.after(() => delete process.env.STRIPE_WEBHOOK_SECRET);
  const body = '{"type":"checkout.session.completed"}';
  const now = String(Math.floor(Date.now() / 1000));
  const ours = mac(SECRET, now, body);
  const theirs = mac(OTHER, now, body);
  assert.equal(verifyWebhook(body, `t=${now},v1=${ours},v1=${theirs}`), true, "ours first");
  assert.equal(verifyWebhook(body, `t=${now},v1=${theirs},v1=${ours}`), true, "ours last");
  // Three active secrets, ours in the middle.
  assert.equal(verifyWebhook(body, `t=${now},v1=${theirs},v1=${ours},v1=${"0".repeat(64)}`), true, "ours in the middle");
  // A roll we are not part of is still refused: neither signature is ours.
  assert.equal(verifyWebhook(body, `t=${now},v1=${theirs},v1=${"0".repeat(64)}`), false, "none of them ours");
});

test("the fields may arrive in any order and with spaces, and v0 is not read as v1", (t) => {
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  t.after(() => delete process.env.STRIPE_WEBHOOK_SECRET);
  const body = '{"type":"checkout.session.expired"}';
  const now = String(Math.floor(Date.now() / 1000));
  const ours = mac(SECRET, now, body);
  assert.equal(verifyWebhook(body, `v1=${ours},t=${now}`), true);
  assert.equal(verifyWebhook(body, `t=${now}, v1=${ours}`), true);
  // Stripe's test-mode header carries a v0 signature over a different string; it must never stand in for v1.
  assert.equal(verifyWebhook(body, `t=${now},v0=${ours}`), false);
  // A field with no "=" at all is skipped rather than read as a signature.
  assert.equal(verifyWebhook(body, `t=${now},junk,v1=${ours}`), true);
  assert.equal(verifyWebhook(body, `t=${now},junk`), false);
});
