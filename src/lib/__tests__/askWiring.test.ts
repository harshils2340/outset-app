import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Ask Outset is one overlay with one switch, and for a while it was two.
 *
 * `AppProvider` holds `asking` and hands out `openAsk`, and says in its own comment that it lives there "so
 * any screen (a listing, the booking sheet) can open the same overlay". `App.tsx` kept a second copy in a
 * `useState` and rendered from that one, so the listing page's "Ask Outset about <shop>" button set a string
 * nothing read: a guest clicked it and the page did not move. Read in a real Chromium, not inferred.
 *
 * A renderer would be the honest way to test this and the repo has none, so this reads the two files: the
 * state a screen writes must be the state this file renders from.
 */

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const APP = src("../../App.tsx");
const PROVIDER = src("../../state/AppProvider.tsx");
const LISTING = src("../../components/web/WebListing.tsx");
const HOME = src("../../components/web/WebHome.tsx");

test("the listing page opens the agent through the provider, not through a local flag", () => {
  assert.match(LISTING, /openAsk\s*\(/, "the listing's Ask button no longer calls openAsk");
});

test("the file that renders the overlay reads the state the provider keeps", () => {
  assert.match(APP, /state\.asking/, "App.tsx renders Ask from something other than state.asking");
  assert.match(HOME, /<WebConcierge\b/, "the desktop site embeds the agent on the home page");
  assert.match(HOME, /\bah-modes\b/, "Browse and Ask share one toggle on the desktop header");
  assert.match(APP, /asking=\{askOnSite\}/, "desktop Ask is a home-page mode, not a second tree");
  assert.match(APP, /<WebConcierge\b/, "the phone frame still renders the agent");
  /**
   * Opening the agent onto the real phone frame ("Open the phone app"'s own view) is deliberate again as of
   * this file's own session: a laptop-width chat box docked into the page does not read as the real iPhone
   * thread it is standing in for. What stays banned is the specific mechanism that made that buggy the first
   * time, a `useEffect` racing a `cameFromWeb` ref to flip `web` back to `true` again once the agent closed,
   * which is what left a dim overlay on the listings behind it. This is a one-way door instead: `web` only
   * ever goes to `false` when opening, closing the agent calls nothing but `closeAsk()`, and getting back to
   * the wide site is the same explicit "Back to the site" button "Open the phone app" already used.
   */
  assert.doesNotMatch(APP, /cameFromWeb/, "the old ref-and-effect mechanism must not come back");
  assert.doesNotMatch(APP, /closeAsk\(\);[^}]*setWeb\(true\)|setWeb\(true\)[^}]*closeAsk\(\)/, "closing the agent must not restore the wide site by itself: that bidirectional flip is what left the stale overlay behind");
  assert.doesNotMatch(
    APP,
    /useState<[^>]*>\(\s*ASKED_FOR|setAsking\s*\(/,
    "App.tsx is keeping a second copy of the agent's open state",
  );
});

test("the provider still owns the switch both sides use", () => {
  assert.match(PROVIDER, /asking:\s*string\s*\|\s*null/);
  assert.match(PROVIDER, /case "openAsk"/);
  assert.match(PROVIDER, /case "closeAsk"/);
});
