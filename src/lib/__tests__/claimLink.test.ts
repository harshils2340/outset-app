import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The first load of a claim link, which is the one screen an owner meets before they own anything.
 *
 * Two rules live in that screen and neither can be read off a pure function, so this reads the source the way
 * authLost.test.ts does. A component test would need a renderer the repo does not have, and the claim-link
 * path is the one flow the rehearsal cannot drive: it enters the dashboard through the test bypass.
 *
 * 1. Nothing is recorded because the page loaded. A mail client's own link-safety scanner opens every URL in
 *    an incoming email before the recipient reads it, and one of them claimed a real listing on 22 September
 *    2026. Only a device that already holds this business's profile (a real return visit) or a person clicking
 *    through may record a claim.
 * 2. The token stays in the address bar until the claim is recorded. It used to be stripped as soon as it had
 *    checked out, which was while the confirm screen was still on screen: a reload there, or coming back to a
 *    tab the phone had discarded, handed the owner the sign-in form for a listing nobody had claimed yet, with
 *    the one-click way in gone from their own URL. Driven in a browser against a real v2 link on 22 September
 *    2026: before the fix the reload landed on the "Your bookings, the way they come in" pitch.
 */

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "../../components/operator/OpLogin.tsx"), "utf8");

/** The link-checking effect, from the top of `tick` to the point the confirm screen goes up. */
function tickSlice(): string {
  const start = src.indexOf("const tick = async () => {");
  const end = src.indexOf('setLinkState("confirm")');
  assert.ok(start > -1 && end > start, "OpLogin no longer has a tick() that ends in a confirm screen");
  return src.slice(start, end);
}

/** The click that finishes a first-time claim link. */
function proceedSlice(): string {
  const start = src.indexOf("const proceedClaim = async () => {");
  assert.ok(start > -1, "OpLogin no longer has proceedClaim");
  const end = src.indexOf("\n  };", start);
  assert.ok(end > start, "proceedClaim is not a function any more");
  return src.slice(start, end);
}

test("loading a claim link records nothing unless this device already holds the business", () => {
  const tick = tickSlice();
  const calls = tick.split("claimRemote(").length - 1;
  assert.equal(calls, 1, "the load path calls claimRemote " + calls + " times; only the return-visit branch may");
  assert.ok(
    tick.indexOf("const existing =") < tick.indexOf("claimRemote("),
    "claimRemote runs before the check for a profile this device already holds, so a link-safety scan claims the listing",
  );
  assert.ok(/setPendingClaim\(/.test(tick), "the first load no longer waits for a person to click through");
});

test("the click through is what records the claim", () => {
  const proceed = proceedSlice();
  assert.ok(/claimRemote\(/.test(proceed), "the confirm click no longer records the claim");
  assert.ok(/onEnter\(/.test(proceed), "the confirm click no longer opens the dashboard");
});

test("the claim token leaves the address bar only once the claim is recorded", () => {
  // One place rewrites the URL, so there is one rule to check rather than a call per branch.
  const rewrites = src.split("history.replaceState").length - 1;
  assert.equal(rewrites, 1, "OpLogin rewrites the URL in " + rewrites + " places; it should go through cleanClaimHash");
  assert.ok(/function cleanClaimHash\(\)/.test(src), "cleanClaimHash is gone");

  // Inside the effect the only place that may drop the token is the return visit, which records a claim of its
  // own. Everything before it runs on a load nobody asked for, the confirm screen included.
  const tick = tickSlice();
  const cleans = tick.split("cleanClaimHash()").length - 1;
  assert.equal(cleans, 1, "the load path drops the token in " + cleans + " places; only the return visit may");
  assert.ok(
    tick.indexOf("const existing =") < tick.indexOf("cleanClaimHash()"),
    "the token is taken out of the URL before the owner has clicked, so a reload at the confirm screen loses the link",
  );
  assert.ok(
    tick.indexOf("claimRemote(") < tick.indexOf("cleanClaimHash()"),
    "the return visit drops the token before it has recorded its claim",
  );

  // Both paths that record a claim clean up after themselves: the return visit and the click.
  const proceed = proceedSlice();
  assert.ok(/cleanClaimHash\(\)/.test(proceed), "the click records the claim and leaves the token in the address bar");
  assert.ok(
    proceed.indexOf("claimRemote(") < proceed.indexOf("cleanClaimHash()"),
    "the token is dropped before the claim is recorded, so a failed claim cannot be retried from the URL",
  );
  const ret = src.slice(src.indexOf("const existing = loadProfile(apiId)"), src.indexOf('setLinkState("confirm")'));
  assert.ok(/cleanClaimHash\(\)/.test(ret), "a return visit through the link keeps the token in the address bar");
});

test("the confirm screen names the business it is about to hand over", () => {
  const start = src.indexOf('if (linkState === "confirm" && pendingClaim)');
  assert.ok(start > -1, "the confirm screen is gone");
  const block = src.slice(start, src.indexOf("\n  }", start));
  assert.ok(/This is your business\?/.test(block), "the confirm screen no longer asks");
  // `picked` waits on a catalog version bump; the record the claim is about is already in hand.
  assert.ok(
    /claimHead\(pendingClaim\.u\)/.test(block),
    "the confirm screen draws its card from `picked`, so it can ask an owner to hand over a business it does not name",
  );
});
