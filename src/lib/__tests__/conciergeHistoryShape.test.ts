import assert from "node:assert/strict";
import test from "node:test";

/**
 * The stored concierge history, and the one field its own shape check forgot.
 *
 * `isConversation` validated `id`, `startedAt` and `turns` and dropped a row that did not fit, which is what
 * its comment promises. Then `loadConversations` sorted the survivors on `lastAt`, which nothing had checked:
 * a row without a usable one makes `b.lastAt - a.lastAt` return NaN, and a comparator that returns NaN does
 * not merely misplace that row, it takes the ordering of the whole list with it. Newest first is the only
 * thing the history screen promises.
 *
 * Latent when it was found (every writer sets the field, and the key is versioned), which is exactly when a
 * reader that trusts a shape is cheapest to fix. The sibling in `operator.ts` was not latent.
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

const { loadConversations } = await import("../conciergeHistory");

const KEY = "outset.concierge.v1";

const row = (id: string, lastAt: unknown) => ({
  id,
  startedAt: 1000,
  lastAt,
  turns: [{ q: "escape room in waterloo tonight, 4 of us", at: 1000, answer: null }],
});

test("a row with no usable lastAt is dropped rather than sorted on", () => {
  for (const bad of [undefined, null, "1700000000000", {}, []]) {
    localStorage.setItem(KEY, JSON.stringify([row("a", bad)]));
    assert.deepEqual(loadConversations(), [], "lastAt of " + JSON.stringify(bad) + " should drop the row");
  }
});

test("one bad row no longer takes the ordering of the good ones with it", () => {
  localStorage.setItem(KEY, JSON.stringify([row("old", 1), row("broken", undefined), row("new", 3), row("mid", 2)]));
  assert.deepEqual(
    loadConversations().map((c) => c.id),
    ["new", "mid", "old"],
    "newest first is the only thing the history screen promises",
  );
});

test("a startedAt that is not a finite number is dropped too", () => {
  localStorage.setItem(KEY, JSON.stringify([{ ...row("a", 2), startedAt: "1000" }]));
  assert.deepEqual(loadConversations(), []);
});

test("a whole conversation still reads back when its shape is right", () => {
  localStorage.setItem(KEY, JSON.stringify([row("keep", 2)]));
  const out = loadConversations();
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "keep");
  assert.equal(out[0].turns.length, 1);
});
