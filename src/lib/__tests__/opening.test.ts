import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Where the home opens, and when it is allowed to cost anything.
 *
 * The home used to open on Anywhere for as long as it took to download the catalog, and only then find out
 * where the guest was. The place was decided inside `loadRemoteCatalog(...).then(...)` in AppProvider, so a
 * localStorage read and one header lookup, neither of which needs a single catalog record, waited on 22 MB of
 * JSON over whatever connection the guest had. A full set of rails for the whole of the United States and
 * Canada painted, re-sorted when the full file merged, and then rebuilt again around the guest's own city with
 * a new row inserted above everything. Three paints, the last of them a jump under the reader's eyes.
 *
 * So `opening()` answers from this device alone and is read during the first render, and `guessPlace()` is
 * only allowed to go and ask when this device has nothing recent. These pin both halves of that, and the last
 * test pins the arrangement in AppProvider itself, which is the part that actually regressed.
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
const reset = () => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
};
reset();

const { opening, rememberMetro, rememberPlace, sameGuess } = await import("../here");
const { ALL_METRO_ID } = await import("../../data/metros");

const GUESS_KEY = "outset.guess.v1";
const HOUR = 60 * 60 * 1000;
const storeGuess = (guess: unknown, ageMs: number) => localStorage.setItem(GUESS_KEY, JSON.stringify({ at: Date.now() - ageMs, guess }));

/** The time zone the machine running the tests happens to be in must not decide what they assert. */
const zoned = <T,>(zone: string, run: () => T): T => {
  const real = Intl.DateTimeFormat;
  (Intl as unknown as { DateTimeFormat: unknown }).DateTimeFormat = function () {
    return { resolvedOptions: () => ({ timeZone: zone }) };
  };
  try {
    return run();
  } finally {
    Intl.DateTimeFormat = real;
  }
};

test("a place the guest chose opens the home and is never checked against anything", () => {
  reset();
  rememberPlace({ label: "Kelowna", sub: "British Columbia", lat: 49.888, lon: -119.496 });
  const o = zoned("America/New_York", opening);
  assert.deepEqual(o.guess, { kind: "point", place: { label: "Kelowna", sub: "British Columbia", lat: 49.888, lon: -119.496, region: undefined } });
  assert.equal(o.chosen, true, "their own decision");
  assert.equal(o.recheck, false, "so there is nothing to ask the API about");
});

test("a city the guest chose comes back on the next visit", () => {
  // It did not. `setMetro` cleared the remembered point and stored nothing in its place, so a guest who
  // deliberately picked Denver was guessed back into wherever their address resolves on every later visit.
  reset();
  rememberMetro("denver");
  const o = zoned("America/Toronto", opening);
  assert.deepEqual(o.guess, { kind: "metro", metroId: "denver" });
  assert.equal(o.chosen, true);
  assert.equal(o.recheck, false);
});

test("choosing Anywhere is a choice too, and a guess does not undo it", () => {
  reset();
  rememberMetro(ALL_METRO_ID);
  const o = zoned("America/Toronto", opening);
  assert.equal(o.guess, null, "Anywhere is the whole catalog, which is no place at all");
  assert.equal(o.chosen, true);
  assert.equal(o.recheck, false);
});

test("a guess from this morning opens the home with no fetch and no second render", () => {
  reset();
  storeGuess({ kind: "point", place: { label: "Tampa", sub: "FL", lat: 27.95, lon: -82.46 } }, 2 * HOUR);
  const o = zoned("America/Toronto", opening);
  assert.equal(o.guess?.kind, "point");
  assert.equal(o.chosen, false, "a guess, so an arriving refinement may still replace it");
  assert.equal(o.recheck, false, "but nothing is asked: the answer here is hours old, not days");
});

test("a guess from yesterday is still shown at once, and checked in the background", () => {
  reset();
  storeGuess({ kind: "metro", metroId: "tampa" }, 20 * HOUR);
  const o = zoned("America/Toronto", opening);
  assert.deepEqual(o.guess, { kind: "metro", metroId: "tampa" }, "the page never waits to show something");
  assert.equal(o.recheck, true, "the guest may have flown somewhere since");
});

test("a guess from last summer is not shown at all", () => {
  reset();
  storeGuess({ kind: "metro", metroId: "tampa" }, 90 * 24 * HOUR);
  assert.deepEqual(zoned("America/Toronto", opening).guess, { kind: "metro", metroId: "toronto" }, "the clock is a better answer than a stale address");
});

test("a stored guess naming a metro that is not a metro is refused", () => {
  // The home filters its rails on `u.metroId === state.metroId` and prints the id as typed, so anything that
  // is not one of the metros is an empty page under a lowercase heading. here.test.ts pins the same rule for
  // the time zone table; storage is the other way a bad id can get in, and devtools is one edit away.
  reset();
  storeGuess({ kind: "metro", metroId: "winnipeg" }, HOUR);
  assert.deepEqual(zoned("America/Toronto", opening).guess, { kind: "metro", metroId: "toronto" });
});

test("nothing stored at all falls back to the clock, which costs nothing either", () => {
  reset();
  const o = zoned("America/Vancouver", opening);
  assert.deepEqual(o.guess, { kind: "metro", metroId: "vancouver" });
  assert.equal(o.chosen, false);
  assert.equal(o.recheck, true, "a region is not a city, so this one is worth sharpening");
});

test("a time zone we list no metro in opens Anywhere rather than nowhere", () => {
  reset();
  const o = zoned("America/Winnipeg", opening);
  assert.equal(o.guess, null);
  assert.equal(o.recheck, true);
});

test("a recheck that agrees changes nothing, so a repeat visit is one render", () => {
  const tampa = { kind: "point" as const, place: { label: "Tampa", sub: "FL", lat: 27.95, lon: -82.46 } };
  // Cloudflare moves a city's centroid by a few hundred metres between reads. That is not the guest moving,
  // and dispatching it would rebuild every rail on the home to draw the same cards in the same order.
  assert.equal(sameGuess(tampa, { kind: "point", place: { ...tampa.place, lat: 27.954, lon: -82.464 } }), true);
  assert.equal(sameGuess(tampa, { kind: "point", place: { label: "Orlando", sub: "FL", lat: 28.54, lon: -81.38 } }), false);
  assert.equal(sameGuess({ kind: "metro", metroId: "tampa" }, { kind: "metro", metroId: "tampa" }), true);
  assert.equal(sameGuess({ kind: "metro", metroId: "tampa" }, tampa), false, "a city is sharper than a region and replaces it");
  assert.equal(sameGuess(null, null), true, "Anywhere agreeing with Anywhere");
  assert.equal(sameGuess(null, tampa), false);
});

test("the home decides where it is before the catalog lands, not after", () => {
  // The bug this file exists for, pinned where it happened. `guessPlace` and `opening` must not be reachable
  // from inside the catalog download's `.then()`: nothing about knowing the guest's city needs a catalog, and
  // putting it back there returns the home to painting Anywhere for the length of a 22 MB download.
  const src = readFileSync(new URL("../../state/AppProvider.tsx", import.meta.url), "utf8");
  const load = src.indexOf("loadRemoteCatalog(");
  assert.ok(load > 0, "AppProvider still loads the catalog; this guard needs rewriting if it does not");
  const seeded = src.indexOf("opening()");
  assert.ok(seeded > 0 && seeded < load, "opening() is read for the first render, above the catalog load");
  const asked = src.indexOf("guessPlace()");
  assert.ok(asked > 0 && asked < load, "and the refinement is its own effect, not a step of the download");
});
