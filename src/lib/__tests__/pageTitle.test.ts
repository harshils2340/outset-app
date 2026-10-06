import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DEFAULT_TITLE, dashboardTitle, pageTitle } from "../site";

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
    /\[listingOpen, state\.reqTargetId, state\.screen, state\.operatorId, state\.catalogVersion\]/.test(src),
    "a link opened cold arrives before the listing it names, so the catalog version has to be in the deps, and the screen and the shop decide which name is used",
  );
});

/**
 * The operator dashboard, which `pageTitle` never had a name for.
 *
 * `/operators` read "Book things to do near you · Outset" on every screen of the dashboard: the owner's own
 * tab, bookmark and history entry were the guest marketplace's, and their listing tab and their dashboard tab
 * were two entries with one name.
 */
test("the dashboard is named for the shop it is open on", () => {
  assert.equal(dashboardTitle({ title: "Alcatraz Tours" }), "Alcatraz Tours dashboard · Outset");
  assert.equal(dashboardTitle({ title: "  Grand River Rafting  " }), "Grand River Rafting dashboard · Outset");
});

test("a dashboard with no shop yet, or one the catalog has not landed, is still not the guest marketplace", () => {
  for (const t of [dashboardTitle(null), dashboardTitle({}), dashboardTitle({ title: "   " })]) {
    assert.equal(t, "Operator dashboard · Outset");
    assert.notEqual(t, DEFAULT_TITLE);
  }
});

test("the dashboard title cannot be mistaken for the listing's own", () => {
  // Both tabs name the same business, so the word that tells them apart has to be there.
  assert.notEqual(dashboardTitle({ title: "Alcatraz Tours" }), pageTitle({ title: "Alcatraz Tours", area: "" }));
});

test("the provider leaves the metrics page to name itself", () => {
  // `/admin` renders AdminView alone, which sets "Outset metrics" once on mount. The provider wraps it either
  // way, so without this guard the catalog landing a moment later renamed the page to the guest home's title.
  const src = readFileSync(new URL("../../state/AppProvider.tsx", import.meta.url), "utf8");
  assert.ok(/if \(atAdminPath\(\)\) return;/.test(src), "the provider renames the metrics page over AdminView");
  const view = readFileSync(new URL("../../components/admin/AdminView.tsx", import.meta.url), "utf8");
  assert.ok(view.includes('document.title = "Outset metrics"'), "AdminView stopped naming itself");
});

test("the dashboard is named on the operator screen and nowhere else", () => {
  const src = readFileSync(new URL("../../state/AppProvider.tsx", import.meta.url), "utf8");
  assert.ok(
    /if \(state\.screen === "operator"\) \{\s*\n\s*document\.title = dashboardTitle\(experienceById\(state\.operatorId\)\);/.test(src),
    "the dashboard title is no longer taken from the shop the dashboard is open on",
  );
});
