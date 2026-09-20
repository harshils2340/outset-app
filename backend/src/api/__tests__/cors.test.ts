import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every HTTP method the guest app and the operator dashboard send has to be on the CORS allow list.
 *
 * A method missing from `allowMethods` fails only in a browser, and only on the preflight, so the route itself
 * answers every in-process check perfectly. DELETE /profiles/:id, which is what "Release this listing" presses,
 * passed all of store-e2e and then did nothing at all when a real browser pressed the button: the preflight
 * said the method was not allowed and the fetch never left the page. The operator got "Could not release the
 * listing" and their shop stayed claimed.
 *
 * Reading the source keeps this honest without standing a server up: the methods `src/lib/api.ts` asks for are
 * the methods the API has to allow.
 */

const here = dirname(fileURLToPath(import.meta.url));
const routes = readFileSync(join(here, "../routes.ts"), "utf8");
const appApi = readFileSync(join(here, "../../../../src/lib/api.ts"), "utf8");

/** The `allowMethods: [...]` array as the cors() call lists it. */
function allowed(): string[] {
  const m = routes.match(/allowMethods:\s*\[([^\]]*)\]/);
  assert.ok(m, "routes.ts no longer passes allowMethods to cors()");
  return m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

/** Every `method: "..."` the app's API client sends. A fetch with no method is a GET. */
function methodsTheAppSends(): string[] {
  const out = new Set<string>(["GET"]);
  for (const m of appApi.matchAll(/method:\s*["']([A-Z]+)["']/g)) out.add(m[1]);
  return [...out];
}

test("the CORS allow list covers every method the app sends", () => {
  const list = allowed();
  for (const m of methodsTheAppSends()) {
    assert.ok(list.includes(m), `src/lib/api.ts sends ${m}, which the API's CORS allowMethods does not allow, so a browser preflight blocks it`);
  }
});

test("OPTIONS stays on the list, because the preflight itself is one", () => {
  assert.ok(allowed().includes("OPTIONS"));
});

test("the headers the app authenticates with are allowed too", () => {
  const m = routes.match(/allowHeaders:\s*\[([^\]]*)\]/);
  assert.ok(m, "routes.ts no longer passes allowHeaders to cors()");
  const headers = m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "").toLowerCase());
  // authHeaders() sends these two, and every write is refused without them.
  for (const h of ["x-session", "x-claim-token", "content-type", "x-wallet"]) {
    assert.ok(headers.includes(h), `the app sends ${h} and the API's CORS allowHeaders does not list it`);
  }
});
