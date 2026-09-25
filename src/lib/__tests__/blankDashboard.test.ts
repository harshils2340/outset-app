import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * An API that did not answer must never be read as a shop with nothing in it.
 *
 * `fetchRemoteProfile` returned a bare `null` for both "this listing has no profile" and "nobody answered", and
 * the two screens that build a dashboard from scratch read that `null` the first way. So a six second timeout
 * against a sleeping API, a 502 from in front of it, or the per-IP limiter was enough to hand a working
 * operator a blank dashboard built from the crawled record, `saveProfile` it over this device's copy, and then
 * push it to the API on the next app load, because `applyStoredProfiles()` sends every claimed listing it finds
 * here. That overwrites the menu, prices, photos, hours and policies the owner had already published, and the
 * owner's only sign that anything happened is a dashboard that looks like the day they claimed.
 *
 * Two doors reach it: the claim link's click-through, and signing in by code on a device that holds no profile.
 *
 * The same click had a second fault of its own, raised by the seventieth run. `proceedClaim` threw away what
 * `claimRemote` answered, so a claim the API never recorded still cleaned the token out of the address bar,
 * saved a profile and opened the dashboard. The listing stayed unclaimed on the server, the owner's address was
 * never linked to it, so "email me a sign-in code" had nothing to send to, and the one-click way back in was
 * gone from their own URL.
 *
 * Read from source, the way claimLink.test.ts and authLost.test.ts are: the rules live inside a component and a
 * module whose API_URL is fixed at import, and the repo has no renderer.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, "../..", p), "utf8");
const api = read("lib/api.ts");
const login = read("components/operator/OpLogin.tsx");

/** A named function's body, from its declaration to the first close at column 0. */
function fn(src: string, decl: string): string {
  const start = src.indexOf(decl);
  assert.ok(start > -1, decl + " is gone");
  const end = src.indexOf("\n}", start);
  assert.ok(end > start, decl + " is not a function any more");
  return src.slice(start, end);
}

/** An arrow constant's body, from its declaration to the first close at the component's indent. */
function arrow(src: string, decl: string): string {
  const start = src.indexOf(decl);
  assert.ok(start > -1, decl + " is gone");
  const end = src.indexOf("\n  };", start);
  assert.ok(end > start, decl + " is not a function any more");
  return src.slice(start, end);
}

test("the profile read says whether the API answered at all", () => {
  const body = fn(api, "export async function fetchRemoteProfileResult");
  // Only the API may say a listing has no profile. Its 404 is the one failure that ends the question.
  assert.match(body, /if \(r\.status === 404\) return \{ profile: null, unanswered: false \}/, "a 404 no longer settles it, or something else does");
  assert.match(body, /unanswered = apiDidNotAnswer\(r\.status\)/, "the verdict is no longer taken from apiDidNotAnswer");
  // The static guest copy is missing for every listing on a host that serves the catalog alone, so its 404
  // cannot clear a verdict the API never gave.
  const afterStatic = body.slice(body.indexOf("import.meta.env"));
  assert.doesNotMatch(afterStatic, /return \{ profile: null, unanswered: false \}/, "a missing static copy clears the API's silence");
  assert.match(body, /return \{ profile: null, unanswered \};\s*$/, "the last word is no longer the verdict that was worked out");
});

test("the old name stays a thin wrapper, so the listing page is untouched", () => {
  const body = fn(api, "export async function fetchRemoteProfile(");
  assert.match(body, /fetchRemoteProfileResult\(id\)\)\.profile/, "fetchRemoteProfile no longer reads through the new one");
  // catalogLoad's late fetch only wants the patch and has no use for the verdict; keep it on the plain name.
  assert.match(read("lib/catalogLoad.ts"), /fetchRemoteProfile\(path\)/, "the listing page's late profile fetch moved");
});

test("recording a claim says whether the API read the request", () => {
  const body = fn(api, "export async function claimRemote");
  assert.match(body, /Promise<\{ ok: boolean; unanswered: boolean \}>/, "claimRemote is back to a bare boolean");
  assert.match(body, /return \{ ok: r\.ok, unanswered: apiDidNotAnswer\(r\.status\) \}/, "claimRemote no longer separates a refusal from silence");
});

test("the claim click stops on a claim the server never heard", () => {
  const body = arrow(login, "const proceedClaim = async () => {");
  assert.match(body, /const claim = await claimRemote\(/, "proceedClaim throws away what claimRemote answers again");
  const at = body.indexOf("if (!claim.ok) {");
  assert.ok(at > -1, "nothing acts on a claim the API refused or never read");
  const branch = body.slice(at, body.indexOf("\n    }", at));
  assert.match(branch, /claim\.unanswered/, "a silent API and a refused link get the same sentence");
  assert.match(branch, /return;/, "a failed claim still opens the dashboard");
  // The whole point of stopping: the link is still the way back in, so it stays where the owner can press again.
  assert.ok(at < body.indexOf("cleanClaimHash()"), "the token is dropped before the claim is recorded");
  assert.ok(at < body.indexOf("onEnter("), "the dashboard opens before the claim is recorded");
});

test("the claim click stops rather than opening an empty dashboard over a real one", () => {
  const body = arrow(login, "const proceedClaim = async () => {");
  assert.match(body, /const remote = await fetchRemoteProfileResult\(apiId\)/, "the click is back on the read that cannot tell silence from an empty shop");
  const at = body.indexOf("if (remote.unanswered) {");
  assert.ok(at > -1, "a profile read that got no answer is treated as a listing with no profile");
  assert.match(body.slice(at, body.indexOf("\n    }", at)), /return;/, "it says so and carries on anyway");
  // Nothing that writes may run before that check: a blank default saved here is what the next load pushes up.
  assert.ok(at < body.indexOf("defaultProfile("), "a default profile is built before the read is known to be real");
  assert.ok(at < body.indexOf("saveProfile("), "a profile is saved before the read is known to be real");
  assert.ok(at < body.indexOf("cleanClaimHash()"), "the token is dropped before the read is known to be real");
});

test("signing in by code stops at the same place", () => {
  const body = arrow(login, "const enterWithIds = async (ids: string[]) => {");
  assert.match(body, /const remote = await fetchRemoteProfileResult\(id\)/, "the sign-in loader is back on the read that cannot tell the two apart");
  const at = body.indexOf("if (remote.unanswered)");
  assert.ok(at > -1, "a listing whose settings never arrived is filled in from the crawled record");
  assert.match(body.slice(at, body.indexOf("\n", at)), /continue;/, "the loop carries on into the blank profile anyway");
  assert.ok(at < body.indexOf("defaultProfile("), "the default profile is built before the read is known to be real");
  assert.ok(at < body.indexOf("saveProfile("), "the profile is saved before the read is known to be real");
});

test("a retry after a signed-in load failed does not send the spent code back", () => {
  // The API deletes a code the moment it accepts it, and the session is already saved on this device, so
  // re-verifying answers "code expired, request a new one" to an owner who is in fact signed in.
  const body = arrow(login, "const finishSignIn = async () => {");
  const at = body.indexOf("if (verifiedIds)");
  assert.ok(at > -1, "the retry goes back through verifySignInCode");
  assert.ok(at < body.indexOf("await verifySignInCode("), "the guard runs after the code has already been sent again");
  assert.match(body, /setVerifiedIds\(r\.ids\)/, "nothing remembers what the accepted code bought");
  // A fresh code, or a different address, is a different sign-in.
  assert.match(arrow(login, "const startSignIn = async () => {"), /setVerifiedIds\(null\)/, "asking for a new code keeps the old one's listings");
  const email = login.slice(login.indexOf("setSigninEmail(e.target.value)"));
  assert.match(email.slice(0, 120), /setVerifiedIds\(null\)/, "typing a different address keeps the last one's listings");
});

test("the confirm screen can say why the click did not work", () => {
  const start = login.indexOf('if (linkState === "confirm" && pendingClaim)');
  assert.ok(start > -1, "the confirm screen is gone");
  const block = login.slice(start, login.indexOf("\n  }", start));
  assert.match(block, /err \? <p className="oderr"/, "the only screen the failed click leaves you on prints nothing");
  assert.match(block, /void proceedClaim\(\)/, "the button no longer retries the click");
});
