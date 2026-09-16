import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * A claimed operator's edits arrive one fetch behind the listing they belong to, and the page has to be
 * redrawn when they land.
 *
 * `loadListing` fetches two things: the listing's detail file, which is what its promise resolves on, and then
 * the operator's saved profile from `GET /profiles/:id`. The second was a detached promise that patched the
 * in-memory catalog through `setOperatorOverride` and told nobody. Nothing in React re-read the catalog, so a
 * guest who opened a claimed listing by its link, which is every shared link, every email link and every
 * search result, read the crawled record for the whole visit: the old title, the old blurb, the old prices,
 * the old hours and the old policies, with the operator's own edits sitting in memory unshown.
 *
 * Seen in a browser against the rehearsal's test listing: the server's patch said the title was "Shah and
 * Shah Services (edited by the harness)" and the page's h1 said "Shah and Shah Services", after a reload and
 * twelve seconds of waiting.
 *
 * Awaiting the profile instead would put an API round trip, up to its six second timeout, in front of every
 * listing page, so the fetch stays detached and announces itself through `onListingEdits`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const load = readFileSync(join(here, "../catalogLoad.ts"), "utf8");
const provider = readFileSync(join(here, "../../state/AppProvider.tsx"), "utf8");

test("the late profile fetch announces itself after it patches the catalog", () => {
  const block = load.slice(load.indexOf("fetchRemoteProfile("));
  const patched = block.indexOf("setOperatorOverride(");
  const told = block.indexOf("onEdits?.(");
  assert.ok(patched > -1, "loadListing no longer applies the operator's patch");
  assert.ok(told > -1, "loadListing applies the operator's patch and tells nobody, so the page is never redrawn");
  assert.ok(told > patched, "the announcement has to come after the patch, or the redraw reads the old record");
});

test("the app subscribes to it and bumps the catalog version", () => {
  assert.ok(/onListingEdits\(\(\) =>/.test(provider), "AppProvider does not subscribe to onListingEdits");
  const at = provider.indexOf("onListingEdits(() =>");
  const line = provider.slice(at, at + 200);
  assert.match(line, /catalogTouched/, "the subscription must bump catalogVersion, or nothing re-reads the catalog");
});

test("the subscription is torn down, so a remount does not leave a dead callback behind", () => {
  assert.match(provider, /return \(\) => onListingEdits\(null\)/);
});

test("the listener is a single global, so two listings in flight cannot orphan one another", () => {
  // One module-level slot rather than a list: every caller wants the same "the catalog changed" signal, and a
  // per-call registry would need its own cleanup on a fetch that never lands.
  assert.match(load, /let onEdits: \(\(\) => void\) \| null = null/);
  assert.match(load, /export function onListingEdits\(fn: \(\(\) => void\) \| null\): void/);
});
