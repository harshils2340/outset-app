import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * The claim screen's buttons against the one that had no busy state.
 *
 * `POST /auth/verify` counts the try before it compares the code (`rec.tries += 1` ahead of the compare) and
 * deletes the code on the sixth, and the one that matches deletes it too. The button that sends it, "Open my
 * dashboard", was the only control on this screen with no disabled state, no busy label and no re-entrancy
 * guard, while the API gets 12 seconds and its host sleeps when idle. So an owner holding a correct code saw
 * nothing happen, pressed again, and spent their own attempts: six presses answered "Too many attempts.
 * Request a new code." for a code that was right, and the second press alone was enough to paint "that code
 * has expired" over a sign-in that was already working.
 */

const SRC = readFileSync(new URL("../../components/operator/OpLogin.tsx", import.meta.url), "utf8");

test("the code button says it is working and cannot be pressed twice", () => {
  const button = /<button[^>]*onClick=\{finish\}[^>]*>[^<]*<\/button>/.exec(SRC)?.[0];
  assert.ok(button, "the code step still has one button that calls finish()");
  assert.match(button, /disabled=\{checking\}/, "it is disabled while the code is being checked");
  assert.match(button, /aria-busy=\{checking\}/, "and says so to a screen reader");
  assert.match(button, /Checking/, "and its own label says what it is doing");
});

test("a second press cannot reach the API while the first is out", () => {
  const finish = SRC.slice(SRC.indexOf("const finish = () =>"));
  assert.match(finish.slice(0, finish.indexOf("}")), /if \(checking\) return;/);
  const signIn = SRC.slice(SRC.indexOf("const finishSignIn = async"), SRC.indexOf("const requestLink = async"));
  assert.match(signIn, /if \(checking\) return;/, "the handler guards itself too, for the Enter key");
  assert.match(signIn, /setChecking\(true\)/);
  // Whichever way it ends, including a throw out of the load that follows a good code.
  assert.match(signIn, /finally \{\s*setChecking\(false\);\s*\}/);
});

test("every button on this screen that calls the API refuses a second press", () => {
  // The async handlers are the ones that reach the network; each needs a disabled state of its own.
  const handlers = [...SRC.matchAll(/const (\w+) = async \(/g)].map((m) => m[1]);
  assert.ok(handlers.length >= 5, "found the screen's async handlers: " + handlers.join(", "));
  const naked: string[] = [];
  for (const b of SRC.matchAll(/<button\b[^>]*>/g)) {
    const tag = b[0];
    const onClick = /onClick=\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/.exec(tag)?.[1] || "";
    const calls = handlers.filter((h) => new RegExp("\\b" + h + "\\(").test(onClick));
    // `finish` is not itself async; it is the door to `finishSignIn`, and it is covered above.
    if (/\bfinish\(\)/.test(onClick) || /onClick=\{finish\}/.test(tag)) continue;
    if (calls.length && !/disabled=/.test(tag)) naked.push(calls.join("/") + ": " + tag.slice(0, 90));
  }
  assert.deepEqual(naked, [], "these buttons start a network call with nothing stopping a second press:\n" + naked.join("\n"));
});

test("the API still counts a try before it compares the code, which is why the button has to hold", () => {
  const auth = readFileSync(new URL("../../../backend/src/api/auth.ts", import.meta.url), "utf8");
  const route = auth.slice(auth.indexOf('auth.post("/auth/verify"'));
  const body = route.slice(0, route.indexOf('auth.get("/auth/session"'));
  const triesAt = body.indexOf("rec.tries += 1");
  const compareAt = body.indexOf("timingSafeEqual");
  assert.ok(triesAt > 0 && compareAt > 0);
  assert.ok(triesAt < compareAt, "the try is counted first, so a repeat of a correct code still spends one");
  assert.match(body, /if \(rec\.tries > 5\) \{/);
  assert.match(body, /codes\.delete\(email\)/);
});
