import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * A control is only unavailable when pressing it does nothing.
 *
 * The booking box's primary carried `aria-disabled` for every state short of ready, and it was the way forward
 * in all of them: with no time picked it opens the date and start time picker, and with the name or the mobile
 * missing it moves focus to the field that is missing, which is what its own label tells the guest it will do.
 * So a screen reader announced the one control that gets a guest to the next step as unavailable, while the
 * stylesheet beside it deliberately kept it looking live for everybody else.
 *
 * The other direction matters just as much: a calendar day with no start times left really is inert, and says
 * so twice, in `aria-disabled` and in its own label. These read the source so neither side can quietly flip.
 */

const LISTING = readFileSync(new URL("../../components/web/WebListing.tsx", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../../styles/air-listing.css", import.meta.url), "utf8");

/** The one primary in the reserve card, found by the ref the scroll bar and the picker both read. */
const PRIMARY = /<button[^>]*ref=\{reserveRef\}[^>]*>/.exec(LISTING)?.[0] || "";

test("the reserve card's primary is only unavailable while it is actually sending", () => {
  assert.ok(PRIMARY, "expected the reserve primary to still be the button carrying reserveRef");
  assert.match(PRIMARY, /aria-disabled=\{sending\}/, "pressing it is the way forward in every other state");
  assert.doesNotMatch(PRIMARY, /aria-disabled=\{!ready/, "`!ready` is not a reason to call it unavailable");
  assert.match(PRIMARY, /aria-busy=\{sending\}/, "and busy is what a send is");
});

test("pressing it is never a dead end: every reason it is not ready has a next step", () => {
  const press = /const pressReserve = \(\) => \{([\s\S]*?)\n  \};/.exec(LISTING)?.[1] || "";
  assert.ok(press, "expected pressReserve to still be the handler");
  assert.match(press, /if \(ready\) return book\(\)/, "ready presses book");
  assert.match(press, /time == null.*setPickerOpen\(true\)/, "no time yet opens the picker");
  assert.match(press, /nameRef : phoneRef\)\.current\?\.focus\(\)/, "a missing detail focuses the field");
  // The third way `ready` can be false is a paused listing, and that draws its own panel instead of this
  // button, so there is no state left in which the press does nothing.
  assert.match(LISTING, /\) : paused \? \(/, "a paused listing still replaces the reserve card rather than disabling it");
});

test("the stylesheet still refuses to dim this button, which is what gave the claim away", () => {
  assert.match(CSS, /\.alprimary\[aria-disabled="true"\]\{background:var\(--accent\);opacity:1;\}/);
});

test("a day with no start times left is genuinely unavailable, and says so twice", () => {
  for (const cls of ["alday", "bkday"]) {
    const day = new RegExp('className=\\{"' + cls + '"[\\s\\S]{0,600}?aria-label=\\{[^}]*not available').exec(LISTING)
      || new RegExp('"' + cls + '"[\\s\\S]{0,600}?not available').exec(LISTING);
    assert.ok(day, cls + ": expected a day button that names itself unavailable");
    assert.match(day[0], /aria-disabled=\{!(ok|open)\}/, cls + ": and carries the attribute to match");
  }
});
