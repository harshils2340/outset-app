import { test } from "node:test";
import assert from "node:assert/strict";
import { app } from "../routes.ts";

/**
 * The headers and the body limits a caller actually meets, read off the composed app rather than the source.
 *
 * Two routes set their own `cache-control` on purpose, `/where` and `/nearby`, and the blanket security
 * middleware sets `no-store` after the handler has run. So both deliberate headers were overwritten and both
 * routes answered `no-store`: `/where`'s ten minutes in the guest's own browser never happened, and
 * `/nearby`, which is a paid Places call, was re-asked on every mount. Each route already had a test and
 * neither caught it, because both read the header out of the file.
 *
 * The body limit had the mirror-image fault. A photo travels as base64 inside JSON, a third longer than the
 * file, so the blanket 2 MB cap was about 1.57 MB of JPEG: under the 1.8 MB the upload route says it takes
 * and under the 1.7 MB the browser's own resize passes aim at. A detailed photograph in between was accepted
 * by the browser and refused here with a bare "too large", and the route's own message never ran.
 *
 * Both are only visible on the whole app, which is why these are driven and not read.
 */

/** The JSON body the browser sends for a JPEG of this many bytes. */
function photoBody(jpegBytes: number): string {
  const b64 = "A".repeat(4 * Math.ceil(jpegBytes / 3));
  return JSON.stringify({ data: "data:image/jpeg;base64," + b64, type: "image/jpeg" });
}

test("a route that sets its own cache-control keeps it through the composed app", async () => {
  const where = await app.request("http://localhost/where");
  assert.equal(where.status, 200);
  const wc = where.headers.get("cache-control") || "";
  assert.match(wc, /\bprivate\b/, `/where answers "${wc}" on the composed app`);
  assert.match(wc, /max-age=600/, `/where answers "${wc}" on the composed app`);
  assert.doesNotMatch(wc, /\bpublic\b/);

  const near = await app.request("http://localhost/nearby?q=karate&lat=43.46&lon=-80.52");
  const nc = near.headers.get("cache-control") || "";
  assert.match(nc, /\bprivate\b/, `/nearby answers "${nc}" on the composed app`);
  assert.doesNotMatch(nc, /\bpublic\b/);
});

test("every other answer, a miss included, is no-store", async () => {
  for (const path of ["/config", "/health", "/no-such-route", "/uploads/o-nope-com/deadbeef.jpg"]) {
    const res = await app.request("http://localhost" + path);
    assert.equal(res.headers.get("cache-control"), "no-store", path + " is cacheable");
  }
});

test("the security headers are on every answer", async () => {
  for (const path of ["/config", "/no-such-route"]) {
    const res = await app.request("http://localhost" + path);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff", path);
    assert.equal(res.headers.get("x-frame-options"), "DENY", path);
    assert.ok(res.headers.get("strict-transport-security"), path + " has no HSTS");
  }
});

test("a photo as big as the upload route says it takes reaches that route", async () => {
  // 1.8 MB is the route's own ceiling and 1.7 MB is what the browser's passes aim at. Both have to get past
  // the body limit to be measured at all; 403 is the route's own gate answering an unauthenticated caller.
  for (const jpegBytes of [1_400_000, 1_570_000, 1_700_000, 1_800_000]) {
    const res = await app.request(
      new Request("http://localhost/uploads/o-test-com", { method: "POST", headers: { "content-type": "application/json" }, body: photoBody(jpegBytes) }),
    );
    assert.equal(res.status, 403, `${jpegBytes} bytes of JPEG never reached the upload route: ${await res.text()}`);
  }
});

test("a body past the photo ceiling, and any other large body, is still refused", async () => {
  const huge = await app.request(
    new Request("http://localhost/uploads/o-test-com", { method: "POST", headers: { "content-type": "application/json" }, body: photoBody(2_400_000) }),
  );
  assert.equal(huge.status, 413);
  assert.deepEqual(await huge.json(), { error: "too large" });

  for (const [path, method] of [["/bookings", "POST"], ["/profiles/o-test-com", "PUT"]] as [string, string][]) {
    const res = await app.request(
      new Request("http://localhost" + path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify({ data: "x".repeat(2_500_000) }) }),
    );
    assert.equal(res.status, 413, path + " took a body over 2 MB");
    assert.deepEqual(await res.json(), { error: "too large" });
  }
});
