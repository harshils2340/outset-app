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

test("an open listing is named by its business and its place", () => {
  assert.equal(pageTitle({ title: "Alcatraz Tours", area: "San Francisco, CA" }), "Alcatraz Tours in San Francisco, CA · Outset");
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
  // `backend/src/sync/listingPages.ts` writes the title of every /l/ page. One shop, one name.
  const gen = readFileSync(new URL("../../../backend/src/sync/listingPages.ts", import.meta.url), "utf8");
  assert.ok(
    gen.includes("`${item.title}${area ? \" in \" + area : \"\"} · Outset`"),
    "the static listing page changed its title format and the app's no longer matches it",
  );
});

test("the provider sets it from the state the address bar already tracks", () => {
  const src = readFileSync(new URL("../../state/AppProvider.tsx", import.meta.url), "utf8");
  assert.ok(/document\.title = pageTitle\(/.test(src), "the provider stopped naming the page");
  assert.ok(
    /\[listingOpen, state\.reqTargetId, state\.catalogVersion\]/.test(src),
    "a link opened cold arrives before the listing it names, so the catalog version has to be in the deps",
  );
});
