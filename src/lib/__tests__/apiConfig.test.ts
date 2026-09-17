import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { NO_CONFIG, normalizeConfig } from "../api";

/**
 * `/config` says whether the API takes cards and, since the embedded form landed, carries the publishable key
 * the form is drawn with. A failed read used to be remembered as an answer for the rest of the visit, and the
 * API host sleeps when idle while this read gives it five seconds, so the first guest of the morning could get
 * a listing that says "You won't be charged yet" under a button that then opens Stripe's card form: the API
 * decides whether to take a card from the listing's own price and never asked the browser.
 */

test("only a real answer is remembered", () => {
  const src = readFileSync(new URL("../api.ts", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("async function readConfig"));
  const beforeTheCache = body.slice(0, body.indexOf("configCache ="));
  assert.match(beforeTheCache, /return NO_CONFIG/, "a failed read returns the safe default");
  assert.ok(!/configCache\s*=\s*\{/.test(body), "and never writes a made-up answer into the cache");
  assert.match(body, /if \(!r\.ok \|\| !r\.data\) return NO_CONFIG/);
});

test("one read however many callers", () => {
  // The listing page asks as it mounts and the booking asks again when the guest presses the button.
  const src = readFileSync(new URL("../api.ts", import.meta.url), "utf8");
  assert.match(src, /configInFlight \?\?= readConfig\(\)/);
  assert.match(src, /configInFlight = null/);
});

test("the safe default switches nothing on", () => {
  assert.deepEqual(NO_CONFIG, { payments: false, mail: false, stripePublishableKey: null });
});

test("a real answer is read defensively, because it is JSON off the network", () => {
  assert.deepEqual(normalizeConfig({ payments: true, mail: true, stripePublishableKey: "pk_live_x" }), { payments: true, mail: true, stripePublishableKey: "pk_live_x" });
  // Payments on with no publishable key set is the hosted page, not an embedded form drawn with an empty key.
  assert.deepEqual(normalizeConfig({ payments: true, mail: false, stripePublishableKey: "" }), { payments: true, mail: false, stripePublishableKey: null });
  assert.deepEqual(normalizeConfig({} as never), { payments: false, mail: false, stripePublishableKey: null });
});
