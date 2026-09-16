import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { authLost } from "../api";

/**
 * An operator whose session has run out.
 *
 * A session lasts thirty days and nothing renews it, and the claim link's own token expires too, so every
 * operator who claimed a month ago reaches this. Nothing noticed: `saveRemoteProfile` is debounced and its
 * answer was thrown away, so a 403 went nowhere, and the header went on reading "Saved", which is about this
 * browser's storage and not about Outset. The owner fixed prices, hours and photos for as long as they liked
 * and not one of those edits reached a guest, while new booking requests stopped arriving just as quietly.
 *
 * Driven in the rehearsal as step (j): the session is aged past its expiry, the business name is retyped, and
 * the check is that the name at the API did not move and the dashboard said so.
 */

const here = dirname(fileURLToPath(import.meta.url));

test("only the API refusing this device counts as being signed out", () => {
  // The API saying "not allowed" or "no session": the one thing that means sign in again.
  assert.equal(authLost(401), true);
  assert.equal(authLost(403), true);
  // A network failure is status 0 here, and a slow or restarting API answers 5xx. Neither is a reason to tell
  // an operator they have been signed out, because the next save will go through.
  assert.equal(authLost(0), false);
  assert.equal(authLost(500), false);
  assert.equal(authLost(502), false);
  assert.equal(authLost(429), false);
  assert.equal(authLost(200), false);
  assert.equal(authLost(404), false);
});

/**
 * The three calls that carry an operator's credentials. A component test would need a renderer the repo does
 * not have, so this reads the source: one of them going quiet is how this got missed the first time.
 */
test("every authenticated operator call reports a refusal", () => {
  const src = readFileSync(join(here, "../api.ts"), "utf8");
  for (const fn of ["saveRemoteProfile", "fetchBookings", "decideBooking"]) {
    const start = src.indexOf("export async function " + fn) >= 0 ? src.indexOf("export async function " + fn) : src.indexOf("export function " + fn);
    assert.ok(start > -1, fn + " is gone from api.ts");
    const body = src.slice(start, src.indexOf("\n}\n", start));
    assert.ok(/noteStatus\(|onAuthLost\?\.\(/.test(body), fn + " does not tell the dashboard when the API refuses it");
  }
});

test("the dashboard listens for it and offers a way back in", () => {
  const src = readFileSync(join(here, "../../components/operator/OperatorView.tsx"), "utf8");
  assert.ok(/onOperatorAuthLost\(/.test(src), "OperatorView no longer subscribes to onOperatorAuthLost");
  assert.ok(/Sign in again to publish your changes/.test(src), "the dashboard no longer says what an expired session costs");
  // The demo dashboard has no session by design and its saves are meant to stop at this browser.
  assert.ok(/isDemoProfile\(p\)/.test(src), "the demo dashboard would raise the signed-out notice too");
});
