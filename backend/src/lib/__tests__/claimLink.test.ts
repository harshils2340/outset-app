import { test } from "node:test";
import assert from "node:assert/strict";

// Set before claim.ts is loaded, so claimSecret() never writes backend/data/claim-secret.txt from a test run.
process.env.CLAIM_SECRET = "claim-link-test-secret";
const { claimLinkDays, claimToken, claimTokenV2, verifyClaimToken } = await import("../claim.ts");

/**
 * The claim link is the whole front door. A token that checks out hands back a session for that listing, and
 * with it the operator's prices, photos, hours and every booking a guest has made. Nothing here had a test.
 *
 * The rules it has to keep, all of them written down in backend/AGENTS.md and none of them checked until now:
 * a v2 token is signed over the listing id AND its expiry, so it cannot be moved to another listing and its
 * life cannot be pushed out by editing the link; an expired link says so, because the claim screen offers a
 * fresh one rather than calling a genuine link a bad one; a forged one does not say so, because "expired" on
 * a signature we never wrote would confirm a guess; and the old static tokens still work, since links already
 * in operators' inboxes have to keep landing.
 */

const ID = "o-tampa-jet-ski-com";
const OTHER = "o-clearwater-parasail-com";

test("a fresh link opens the listing it was minted for", () => {
  const check = verifyClaimToken(ID, claimTokenV2(ID));
  assert.equal(check.ok, true);
  assert.equal(check.ok && check.kind, "v2");
});

test("the same link opens nothing else, because the id is signed too", () => {
  const r = verifyClaimToken(OTHER, claimTokenV2(ID));
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, "signature");
});

test("a link past its date is called expired, not bad, so the screen can offer a fresh one", () => {
  const r = verifyClaimToken(ID, claimTokenV2(ID, -1));
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, "expired");
});

/**
 * The reason v2 exists. The old token was HMAC(secret, id) and nothing else: one forwarded email could claim
 * that business forever. If the expiry could be edited in the address bar, v2 would be the old token with a
 * decoration on it.
 */
test("pushing the expiry out in the link does not buy another day", () => {
  const good = claimTokenV2(ID, -1);
  const [, , sig] = good.split(".");
  const far = (Date.now() + 365 * 86400000).toString(36);
  const forged = "v2." + far + "." + sig;
  const r = verifyClaimToken(ID, forged);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, "signature", "a tampered expiry must read as a bad signature, never as a longer life");
});

test("a signature we never wrote is a bad signature, whatever date rides with it", () => {
  const far = (Date.now() + 86400000).toString(36);
  const r = verifyClaimToken(ID, "v2." + far + "." + "A".repeat(22));
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, "signature");
});

test("the static links already in operators' inboxes still land", () => {
  const r = verifyClaimToken(ID, claimToken(ID));
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.kind, "legacy");
  const wrong = verifyClaimToken(OTHER, claimToken(ID));
  assert.equal(wrong.ok, false);
});

test("nothing that is not a token is read as one", () => {
  for (const bad of ["", "   ", "v2.", "v2..", "v2.abc", "v2.abc.", ".", "x".repeat(201), "v2." + "x".repeat(300)]) {
    const r = verifyClaimToken(ID, bad);
    assert.equal(r.ok, false, JSON.stringify(bad) + " must not verify");
  }
});

test("a token with a trailing field is still judged on the signature alone", () => {
  const good = claimTokenV2(ID);
  assert.equal(verifyClaimToken(ID, good + ".extra").ok, false);
});

test("CLAIM_LINK_DAYS sets the life, and anything that is not a positive number falls back to 30", () => {
  const was = process.env.CLAIM_LINK_DAYS;
  try {
    process.env.CLAIM_LINK_DAYS = "7";
    assert.equal(claimLinkDays(), 7);
    for (const junk of ["", "0", "-5", "soon", "NaN"]) {
      process.env.CLAIM_LINK_DAYS = junk;
      assert.equal(claimLinkDays(), 30, JSON.stringify(junk) + " should fall back to 30");
    }
  } finally {
    if (was === undefined) delete process.env.CLAIM_LINK_DAYS;
    else process.env.CLAIM_LINK_DAYS = was;
  }
});
