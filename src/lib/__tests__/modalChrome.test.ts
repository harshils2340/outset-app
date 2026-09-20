import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { tabWrap } from "../dialog";

/**
 * Every dialog on the desktop site said `aria-modal="true"` and none of them behaved like one: Tab walked out
 * into the page under the scrim (on the listing's "Show more", the very first Tab did, because its Close button
 * is the last thing in the document), a wheel scrolled the listing behind the full-screen photo lightbox, and
 * the lightbox never moved focus into itself at all. The ring is arithmetic and is tested as such; the rest is
 * one hook, and these read the five call sites so a dialog cannot quietly go back to doing it by hand.
 */

const HOOK = readFileSync(new URL("../../components/layout/useModal.ts", import.meta.url), "utf8");
const LISTING = readFileSync(new URL("../../components/web/WebListing.tsx", import.meta.url), "utf8");
const HOME = readFileSync(new URL("../../components/web/WebHome.tsx", import.meta.url), "utf8");
const DRAWER = readFileSync(new URL("../../components/operator/OpBookings.tsx", import.meta.url), "utf8");
const CONCIERGE = readFileSync(new URL("../../components/web/WebConcierge.tsx", import.meta.url), "utf8");

test("Tab off the last stop comes back to the first", () => {
  assert.equal(tabWrap(4, 3, false), 0);
  assert.equal(tabWrap(4, 1, false), null, "and anywhere else the browser's own order is kept");
});

test("Shift+Tab off the first stop goes to the last", () => {
  assert.equal(tabWrap(4, 0, true), 3);
  assert.equal(tabWrap(4, 2, true), null);
});

test("focus that has left the dialog is put back at the near end", () => {
  assert.equal(tabWrap(4, -1, false), 0);
  assert.equal(tabWrap(4, -1, true), 3);
});

test("a dialog with one stop keeps it", () => {
  // The listing's "Show more" is a Close button over a paragraph. Both ways round land on Close again.
  assert.equal(tabWrap(1, 0, false), 0);
  assert.equal(tabWrap(1, 0, true), 0);
});

test("a dialog with nothing to focus is left alone", () => {
  assert.equal(tabWrap(0, -1, false), null);
  assert.equal(tabWrap(0, -1, true), null);
});

test("the page behind is locked on the root, not only on body", () => {
  // app.css clips html's overflow-x, so the viewport scrolls by html's overflow values and body's `hidden`
  // alone locks nothing: a wheel over the lightbox rolled the listing 1,600 px underneath it.
  assert.match(HOOK, /root\.style\.overflow = "hidden"/);
  assert.match(HOOK, /root\.style\.overflow = prev\.root/);
  assert.match(HOOK, /document\.body\.style\.overflow = prev\.body/);
});

test("focus goes in, and comes back to whatever opened the dialog", () => {
  assert.match(HOOK, /!node\.contains\(document\.activeElement\)/, "and a dialog that autofocuses its own field keeps it");
  assert.match(HOOK, /if \(opener && document\.contains\(opener\)\) opener\.focus\(\)/);
});

test("the stops are counted by their rects, not by offsetParent", () => {
  // Everything inside a fixed scrim has a null offsetParent, which would have emptied the lightbox's ring.
  assert.match(HOOK, /getClientRects\(\)\.length > 0/);
});

test("no dialog on the desktop site locks the page by hand any more", () => {
  for (const [name, src] of [["WebListing", LISTING], ["WebHome", HOME]] as const) {
    assert.doesNotMatch(src, /body\.style\.overflow/, name + " should lock the page through useModal");
  }
});

test("the listing's photo lightbox is a modal and says so", () => {
  assert.match(LISTING, /className="algallery" ref=\{galleryBox\}[\s\S]*?role="dialog" aria-modal="true" aria-label="Photos"/);
  assert.match(LISTING, /useModal\(galleryBox, gallery != null\)/);
});

test("the listing's Show more modal holds its own focus", () => {
  assert.match(LISTING, /className=\{"almodalbox"[^}]*\} ref=\{box\}/);
  assert.match(LISTING, /useModal\(box\);/);
});

test("all three of the home's dialogs use it", () => {
  assert.match(HOME, /className="ah-modal wide" ref=\{box\}/, "Compare");
  assert.match(HOME, /className="ah-modal" ref=\{box\}/, "Filters");
  assert.match(HOME, /className="ah-modal ah-refine" ref=\{refineBox\}/, "Where, when and who");
  assert.match(HOME, /useModal\(refineBox, !!refine\)/);
  assert.equal(HOME.match(/useModal\(/g)?.length, 3);
});

test("the operator's booking drawer is the same kind of dialog", () => {
  assert.match(DRAWER, /className="oddrawer" ref=\{box\} role="dialog" aria-modal="true"/);
  assert.match(DRAWER, /useModal\(box\);/);
});

test("the concierge overlay is a dialog too, and holds the page behind it still", () => {
  // It shipped claiming aria-modal and behaving like nothing of the kind: driven in Chromium, 23 of 24 Tab
  // stops walked out into the home underneath the scrim, a wheel rolled that home 900 px, and closing left
  // focus on the body rather than on the button that opened it.
  // Whitespace-tolerant: the overlay's opening tag is written over several lines, and which line an attribute
  // sits on is not what this is checking.
  assert.match(CONCIERGE, /role=\{embed \? "region" : "dialog"\}/);
  assert.match(CONCIERGE, /aria-modal=\{embed \? undefined : "true"\}/);
  assert.match(CONCIERGE, /useModal\(box, !embed\)/);
  // Before the effect that focuses the field, or the hook reads that field as the opener and has nowhere to
  // put focus back.
  assert.ok(
    CONCIERGE.indexOf("useModal(box, !embed)") < CONCIERGE.indexOf("inputRef.current?.focus();"),
    "useModal has to be declared before the box focuses its own field",
  );
});

test("every dialog claiming aria-modal on the site uses the hook", () => {
  // The count is the point: a new surface that says aria-modal and does it by hand fails here.
  for (const [name, src] of [
    ["WebListing", LISTING],
    ["WebHome", HOME],
    ["OpBookings", DRAWER],
    ["WebConcierge", CONCIERGE],
  ] as const) {
    const claims = src.match(/aria-modal="true"/g)?.length ?? 0;
    if (!claims) continue;
    assert.match(src, /useModal\(/, name + " claims aria-modal, so it owes the page behind it the hook");
  }
});

test("the two dialogs that autofocused their close button leave it to the hook", () => {
  // Two ways of moving focus in, one of which fires before the hook can see it, is how a dialog ends up
  // arguing with itself about where focus belongs.
  assert.doesNotMatch(HOME, /aria-label="Close" onClick=\{onClose\} autoFocus/);
});
