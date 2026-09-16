import assert from "node:assert/strict";
import test from "node:test";

/**
 * Node has no localStorage global, so this stands in a minimal in-memory one before importing
 * storage.ts: a stale value from an older build, or one hand-edited in devtools, used to reach
 * `.trim()`, `.filter()` or `.includes()` straight off `JSON.parse`, which crashed the first
 * screen that touched it rather than just dropping the one bad row.
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

const { loadBookings, loadChats, loadGuest, saveBookings, saveChats } = await import("../storage");

function reset() {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
}

test("loadBookings drops a row missing a required field rather than crashing on it", () => {
  reset();
  localStorage.setItem(
    "outset.bookings.v2",
    JSON.stringify([
      { listing: "u1", date: "2026-09-20", slot: "10:00", qty: 2, addons: [], total: 90, code: "ABC123", created: 1 },
      { listing: "u2", date: "2026-09-20", slot: "10:00", qty: "two", addons: [], total: 90, code: "XYZ999", created: 1 }, // qty not a number
      { listing: "u3" }, // missing everything else
      "not even an object",
    ]),
  );
  const out = loadBookings();
  assert.equal(out.length, 1);
  assert.equal(out[0].code, "ABC123");
});

test("loadBookings tolerates a corrupted value instead of throwing", () => {
  reset();
  localStorage.setItem("outset.bookings.v2", "{not json");
  assert.deepEqual(loadBookings(), []);
  reset();
  localStorage.setItem("outset.bookings.v2", JSON.stringify({ not: "an array" }));
  assert.deepEqual(loadBookings(), []);
});

test("a round trip through saveBookings keeps every valid booking", () => {
  reset();
  const b = { listing: "u1", date: "2026-09-20", slot: "10:00", qty: 1, addons: ["Dry bag"], total: 50, code: "ABC123", created: 1 };
  saveBookings([b]);
  assert.deepEqual(loadBookings(), [b]);
});

test("loadChats drops a malformed message and a malformed thread, keeps the rest", () => {
  reset();
  localStorage.setItem(
    "outset.chats.v2",
    JSON.stringify({
      "u1": [{ who: "me", t: "hi", at: "2026-09-20T10:00:00Z" }, { who: "nobody", t: "bad role" }, { who: "them" }],
      "u2": "not an array",
    }),
  );
  const out = loadChats();
  assert.equal(out.u1.length, 1);
  assert.equal(out.u1[0].t, "hi");
  assert.equal(out.u2, undefined);
});

test("loadGuest keeps only the string fields, dropping a field of the wrong type instead of handing it to .trim()", () => {
  reset();
  localStorage.setItem("outset.guest", JSON.stringify({ name: 12345, phone: "555-0100", email: { nested: true } }));
  const g = loadGuest();
  assert.equal(g.name, undefined);
  assert.equal(g.phone, "555-0100");
  assert.equal(g.email, undefined);
});

test("loadGuest and loadChats tolerate a top-level array or primitive instead of an object", () => {
  reset();
  localStorage.setItem("outset.guest", "[1,2,3]");
  assert.deepEqual(loadGuest(), {});
  reset();
  localStorage.setItem("outset.chats.v2", "42");
  assert.deepEqual(loadChats(), {});
});

test("a round trip through saveChats keeps every valid message", () => {
  reset();
  const thread = [{ who: "me" as const, t: "hi", at: "2026-09-20T10:00:00Z" }];
  saveChats({ u1: thread });
  assert.deepEqual(loadChats(), { u1: thread });
});
