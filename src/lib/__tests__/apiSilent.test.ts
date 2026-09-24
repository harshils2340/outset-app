import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { apiDidNotAnswer } from "../api";

/**
 * A call the API never answered is not a verdict on what was sent.
 *
 * Two screens in the claim and sign-in flow printed one as though it were. `exchangeClaimToken` returned a bare
 * `ok: false` for a timeout, a dead connection, the rate limiter and a 502 alike, and the claim screen turned
 * every one of those into "That claim link didn't check out. Ask for a fresh one below" for a link that was
 * perfectly good, while the fresh one it offered needed the same API that had just gone quiet. `/auth/verify`
 * was worse: the sign-in screens said "That code does not match." to an owner who had typed the right code,
 * and the API counts six tries on a code before it burns it, so being sent back to retype a correct one costs
 * the code itself.
 *
 * Both now ask this. Nothing else changes: a 401 is still the API reading the token and refusing it, and a 410
 * is still an expired link with its own line.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, "../..", p), "utf8");

test("only an answer on the merits counts as one", () => {
  // Everything `call` catches: no API configured, a dead connection, a request that timed out.
  assert.equal(apiDidNotAnswer(0), true);
  // The rate limiter counts the caller; it never read the token or the code.
  assert.equal(apiDidNotAnswer(429), true);
  // The API falling over, restarting, or a proxy in front of it giving up.
  assert.equal(apiDidNotAnswer(500), true);
  assert.equal(apiDidNotAnswer(502), true);
  assert.equal(apiDidNotAnswer(503), true);
  assert.equal(apiDidNotAnswer(504), true);
  assert.equal(apiDidNotAnswer(408), true);
  // The API reading what was sent and refusing it. These are the owner's problem, and only these.
  assert.equal(apiDidNotAnswer(400), false);
  assert.equal(apiDidNotAnswer(401), false);
  assert.equal(apiDidNotAnswer(403), false);
  assert.equal(apiDidNotAnswer(404), false);
  // 410 is the expiring claim link, which has a line of its own and must never be folded in here.
  assert.equal(apiDidNotAnswer(410), false);
  assert.equal(apiDidNotAnswer(200), false);
});

test("the claim link exchange says which of the three happened", () => {
  const src = read("lib/api.ts");
  const start = src.indexOf("export async function exchangeClaimToken");
  assert.ok(start > -1, "exchangeClaimToken is gone");
  const fn = src.slice(start, src.indexOf("\n}", start));
  assert.match(fn, /expired: r\.status === 410/, "an expiring link's own 410 no longer reaches the screen");
  assert.match(fn, /unanswered: apiDidNotAnswer\(r\.status\)/, "a silent API is indistinguishable from a refused link again");
});

test("a sign-in code the API never read is not called wrong", () => {
  const api = read("lib/api.ts");
  const start = api.indexOf("export async function verifySignInCode");
  assert.ok(start > -1, "verifySignInCode is gone");
  const fn = api.slice(start, api.indexOf("\n}", start));
  assert.match(fn, /unanswered: apiDidNotAnswer\(r\.status\)/, "verify stopped saying whether the API answered");

  // Both screens that type a code: the operator's and the private metrics page's.
  for (const p of ["components/operator/OpLogin.tsx", "components/admin/AdminSignIn.tsx"]) {
    const src = read(p);
    const at = src.indexOf("That code does not match.");
    assert.ok(at > -1, p + " no longer has the mismatch line");
    const line = src.slice(src.lastIndexOf("\n", at) + 1, src.indexOf("\n", at));
    assert.match(line, /r\.unanswered \?/, p + " tells an owner their code is wrong when the API went quiet");
  }
});

test("the claim screen keeps a line for a link the API never judged", () => {
  const src = read("components/operator/OpLogin.tsx");
  // The state exists, the exchange sets it, and the details step prints something for it.
  assert.match(src, /"bad" \| "expired" \| "offline"/, "linkState lost its offline state");
  assert.match(src, /r\.expired \? "expired" : r\.unanswered \? "offline" : "bad"/, "the exchange no longer sorts its three failures");
  const msg = src.match(/linkState === "offline" \? <p className="oderr">([^<]+)</);
  assert.ok(msg, "nothing is printed for a link the API never judged");
  assert.doesNotMatch(msg![1], /didn't check out|does not match|expired/i, "the offline line blames the link");
  // The step that has no business record yet says "check your connection" already; offline belongs with it.
  assert.match(src, /\(linkState === "bad" \|\| linkState === "offline"\)/, "the pick step drops the offline case");
});
