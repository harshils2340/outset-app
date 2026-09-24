import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The API host sleeps when idle, and the operator side is the one surface that cannot draw a single useful
 * screen without it: a claim link is traded for a session, a sign-in code is mailed, a profile is fetched.
 * `warmApi` exists for that (a `/health` call with a minute to answer in) and the guest booking sheet has
 * called it since 16 September, so the guest's "Book and pay" is never the request that pays the cold start.
 *
 * Nothing on the operator side did. An owner following a claim link from their inbox made the exchange call the
 * wake-up request, against a fifteen second timeout, and "Email me a sign-in code" was a twelve second one.
 * Both of those then read as a refusal rather than a wait.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, "../..", p), "utf8");

test("opening the operator side wakes the API", () => {
  const src = read("state/AppProvider.tsx");
  const at = src.indexOf('if (state.screen === "operator") warmApi();');
  assert.ok(at > -1, "nothing warms the API when the operator screen opens");
  // One effect on the screen itself, so it covers all three ways in: a claim link, a direct /operators load,
  // and "For operators" from the guest home.
  const dep = src.slice(at, src.indexOf("]", at) + 1);
  assert.match(dep, /\}, \[state\.screen\]/, "the warm-up is not keyed on the screen, so it misses a way in or fires on every render");
});

test("the two calls that mail an operator allow for a cold host", () => {
  const src = read("lib/api.ts");
  for (const [fn, want] of [["requestSignInCode", 25000], ["requestClaimLink", 25000]] as const) {
    const start = src.indexOf("export async function " + fn);
    assert.ok(start > -1, fn + " is gone");
    const body = src.slice(start, src.indexOf("\n}", start));
    const m = body.match(/timeout: (\d+)/);
    assert.ok(m, fn + " sends mail on the default timeout, which is shorter than a cold start");
    assert.ok(Number(m[1]) >= want, fn + " waits " + m[1] + "ms for a host that can take longer to wake");
  }
});
