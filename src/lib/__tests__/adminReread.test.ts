import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * What sends the private metrics page back to the API, which decides whether the one person it is for can get
 * into it after typing the code it emailed them.
 *
 * The page reads on mount and then only when something it watches changes. It watched "this browser holds a
 * session with an address on it" and the range, and neither of those moves when an owner-claimed browser signs
 * in: the operator dashboard saves a session carrying whatever address was typed into the claim form, so the
 * page already counted itself signed in, had already been refused, and kept that refusal on screen. Signing in
 * with a perfectly good code drew "Not found". Driven in a real Chromium on 30 September against a stub that
 * refuses every session but the one its own /auth/verify minted: sign-in box, right code, "Not found", and a
 * manual reload to get in. The token is the thing that changes, so the read is keyed on the token.
 */

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

const { adminSessionEmail, adminSessionKey } = await import("../adminApi");

const SESSION_KEY = "outset.session.v1";
const save = (token: string, email: string, exp = Date.now() + 20 * 86400000) =>
  localStorage.setItem(SESSION_KEY, JSON.stringify({ token, ids: [], email, exp }));

test("no session at all is an empty key", () => {
  localStorage.removeItem(SESSION_KEY);
  assert.equal(adminSessionKey(), "");
  assert.equal(adminSessionEmail(), null);
});

test("signing in again under the same address changes the key", () => {
  // The state every browser that has claimed a shop is in, and every browser holding an admin session minted
  // before the gate started asking that the address was proven.
  save("session-from-a-claim-form", "harshils2340@gmail.com");
  const before = adminSessionKey();
  save("session-from-a-mailed-code", "harshils2340@gmail.com");
  assert.notEqual(adminSessionKey(), before);
});

test("the address alone does not move, which is why it cannot be what the read is keyed on", () => {
  save("session-from-a-claim-form", "harshils2340@gmail.com");
  const before = adminSessionEmail();
  save("session-from-a-mailed-code", "harshils2340@gmail.com");
  assert.equal(adminSessionEmail(), before);
});

test("an expired session is no credential, so the key is empty", () => {
  save("stale", "harshils2340@gmail.com", Date.now() - 1);
  assert.equal(adminSessionKey(), "");
});

/**
 * The arrangement in the page itself, which is the part that actually regressed. A pure helper nothing reads
 * would have passed this file and left the page exactly as broken.
 */
test("the metrics read is keyed on the session, and a sign-in drops the refusal it was given before", () => {
  const src = readFileSync(new URL("../../components/admin/AdminView.tsx", import.meta.url), "utf8");
  const deps = /\}, \[signedIn,([^\]]*)\]\);/.exec(src);
  assert.ok(deps, "AdminView still reads the metrics in an effect keyed on signedIn; rewrite this guard if it does not");
  assert.match(deps[1], /sessionKey/, "the read must re-run when the session token changes, not only when the page first has one");
  const onDone = /onDone=\{\(e\) => \{([^}]*)\}\}/.exec(src);
  assert.ok(onDone, "the sign-in box still reports back through onDone");
  assert.match(onDone[1], /setRes\(null\)/, "the refusal read with the old session is not an answer about the new one");
});
