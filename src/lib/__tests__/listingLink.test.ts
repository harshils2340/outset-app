import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { hashOpensAnotherListing, listingInHash } from "../hashRoute";

/**
 * A listing link that arrives while a listing or a chat is already open.
 *
 * `#o=<id>` is what the Share button on every listing writes and what an outreach email carries. Chrome
 * queues `popstate` BEFORE `hashchange` for a fragment navigation, which means the app's back-button handler
 * sees that link first. It used to close the open sheet on it, and closing the sheet made the address-bar
 * effect strip the hash, so the `hashchange` that followed a millisecond later read an empty hash and did
 * nothing at all: a guest who opened a second listing link in the tab they already had Outset in landed on
 * the home page with an empty address bar and no idea why. Pressing back between two listings did the same.
 *
 * The thing that tells the two apart is which listing the hash names. Back out of a listing lands either on
 * a URL with no hash or on the app's own second entry for the very same listing; a hash naming some other
 * listing can only have come from a link.
 */

const known = (id: string) => ["o-one", "o-two"].includes(id);

test("the id comes off a bare hash or a whole URL", () => {
  assert.equal(listingInHash("#o=o-one"), "o-one");
  assert.equal(listingInHash("https://outset.app/#o=o-two"), "o-two");
  assert.equal(listingInHash("https://outset.app/"), null);
  assert.equal(listingInHash("#claim=o-one&k=v2.abc.def"), null);
  assert.equal(listingInHash("#paid=ABC123&o=o-one"), null);
  assert.equal(listingInHash(""), null);
});

test("a link to another listing is not the back button", () => {
  assert.equal(hashOpensAnotherListing("#o=o-two", "o-one", known), true);
  assert.equal(hashOpensAnotherListing("https://outset.app/#o=o-two", "o-one", known), true);
});

test("backing out of a listing still reads as back", () => {
  // Back to the home: the entry below the listing carries no hash.
  assert.equal(hashOpensAnotherListing("", "o-one", known), false);
  // The app pushes a second entry for the listing it opens, so back can land on the same id.
  assert.equal(hashOpensAnotherListing("#o=o-one", "o-one", known), false);
  // Nothing open at all: there is no sheet to keep, and the ops branch below must still run.
  assert.equal(hashOpensAnotherListing("#o=o-one", null, known), true);
});

test("a hash naming a listing we do not hold is not a link to anywhere", () => {
  assert.equal(hashOpensAnotherListing("#o=o-never-synced", "o-one", known), false);
  assert.equal(hashOpensAnotherListing("#claim=o-two", "o-one", known), false);
});

/**
 * Both halves of the fix live in AppProvider, which this suite cannot mount, so they are read the way
 * `locatingSettles.test.ts` reads the locate run: the rule above is worth nothing if the handler stops
 * calling it, or if `hashchange` goes back to reading a global another handler can rewrite first.
 */
const SRC = readFileSync(new URL("../../state/AppProvider.tsx", import.meta.url), "utf8");

test("the back-button handler asks before it closes an open sheet", () => {
  const at = SRC.indexOf("const onPop = () => {");
  assert.ok(at > 0, "AppProvider no longer defines onPop; this guard needs rewriting");
  const body = SRC.slice(at, SRC.indexOf('window.addEventListener("popstate"', at));
  assert.match(body, /hashOpensAnotherListing\(window\.location\.hash, stateRef\.current\.reqTargetId/, "onPop must let a link to another listing through");
  const guard = body.indexOf("hashOpensAnotherListing");
  const close = body.indexOf('dispatch({ type: "closeSheet" })');
  assert.ok(guard > 0 && close > guard, "the question has to be asked before the sheet is closed");
});

test("hashchange reads the URL the event carries, not the one in the bar", () => {
  const at = SRC.indexOf('window.addEventListener("hashchange"');
  assert.ok(at > 0, "AppProvider no longer listens for hashchange");
  const body = SRC.slice(at, at + 900);
  assert.match(body, /listingInHash\(e\.newURL/, "the listing id must come off the event's own new URL");
});
