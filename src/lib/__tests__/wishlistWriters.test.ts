import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The wishlist, which had two writers in one tab.
 *
 * `outset.saved` is one list of ids and two pieces of code wrote it. `explore/prefs` holds it in memory, read
 * once at module load, and writes all of it on every change; the desktop listing page read the key back and
 * wrote it itself. Both run in the same tab, because the phone frame opens over the desktop site and the
 * Wishlists tab lives in that frame. So a place hearted on the desktop page never reached the tab that lists
 * saves, and the next heart tapped in the frame wrote the store's stale copy straight over it. The desktop
 * page also appended, where the tab promises newest first, so a save that did survive went to the bottom.
 *
 * Two tabs had the same problem for the three picks this store keeps, so it reads them back when another tab
 * writes one, the way `secondTab.test.ts` has the guest's trips and threads do.
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

type Handler = (e: { key: string | null; newValue: string | null }) => void;
const listeners: Handler[] = [];
(globalThis as unknown as { window: unknown }).window = {
  addEventListener: (type: string, fn: Handler) => {
    if (type === "storage") listeners.push(fn);
  },
  removeEventListener: () => {},
};

const prefs = await import("../../components/explore/prefs");

const here = dirname(fileURLToPath(import.meta.url));
const webListing = readFileSync(join(here, "../../components/web/WebListing.tsx"), "utf8");

test("the desktop listing page hearts through the store, not through the key", () => {
  assert.ok(!/outset\.saved/.test(webListing.replace(/\/\*[\s\S]*?\*\//g, "")), "the page writes the wishlist key itself again, so the store's copy goes stale");
  assert.match(webListing, /toggleSaved\(item\.id\)/, "the heart must go through the one store that owns the list");
  assert.match(webListing, /usePrefs\(\)\.saved\.includes\(item\.id\)/, "the heart has to read the store, or it shows a save another surface undid");
});

test("a save made anywhere is newest first, which is the order the Wishlists tab promises", () => {
  prefs.setPrefs({ saved: [] });
  prefs.toggleSaved("o-first");
  prefs.toggleSaved("o-second");
  assert.deepEqual(prefs.getPrefs().saved, ["o-second", "o-first"]);
});

test("the store reads the wishlist back when another tab changes it", () => {
  prefs.setPrefs({ saved: ["o-one"] });
  // The other tab hearts something else and writes all of its own list.
  localStorage.setItem("outset.saved", JSON.stringify(["o-two", "o-one"]));
  assert.deepEqual(prefs.getPrefs().saved, ["o-one"], "a storage event only reaches other tabs, so nothing has happened here yet");
  listeners.forEach((f) => f({ key: "outset.saved", newValue: localStorage.getItem("outset.saved") }));
  assert.deepEqual(prefs.getPrefs().saved, ["o-two", "o-one"], "this tab still holds its own stale list");
  // And the next heart here builds on that list instead of writing over it.
  prefs.toggleSaved("o-three");
  assert.deepEqual(JSON.parse(localStorage.getItem("outset.saved")!), ["o-three", "o-two", "o-one"]);
});

test("a pick another tab made is read back too, not only the list", () => {
  prefs.setPrefs({ who: 2, when: "2026-10-10" });
  localStorage.setItem("outset.who", "6");
  localStorage.setItem("outset.when", JSON.stringify("2026-11-01"));
  listeners.forEach((f) => f({ key: "outset.who", newValue: "6" }));
  assert.equal(prefs.getPrefs().who, 6);
  assert.equal(prefs.getPrefs().when, "2026-11-01");
});
