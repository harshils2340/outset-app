import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * An owner of two shops, signing in by email code.
 *
 * A claim link only ever goes to the address on that business's own website, so an owner of two shops holds
 * one address per shop. `POST /auth/verify` minted a session from the listings that address owns and nothing
 * else, so signing in with either one dropped the other shop: it stayed in the dashboard's business switcher,
 * because that list is this device's own, and every save of it answered 403. The fourth run fixed the same
 * shape in `POST /claims/:id/exchange` and this was the one mint left.
 *
 * The merge itself is pinned on the API side in `backend/src/api/__tests__/session.test.ts`, where the prior
 * session is verified before anything is kept from it. This is the half that has to travel: the app has to
 * send the session it already holds, and `verifySignInCode` was the one authenticated-ish call that did not.
 * `api.ts` reads its own `API_URL` from `import.meta.env` at import time, which is empty under the plain
 * `node --test` runner, so the call itself no-ops here and the source is what there is to read.
 */

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "../api.ts"), "utf8");

test("signing in sends the session this device already holds", () => {
  const start = src.indexOf("export async function verifySignInCode");
  assert.ok(start > -1, "verifySignInCode is gone from api.ts");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  assert.ok(/loadApiSession\(\)/.test(body), "verifySignInCode no longer reads the session it already has");
  assert.ok(/"x-session"/.test(body), "verifySignInCode no longer sends the prior session, so the API cannot keep its shops");
});

test("what comes back is what the dashboard stores and opens", () => {
  const start = src.indexOf("export async function verifySignInCode");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  // The API answers with the merged list, so the saved session and the ids the claim screen loops over are
  // the same list. Taking one from the response and the other from anywhere else would drift.
  assert.ok(/saveApiSession\(\{ token: r\.data\.session, ids: r\.data\.ids/.test(body), "the saved session no longer uses the ids the API returned");
  assert.ok(/return \{ ok: true, ids: r\.data\.ids \}/.test(body), "the caller is no longer handed the ids the API returned");
});
