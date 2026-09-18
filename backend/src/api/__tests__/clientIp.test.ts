import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";

process.env.CLAIM_SECRET = "client-ip-test-secret";
const { clientIp } = await import("../auth.ts");

/**
 * Behind Cloudflare the last X-Forwarded-For entry is an edge address that rotates per connection, so a
 * limiter keyed on it never adds up for anyone. CF-Connecting-IP is stamped by Cloudflare itself and wins.
 */
async function ipFor(headers: Record<string, string>): Promise<string> {
  const app = new Hono();
  app.get("/ip", (c) => c.text(clientIp(c)));
  const res = await app.request("/ip", { headers });
  return res.text();
}

test("cf-connecting-ip is the caller, not the rotating edge address at the end of x-forwarded-for", async () => {
  assert.equal(await ipFor({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "203.0.113.9, 172.70.1.2" }), "203.0.113.9");
});

test("without cloudflare the last x-forwarded-for entry is still the one trusted", async () => {
  assert.equal(await ipFor({ "x-forwarded-for": "1.1.1.1, 10.0.0.5" }), "10.0.0.5");
  assert.equal(await ipFor({ "x-real-ip": "10.0.0.6" }), "10.0.0.6");
  assert.equal(await ipFor({}), "local");
});
