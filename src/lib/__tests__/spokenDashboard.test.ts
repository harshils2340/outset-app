import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

/**
 * The operator dashboard's own notices, read for whether a screen reader is told.
 *
 * One pill at the bottom of the screen carries everything the dashboard says back: "Blocked as time off",
 * "Day off added", "Samples removed", and every refusal it has, from the Accept whose PATCH failed to
 * "Could not release the listing. Nothing was changed." Driven in a real Chromium at 390px before this was
 * written: the Home feed held zero live regions, and flipping the Accepting switch put "Paused. Guests can't
 * book new times." on the screen with nothing in the accessibility tree to say so.
 */

const DIR = new URL("../../components/operator/", import.meta.url);
const read = (f: string) => readFileSync(new URL(f, DIR), "utf8");
const VIEW = read("OperatorView.tsx");

test("the pill the dashboard talks through is announced", () => {
  assert.match(
    VIEW,
    /<span className="odsr" role="status" aria-live="polite">\{toastText \|\| ""\}<\/span>/,
    "a live region that is always mounted carries the toast text",
  );
  // The pill itself is the same words again, so it is the hidden region that speaks and the pill that shows.
  assert.match(VIEW, /className="odtoast" aria-hidden="true"/, "the visible pill is not read out twice");
});

test("both banners the dashboard raises after it has painted are statuses", () => {
  assert.match(VIEW, /\{claimNotice \? \(\s*\n\s*<div className="odnotice" role="status">/, "already claimed");
  assert.match(VIEW, /\{signedOut \? \(\s*\n\s*<div className="odnotice" role="status">/, "signed out");
});

test("every error line on the way into the dashboard is an alert", () => {
  const login = read("OpLogin.tsx");
  const lines = login.match(/className="oderr"[^>]*/g) || [];
  assert.ok(lines.length >= 9, "the claim and sign-in screens print at least nine error lines");
  for (const l of lines) assert.match(l, /role="alert"/, "this error line is announced: " + l);
});

test("no message the operator reads back from a press is left silent", () => {
  // Field validation that appears as the operator types: the same alert the guest booking box uses.
  const more = read("OpMore.tsx");
  for (const m of more.match(/className="oderr"[^>]*/g) || []) assert.match(m, /role="alert"/, m);
  // Nothing in this folder may print the pill's own class without the hidden region beside it.
  const users = readdirSync(DIR).filter((f) => f.endsWith(".tsx") && /className="odtoast"/.test(read(f)));
  assert.deepEqual(users, ["OperatorView.tsx"], "the toast is drawn in one place");
});
