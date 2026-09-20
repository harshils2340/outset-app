import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The demo host used to 404 POST /bookings. Ask then said "Could not send the request" in front of whoever
 * was watching, or dumped them onto FareHarbor. The route has to exist, allow POST, and answer 200.
 */

const here = dirname(fileURLToPath(import.meta.url));
const demo = readFileSync(join(here, "../../../scripts/demo-server.mts"), "utf8");

test("the demo host accepts POST /bookings so Ask can finish on this laptop", () => {
  assert.match(demo, /app\.post\("\/bookings"/);
  assert.match(demo, /access-control-allow-methods", "GET, POST, OPTIONS"/);
  assert.match(demo, /return c\.json\(\{ ok: true, status: "new" \}\)/);
});

test("demo cards are Stripe TEST only, and never a live key", () => {
  assert.match(demo, /if \(liveSecret\.startsWith\("sk_live"\)\) delete process\.env\.STRIPE_SECRET_KEY/);
  assert.match(demo, /STRIPE_TEST_SECRET_KEY/);
  assert.match(demo, /sk_test_/);
  const book = demo.slice(demo.indexOf("app.post(\"/bookings\""));
  assert.match(book, /checkout\.stripe\.com/);
  assert.doesNotMatch(book, /fareharbor|bookeo|resova/i);
});
