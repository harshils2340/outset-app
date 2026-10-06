import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * The desktop listing page opens another listing in place, so it must not keep the first one's state.
 *
 * The rail at the bottom of the page ("More places like this") renders a `Card` per listing and calls the
 * page's own `onOpen`, which swaps `item` under the same mounted component. Every piece of state in it that
 * belongs to one listing then carried over to the next: measured in a real Chromium at 1440px, saving the
 * 9/11 Memorial and then opening Mercer Labs from its rail left the heart reading "Saved" on a listing
 * nobody had saved, and the one press a guest makes to save it said "Removed from saved" and saved nothing.
 * The same instance also carried the ticked add-ons, which are indexes into the previous shop's menu, and
 * the open-slot map the API answered for the previous shop, which decides the start times this one offers.
 *
 * A renderer would be the honest way to test this and the repo has none, so this reads the files: the page
 * is keyed by the listing, the way the phone sheet has always keyed its own, and the state below is seeded
 * at mount, which is what makes the key the thing that resets it.
 *
 * The heart has since stopped being one of those: it is read from `explore/prefs`, the one store that owns
 * the wishlist, rather than seeded from `localStorage` at mount, because this page writing that key itself
 * made two writers for it (see `secondTab.test.ts`). So it cannot go stale across a hop with or without the
 * key, and what the key still resets is the two below it.
 */

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const APP = src("../../App.tsx");
const LISTING = src("../../components/web/WebListing.tsx");
const SHEETS = src("../../components/booking/Sheets.tsx");

test("the desktop listing page is keyed by the listing it is about", () => {
  const tag = APP.match(/<WebListing\b[\s\S]*?\/>/);
  assert.ok(tag, "App.tsx no longer renders WebListing");
  assert.match(tag[0], /key=\{reqTarget\.id\}/, "without a key React keeps one instance across a hop in the rail");
});

test("the phone sheet keys its own listing body the same way", () => {
  const tag = SHEETS.match(/<RequestBody\b[\s\S]*?\/>/);
  assert.ok(tag, "the phone sheet no longer renders RequestBody");
  assert.match(tag[0], /key=\{reqTarget\.id\}/, "the two surfaces must agree about this");
});

test("the rail really does open another listing in place, which is why the key matters", () => {
  assert.match(LISTING, /onOpen:\s*\(id: string\)\s*=>\s*void/, "the page no longer takes an onOpen");
  assert.match(LISTING, /<Card\b[\s\S]*?onOpen=\{onOpen\}/, "the rail no longer hands the rail cards the page's own onOpen");
});

test("the heart is read from the wishlist store, so a hop cannot carry the last listing's", () => {
  assert.match(LISTING, /const saved = usePrefs\(\)\.saved\.includes\(item\.id\)/, "the heart is mount-seeded state again, which a hop carries over");
});

test("the state a hop used to carry is seeded at mount, so only a remount clears it", () => {
  assert.match(LISTING, /const \[addonIdx, setAddonIdx\] = useState<number\[\]>\(\[\]\)/, "ticked add-ons are indexes into this listing's own menu");
  assert.match(LISTING, /const \[openMap, setOpenMap\] = useState<Map<string, string\[\]> \| null>\(null\)/, "the open-slot map is one shop's answer");
  // The fetch only ever writes a map it was given: an answer of "nothing known" leaves whatever is there.
  assert.match(LISTING, /if \(!alive \|\| !r\.known\) return;/, "so a listing the API knows nothing about would keep the previous shop's times");
});
