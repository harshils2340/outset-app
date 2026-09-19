import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A response read off the caller's own IP address may never be stored in a shared cache.
 *
 * `GET /where` answers with the city Cloudflare resolved the request from, and the home opens on it. It is
 * the one route in the API that overrides the blanket `no-store`, and it shipped as
 * `public, max-age=600` with no `Vary`: Cloudflare already fronts this API, so the first guest through a
 * given edge would have decided where every other guest behind it opened for the next ten minutes. A guest
 * in Tampa would land on Toronto and never know why.
 *
 * `private` keeps the ten minutes where they are worth having, in the guest's own browser.
 *
 * Read from the source, the way the CORS test does, so no server has to be stood up.
 */

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = join(here, "..");

/** Every `c.header("cache-control", "...")` in a file, with the handler text that precedes it. */
function cacheHeaders(src: string): { value: string; before: string }[] {
  const out: { value: string; before: string }[] = [];
  for (const m of src.matchAll(/c\.header\(\s*["']cache-control["']\s*,\s*["']([^"']+)["']/g)) {
    out.push({ value: m[1], before: src.slice(Math.max(0, m.index - 900), m.index) });
  }
  return out;
}

test("/where is cached privately, never in a shared cache", () => {
  const routes = readFileSync(join(apiDir, "routes.ts"), "utf8");
  const start = routes.indexOf('app.get("/where"');
  assert.ok(start > -1, "routes.ts no longer defines GET /where");
  const handler = routes.slice(start, routes.indexOf("\napp.", start + 1));
  const header = handler.match(/c\.header\(\s*["']cache-control["']\s*,\s*["']([^"']+)["']/);
  assert.ok(header, "/where sets no cache-control, so the blanket no-store applies; that is safe but update this test");
  assert.match(header[1], /\bprivate\b/, `/where answers "${header[1]}"`);
  assert.doesNotMatch(header[1], /\bpublic\b/, `/where answers "${header[1]}", which any proxy may share between guests`);
});

test("no route that reads the caller's address is publicly cacheable", () => {
  for (const file of readdirSync(apiDir).filter((f) => f.endsWith(".ts"))) {
    const src = readFileSync(join(apiDir, file), "utf8");
    for (const { value, before } of cacheHeaders(src)) {
      if (!/\bpublic\b/.test(value)) continue;
      // The handler this header sits in, back to the previous route registration.
      const handler = before.slice(before.lastIndexOf("app."));
      assert.doesNotMatch(
        handler,
        /cf-ip|cf-connecting-ip|cf-region|x-forwarded-for|clientIp/i,
        `${file} serves a per-caller body with "${value}"`,
      );
    }
  }
});
