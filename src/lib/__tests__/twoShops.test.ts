import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * An owner of two shops, editing both from the same browser.
 *
 * `applyStoredProfiles()` (called on every app load, and again from the dashboard's own storage listener) loops
 * over every business this device has claimed and pushes each one's saved profile to the API through
 * `saveRemoteProfile`. That function debounces so a keystroke does not fire a PUT per character. The debounce
 * used to be one shared slot for the whole module: `let queued: { id, body } | null`. Two businesses touched
 * inside the same 1.2 second window, whether from that loop or from the owner switching dashboards and editing
 * the second shop right after the first, left only the last one's write in `queued`; the earlier business's
 * edit was silently dropped and never reached the API, while the dashboard still said "Saved" because that
 * only reports the on-device write. A component test would need a renderer the repo does not have, and the
 * module's own `API_URL` is read from `import.meta.env` at import time, which is empty outside a Vite build, so
 * `saveRemoteProfile` always no-ops under the plain `node --test` runner here. This reads the source instead,
 * the same way `authLost.test.ts` does for the sibling bug in the same function.
 */

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "../api.ts"), "utf8");

test("the profile-save debounce is kept per listing, not in one shared slot", () => {
  // The old shape: `let pending: ... = null` and `let queued: { id: string; body: unknown } | null = null`,
  // one for the entire module. A second business's save would stomp the first's before its timer fired.
  assert.ok(!/let\s+queued\s*:/.test(src), "queued is back to being a single shared variable, not a Map keyed by listing id");
  assert.ok(!/let\s+pending\s*:/.test(src), "pending is back to being a single shared timer, not a Map keyed by listing id");
  const start = src.indexOf("export function saveRemoteProfile");
  assert.ok(start > -1, "saveRemoteProfile is gone from api.ts");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  assert.ok(/queued\.set\(id,/.test(body), "saveRemoteProfile no longer keys its queued write by the listing id");
  assert.ok(/pending\.get\(id\)/.test(body), "saveRemoteProfile no longer keys its debounce timer by the listing id");
});

test("releasing one listing cannot cancel another listing's pending save", () => {
  const start = src.indexOf("export async function releaseRemoteProfile");
  assert.ok(start > -1, "releaseRemoteProfile is gone from api.ts");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  // The old code cleared the module's one shared timer whenever `queued?.id === id` matched, which is exactly
  // right for a single shared slot and exactly wrong once the debounce is keyed per listing.
  assert.ok(!/queued\?\.\s*id\s*===\s*id/.test(body), "releaseRemoteProfile still tests a shared queued.id instead of clearing this id's own slot");
  assert.ok(/pending\.get\(id\)|pending\.delete\(id\)/.test(body), "releaseRemoteProfile no longer clears only this listing's own debounce slot");
});
