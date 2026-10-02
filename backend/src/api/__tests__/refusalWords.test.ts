import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { tryAgainIn } from "../auth.ts";

const src = (f: string) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

/**
 * The refusals a person reads, as opposed to the ones only a log reads.
 *
 * Every string listed here is printed by a screen as the whole of its error line, with nothing added: the
 * guest's reserve box and the phone sheet's toast (`AppProvider.confirmUnclaimed`), both sign-in code screens
 * (`OpLogin`, `AdminSignIn` both do `setErr(r.error || ...)`), and the dashboard's upload and payout toasts
 * (`OpListing`, `OpMore` both do `toast(r.error || ...)`). So each one has to read as a sentence on its own:
 * "too many requests, try again later" and "that code does not match" did not, and the app's own fallbacks
 * beside them ("That code does not match.") were the tidier of the two.
 *
 * The rest of the API's `error:` strings are deliberately short codes behind guards a person cannot trip
 * ("bad id", "not allowed", "bad json"), and the app's own `guestWords` exists to keep those off a screen.
 */
const PERSON_FACING: [string, string[]][] = [
  ["auth.ts", ["Enter a valid email address.", "That code has expired. Request a new one.", "Too many attempts. Request a new code.", "That code does not match."]],
  ["uploads.ts", ["No image arrived. Try again.", "That image is too large. Keep it under 1.8 MB.", "That has to be a JPEG or a PNG.", "That image is too many pixels across. Re-save it and try again."]],
  ["payouts.ts", ["A pay schedule is weekly or every two weeks.", "Set up payouts first.", "Payouts are not switched on yet.", "Claim the listing first."]],
];

test("every refusal a screen prints as its own line is a sentence", () => {
  for (const [file, lines] of PERSON_FACING) {
    const text = src(file);
    for (const line of lines) {
      assert.ok(text.includes('error: "' + line + '"'), file + " no longer answers " + JSON.stringify(line));
      assert.match(line, /^[A-Z]/, JSON.stringify(line) + " starts lower case");
      assert.match(line, /[.!?]$/, JSON.stringify(line) + " has no full stop");
      assert.ok(!/[—–]/.test(line), JSON.stringify(line) + " carries a long dash");
    }
  }
});

test("the per-caller ceiling says what happened and when to come back", () => {
  const text = src("auth.ts");
  // The old line was "too many requests, try again later", which the app's `guestWords` will not say out loud:
  // under the Reserve button it became "Check the details and try again", about details that are fine.
  // Not the string anywhere in the file: the comment above `rateLimit` quotes the old line on purpose.
  assert.ok(!/error: "too many requests/.test(text), "rateLimit answers in a log's words again");
  assert.match(text, /Too many tries from this connection\. " \+ tryAgainIn\(/);
  // A sentence `guestWords` passes through: a capital, a space, and a full stop it does not have to add.
  const said = "Too many tries from this connection. " + tryAgainIn(60 * 60 * 1000);
  assert.match(said, /^[A-Z]/);
  assert.match(said, /[.!?]$/);
});

test("the wait is the real one, rounded the way a person would say it", () => {
  assert.equal(tryAgainIn(60 * 60 * 1000), "Try again in an hour.");
  assert.equal(tryAgainIn(59.5 * 60 * 1000), "Try again in an hour.", "59 and a half minutes is not 60 minutes");
  assert.equal(tryAgainIn(12 * 60 * 1000), "Try again in 12 minutes.");
  assert.equal(tryAgainIn(61 * 1000), "Try again in 2 minutes.");
  assert.equal(tryAgainIn(60 * 1000), "Try again in a minute.");
  assert.equal(tryAgainIn(1), "Try again in a minute.", "under a minute is still a minute, never 0");
  assert.equal(tryAgainIn(0), "Try again in a minute.");
  assert.equal(tryAgainIn(-5000), "Try again in a minute.", "a clock that went backwards is not a negative wait");
  assert.equal(tryAgainIn(2 * 60 * 60 * 1000), "Try again in 2 hours.");
});
