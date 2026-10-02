import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * The list of businesses claimed in this browser, and what one corrupt copy of it used to cost.
 *
 * `outset.operator.index.v1` is an array of listing ids. `claimedIds` read it straight out of `JSON.parse`
 * and trusted the shape, so a value left by an older build or hand-edited in devtools came back as whatever
 * it was. An object or a number made `for (const id of claimedIds())` throw, and the caller that does that is
 * `applyStoredProfiles`, which runs once on every boot inside the catalog promise in `AppProvider`.
 *
 * That throw landed in the boot chain's `.catch()`, which tells the app the catalog is in and nothing else.
 * Two things were left behind it: `booted.current` stayed false for the rest of the session, which is the
 * flag the three effects that own the address bar and the history stack all return early on, so opening a
 * listing never wrote `#o=` to the bar (share and refresh landed on the home page) and no sheet got its own
 * history entry (one back gesture on a phone left the site from an open listing); and the `hashchange`
 * listener was registered at the end of that same chain, so a shared listing link opened in a tab that
 * already had Outset in it did nothing at all.
 *
 * Both halves are closed: the index checks its own shape here, and `AppProvider` no longer hangs the URL
 * layer off a promise that can reject.
 */

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

const { applyStoredProfiles, claimedIds, deleteProfile } = await import("../operator");

const INDEX_KEY = "outset.operator.index.v1";

/** Every shape `JSON.parse` can hand back that is not an array of ids. */
const CORRUPT = ['{"o-one":true}', "42", "true", '"o-one"', '"not an id"', "null", "{}"];

test("a corrupt index reads as no claims rather than as whatever it parsed to", () => {
  for (const raw of CORRUPT) {
    localStorage.setItem(INDEX_KEY, raw);
    assert.deepEqual(claimedIds(), [], "index " + raw + " should read as no claims");
  }
  localStorage.setItem(INDEX_KEY, "{not json");
  assert.deepEqual(claimedIds(), []);
  localStorage.removeItem(INDEX_KEY);
  assert.deepEqual(claimedIds(), []);
});

test("a bare string in the index is not iterated for its characters", () => {
  // `for (const id of "o-one")` used to look for five businesses called "o", "-", "n" and "e".
  localStorage.setItem(INDEX_KEY, '"o-one"');
  assert.deepEqual(claimedIds(), []);
});

test("the junk rows of a half-good index are dropped and the real ids kept", () => {
  localStorage.setItem(INDEX_KEY, JSON.stringify(["o-one", 7, null, "", { id: "o-two" }, "o-three", false]));
  assert.deepEqual(claimedIds(), ["o-one", "o-three"]);
});

test("the boot pass over stored profiles does not throw on any corrupt index", () => {
  for (const raw of CORRUPT) {
    localStorage.setItem(INDEX_KEY, raw);
    assert.equal(applyStoredProfiles({ remote: false }), 0, "index " + raw + " should apply no profiles");
  }
});

test("releasing a business does not throw on a corrupt index either", () => {
  // `deleteProfile` filtered the raw value, so an object index threw "filter is not a function" out of the
  // Settings page's Release button, and `saveProfile` threw out of `new Set(...)` on every dashboard save.
  for (const raw of CORRUPT) {
    localStorage.setItem(INDEX_KEY, raw);
    assert.doesNotThrow(() => deleteProfile("o-one"));
    assert.deepEqual(claimedIds(), []);
  }
});

/**
 * The AppProvider half, read the way `listingLink.test.ts` reads it: this suite cannot mount the provider,
 * and the rule above is worth nothing if the URL layer goes back to hanging off a promise that can reject.
 */
const SRC = readFileSync(new URL("../../state/AppProvider.tsx", import.meta.url), "utf8");

test("the boot flag is set whichever way the boot ended", () => {
  const at = SRC.indexOf("booted.current = true");
  assert.ok(at > 0, "AppProvider no longer sets booted; this guard needs rewriting");
  assert.equal(SRC.indexOf("booted.current = true", at + 1), -1, "booted should be set in one place");
  // The `.finally()` it sits in, not the `.then()` the catalog work sits in.
  const chain = SRC.slice(SRC.lastIndexOf(".finally(() => {", at), at);
  assert.ok(chain.length > 0 && !chain.includes("}).then("), "booted must be set in the boot chain's .finally()");
});

test("the listing-link listener is its own effect, with its own cleanup", () => {
  const at = SRC.indexOf('window.addEventListener("hashchange"');
  assert.ok(at > 0, "AppProvider no longer listens for hashchange");
  // Registered after the boot effect closes, not inside the catalog promise that can reject.
  assert.ok(at > SRC.indexOf("booted.current = true"), "hashchange must not be registered inside the boot chain");
  const body = SRC.slice(at, at + 400);
  assert.match(body, /removeEventListener\("hashchange", onHash\)/, "the listener has to be removed on cleanup");
});

/**
 * The same link, pasted into a tab that already has Outset open.
 *
 * A fresh tab has always fetched the listing's own 3 kB detail file before it asks for the catalog, so a
 * shared link paints the listing rather than the home. The mid-session handler asked `experienceById` and
 * gave up, and for the first seconds of a visit that is almost all of Outset: the lite shard carries 2,256
 * of the 52,816 shipped records and the full catalog behind it is 24 MB.
 */

test("a link to a listing the catalog does not hold yet is fetched, not dropped", () => {
  const at = SRC.indexOf("const onHash = (e: HashChangeEvent) => {");
  assert.ok(at > 0, "AppProvider no longer defines onHash; this guard needs rewriting");
  const body = SRC.slice(at, SRC.indexOf('window.addEventListener("hashchange"', at));
  assert.doesNotMatch(body, /if \(!id \|\| !experienceById\(id\)\) return;/, "an unknown listing is being dropped again");
  const miss = body.indexOf("loadListing(id).then((ok)");
  assert.ok(miss > 0, "the unknown-listing branch no longer asks for the listing's own file");
  // Which ask is live is kept in a ref: the back-button handler can have stripped the bar by the time this lands.
  assert.match(body.slice(miss), /hashWant\.current !== id/, "a second link pasted over the first no longer wins");
});

test("a link to a listing that is genuinely gone gets the same sentence the boot path gives it", () => {
  const at = SRC.indexOf("const onHash = (e: HashChangeEvent) => {");
  const body = SRC.slice(at, SRC.indexOf('window.addEventListener("hashchange"', at));
  assert.match(body, /type: "toast", text: "That listing is no longer on Outset\."/, "a dead link mid-session says nothing again");
  // The boot path's own wording, so the two cannot drift apart.
  const boot = SRC.slice(0, at);
  assert.ok(boot.includes('"That listing is no longer on Outset."'), "the boot path's wording changed; keep the two in step");
});
