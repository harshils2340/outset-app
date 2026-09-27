import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DEFAULT_TITLE, pageTitle } from "../site";

/**
 * What the browser tab calls an open listing.
 *
 * The app set no title at all, so every listing read "Book things to do near you · Outset": the title
 * `index.html` ships. The static `/l/` page for the same shop names the business, so the two disagreed on
 * every listing in the catalog.
 */

test("an open listing is named by its business and its place, with the state spelled out", () => {
  assert.equal(pageTitle({ title: "Alcatraz Tours", area: "San Francisco, CA" }), "Alcatraz Tours in San Francisco, California · Outset");
});

/**
 * 2,943 listings publish a state or province code with no town in front of it, because their town was never
 * read. The tab, the bookmark and the shared link for those read "in MD" and "in ON".
 */
test("a listing whose area line is a bare code names the state, not the code", () => {
  assert.equal(pageTitle({ title: "Angler Watersports", area: "MD" }), "Angler Watersports in Maryland · Outset");
  assert.equal(pageTitle({ title: "Grand River Rafting", area: "ON" }), "Grand River Rafting in Ontario · Outset");
  // A town that already names its own state is not given it twice.
  assert.equal(pageTitle({ title: "DC Sail", area: "Washington DC, DC" }), "DC Sail in Washington DC · Outset");
});

test("a listing with no place keeps its name alone", () => {
  assert.equal(pageTitle({ title: "ADK Boat Tours", area: "" }), "ADK Boat Tours · Outset");
  assert.equal(pageTitle({ title: "ADK Boat Tours" }), "ADK Boat Tours · Outset");
});

test("no listing open, and a listing the catalog has not landed yet, keep the site's own title", () => {
  assert.equal(pageTitle(null), DEFAULT_TITLE);
  assert.equal(pageTitle({ title: "   ", area: "Tampa, FL" }), DEFAULT_TITLE);
});

test("the title is the one index.html ships, so closing a listing puts back what was there", () => {
  const html = readFileSync(new URL("../../../index.html", import.meta.url), "utf8");
  const m = /<title>([^<]*)<\/title>/.exec(html);
  assert.ok(m, "index.html has no title");
  assert.equal(m![1], DEFAULT_TITLE);
});

test("the app and the static page name the same shop the same way", () => {
  // `backend/src/sync/listingPages.ts` writes the title of every /l/ page. One shop, one name. The backend's
  // own listingPages test builds a page and compares its <title> to pageTitle for real; this only catches the
  // format drifting apart in the source.
  const gen = readFileSync(new URL("../../../backend/src/sync/listingPages.ts", import.meta.url), "utf8");
  assert.ok(
    gen.includes("`${item.title}${place ? \" in \" + place : \"\"} · Outset`"),
    "the static listing page changed its title format and the app's no longer matches it",
  );
  assert.ok(gen.includes("const place = placeName(area)"), "the static page stopped spelling its place out");
});

test("the provider sets it from the state the address bar already tracks", () => {
  const src = readFileSync(new URL("../../state/AppProvider.tsx", import.meta.url), "utf8");
  assert.ok(/document\.title = pageTitle\(/.test(src), "the provider stopped naming the page");
  assert.ok(
    /\[listingOpen, state\.reqTargetId, state\.catalogVersion\]/.test(src),
    "a link opened cold arrives before the listing it names, so the catalog version has to be in the deps",
  );
});
