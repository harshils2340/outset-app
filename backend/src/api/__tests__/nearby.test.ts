import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nearby } from "../nearby.ts";

const here = dirname(fileURLToPath(import.meta.url));

test("GET /nearby with no Places key answers empty, and never invents a shop", async () => {
  const prev = process.env.GOOGLE_PLACES_API_KEY;
  process.env.GOOGLE_PLACES_API_KEY = "";
  try {
    const res = await nearby.request("http://localhost/nearby?q=karate&lat=43.46&lon=-80.52");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("cache-control") || "", /\bprivate\b/);
    assert.doesNotMatch(res.headers.get("cache-control") || "", /\bpublic\b/);
    assert.deepEqual(await res.json(), { places: [] });
    const short = await nearby.request("http://localhost/nearby?q=x&lat=43.46&lon=-80.52");
    assert.deepEqual(await short.json(), { places: [] });
  } finally {
    if (prev == null) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = prev;
  }
});

test("/nearby is public, above the admin-key gate", () => {
  const routes = readFileSync(join(here, "../routes.ts"), "utf8");
  const mount = routes.indexOf('app.route("/", nearby)');
  const gate = routes.indexOf("Everything below is internal tooling");
  assert.ok(mount > -1, "routes.ts does not mount /nearby");
  assert.ok(gate > -1, "routes.ts no longer has the admin gate");
  assert.ok(mount < gate, "/nearby is behind the admin key, so the guest home cannot call it");
});
