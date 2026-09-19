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

test("the two dialogs that autofocused their close button leave it to the hook", () => {
  // Two ways of moving focus in, one of which fires before the hook can see it, is how a dialog ends up
  // arguing with itself about where focus belongs.
  assert.doesNotMatch(HOME, /aria-label="Close" onClick=\{onClose\} autoFocus/);
});
