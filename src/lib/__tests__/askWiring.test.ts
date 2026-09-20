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

test("the listing page opens the agent through the provider, not through a local flag", () => {
  assert.match(LISTING, /openAsk\s*\(/, "the listing's Ask button no longer calls openAsk");
});

test("the file that renders the overlay reads the state the provider keeps", () => {
  assert.match(APP, /<WebConcierge\b/, "App.tsx is the only place that renders the concierge");
  assert.match(APP, /state\.asking/, "App.tsx renders the overlay from something other than state.asking");
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
