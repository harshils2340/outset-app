import { test } from "node:test";
import assert from "node:assert/strict";

// Set before auth.ts is loaded, so claimSecret() never writes backend/data/claim-secret.txt from a test run.
process.env.CLAIM_SECRET = "session-test-secret";
const { idsMerged, idsWith, signSession, verifySession } = await import("../auth.ts");

/**
 * A session is one token for every listing it may edit, and every route that hands one out has to keep what
 * the caller already held. POST /claims/:id/exchange did not: an operator signed in for one shop who opened
 * the claim link for a second got a token scoped to the second alone, so the first shop stayed in their
 * dashboard and every save of it answered 403 with nothing on screen to say why.
 */

test("a new session keeps the listings the caller already held", () => {
  const prior = verifySession(signSession({ ids: ["o-one", "o-two"], email: "ann@example.com", exp: Date.now() + 60000 }));
  assert.deepEqual(idsWith(prior, "o-three"), ["o-one", "o-two", "o-three"]);
});

test("a listing already in the session is not added twice", () => {
  const prior = verifySession(signSession({ ids: ["o-one"], email: "", exp: Date.now() + 60000 }));
  assert.deepEqual(idsWith(prior, "o-one"), ["o-one"]);
});

test("with no session to start from, the new one covers the listing just proved", () => {
  assert.deepEqual(idsWith(null, "o-one"), ["o-one"]);
});

test("a session that expired adds nothing, so a stale token cannot widen a fresh one", () => {
  const stale = verifySession(signSession({ ids: ["o-one", "o-two"], email: "", exp: Date.now() - 1 }));
  assert.equal(stale, null);
  assert.deepEqual(idsWith(stale, "o-three"), ["o-three"]);
});

/**
 * Signing in by email code is the one mint that did not keep what the caller held. A claim link only ever goes
 * to the address on that business's own website, so an owner of two shops holds one address per shop: signing
 * in with either one handed back a session scoped to that address's listings alone, while the dashboard's
 * switcher still listed both, and every save of the other answered 403.
 */
test("a sign-in keeps the shops the caller was already signed in to", () => {
  const prior = verifySession(signSession({ ids: ["o-first-shop"], email: "ann@first.example", exp: Date.now() + 60000 }));
  assert.deepEqual(idsMerged(prior, ["o-second-shop"]), ["o-first-shop", "o-second-shop"]);
});

test("a sign-in that proves nothing new changes nothing", () => {
  const prior = verifySession(signSession({ ids: ["o-first-shop", "o-second-shop"], email: "", exp: Date.now() + 60000 }));
  assert.deepEqual(idsMerged(prior, ["o-first-shop"]), ["o-first-shop", "o-second-shop"]);
  assert.deepEqual(idsMerged(null, ["o-first-shop"]), ["o-first-shop"]);
  assert.deepEqual(idsMerged(null, []), []);
});

test("an expired session widens a sign-in no further than the email itself", () => {
  const stale = verifySession(signSession({ ids: ["o-first-shop"], email: "", exp: Date.now() - 1 }));
  assert.equal(stale, null);
  assert.deepEqual(idsMerged(stale, ["o-second-shop"]), ["o-second-shop"]);
});

test("a token signed with another secret is not a session", () => {
  const token = signSession({ ids: ["o-one"], email: "", exp: Date.now() + 60000 });
  const [payload] = token.split(".");
  assert.equal(verifySession(payload + ".notasignature"), null);
  assert.equal(verifySession(payload), null);
  assert.equal(verifySession(undefined), null);
});

test("editing the listings in a session invalidates it", () => {
  const token = signSession({ ids: ["o-one"], email: "", exp: Date.now() + 60000 });
  const sig = token.split(".")[1];
  const forged = Buffer.from(JSON.stringify({ ids: ["o-one", "o-someone-elses"], email: "", exp: Date.now() + 60000 })).toString("base64url");
  assert.equal(verifySession(forged + "." + sig), null);
});
