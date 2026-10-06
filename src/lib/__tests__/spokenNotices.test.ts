import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Every notice the product gives without changing the screen, read for whether a screen reader is told.
 *
 * A toast, a nudge under a button and a refusal line under a form are the whole of what the app says when a
 * press does not go the way the guest or the operator expected. None of them moves focus and none of them
 * navigates, so unless the element carrying the words is a live region nothing is announced: the pill fades
 * in at the bottom of the screen, the button goes back to its old label, and the press reads as having done
 * nothing at all.
 *
 * Driven in a real Chromium before this was written: the phone listing page, its booking sheet, the pay step
 * and the operator dashboard each held zero live regions, while a refused booking ("That time was just
 * booked. Pick another time.") arrived in the toast and nowhere else.
 */

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("the guest app's toast is a live region, and is always mounted so the text is what changes", () => {
  const src = read("../../components/layout/Toast.tsx");
  assert.match(src, /role="status"/, "the toast carries role=status");
  assert.match(src, /aria-live="polite"/, "the toast is announced politely");
  // Mounted whatever the state, with the text inside it: a live region added to the page at the same moment
  // as its text is not reliably read out.
  assert.match(src, /className=\{"toast" \+ \(state\.toast \? " on" : ""\)\}/, "the toast container is always rendered");
  assert.ok(!/state\.toast \? <div/.test(src), "the toast is not mounted only when there is something to say");
});

test("the phone booking bar says out loud what it is waiting for", () => {
  const src = read("../../components/booking/Sheets.tsx");
  // `reserve` writes "Choose a service first" / "Pick a start time" into the price button beside the one that
  // was pressed, so the reason needs a region of its own.
  assert.match(src, /setNudge\(needService && !picked \? "Choose a service first" : "Pick a start time"\)/);
  assert.match(
    src,
    /<span className="vh" role="status" aria-live="polite">\{nudge \|\| ""\}<\/span>/,
    "the nudge is carried by a live region",
  );
});

test("every refusal the guest app prints under a form is announced", () => {
  const sheets = read("../../components/booking/Sheets.tsx");
  const listing = read("../../components/web/WebListing.tsx");
  const wallet = read("../../components/account/WalletCard.tsx");
  assert.match(sheets, /className="airsecsub airbad" role="alert"/, "the phone sheet's bad email line");
  assert.match(listing, /className="alfine albookerror" role="alert"/, "the desktop bad email line");
  assert.match(listing, /className="alfine center albookerror" role="alert"/, "the desktop booking refusal");
  assert.match(wallet, /className="walleterr" role="alert"/, "the saved card refusal");
});
