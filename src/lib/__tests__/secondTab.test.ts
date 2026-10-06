import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * What the device remembers when a second tab of the same browser writes it.
 *
 * `outset.bookings.v2` and `outset.chats.v2` are written whole: the app holds each list in React state, reads
 * it once on the first paint, and writes all of it back on every change. That is fine for one tab and loses
 * rows with two. "Open in new tab" is how a guest compares two listings, so booking in each tab is an
 * ordinary thing to do, and the second tab's booking was gone the moment the first tab wrote: its Trips card,
 * its Inbox thread, and the operator feed, which reads the guest bookings kept in this same browser. The
 * money was in Postgres and the confirmation had been emailed, so the guest held a code for a trip the app
 * said they never booked.
 *
 * The operator dashboard already answers the same question on its own profile key (`OperatorView`), and the
 * comment there says two tabs editing a phone and an address used to end with one edit gone. This is the
 * guest side of it.
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

const { mergeBookings, mergeChats, DEVICE_KEYS } = await import("../storage");

const here = dirname(fileURLToPath(import.meta.url));
const provider = readFileSync(join(here, "../../state/AppProvider.tsx"), "utf8");

type Row = { listing: string; date: string; slot: string; qty: number; addons: string[]; total: number; code: string; created: number; paid?: boolean };
function booking(code: string, created: number, over: Partial<Row> = {}): Row {
  return { listing: "o-shop", date: "2026-10-10", slot: "10:00", qty: 2, addons: [], total: 180, code, created, ...over };
}

/* ---------- bookings ---------- */

test("a booking only the other tab holds survives this tab's next write", () => {
  const mine = [booking("MINE01", 2_000)];
  const theirs = [booking("THEIRS1", 3_000)];
  const merged = mergeBookings(mine as never, theirs as never);
  assert.deepEqual(merged.map((b) => b.code), ["THEIRS1", "MINE01"], "newest first, and neither tab's trip dropped");
});

test("a code both tabs hold is taken from the tab that wrote last", () => {
  // The other tab is the one that came back from Stripe, so its copy is the paid one.
  const mine = [booking("SAME01", 2_000)];
  const theirs = [booking("SAME01", 2_000, { paid: true })];
  const merged = mergeBookings(mine as never, theirs as never);
  assert.equal(merged.length, 1, "one code is one trip, not two rows in Trips");
  assert.equal((merged[0] as Row).paid, true);
});

test("a merge that changes nothing hands back the same list, so two tabs cannot bounce", () => {
  // A storage event reaches every tab but the writer, so a tab that saves after merging sends the event
  // straight back. Without this the two would answer each other for ever.
  const mine = [booking("A", 3_000), booking("B", 2_000)];
  assert.equal(mergeBookings(mine as never, [booking("B", 2_000)] as never), mine as never);
  assert.equal(mergeBookings(mine as never, [] as never), mine as never);
});

/* ---------- chats ---------- */

test("a thread only the other tab has talked to is kept, and the longer thread wins", () => {
  const mine = { "o-a": [{ who: "me", t: "hi", at: "1" }] };
  const theirs = {
    "o-a": [{ who: "me", t: "hi", at: "1" }, { who: "them", t: "hello", at: "2" }],
    "o-b": [{ who: "me", t: "are you open?", at: "3" }],
  };
  const merged = mergeChats(mine as never, theirs as never);
  assert.deepEqual(Object.keys(merged).sort(), ["o-a", "o-b"]);
  assert.equal(merged["o-a"].length, 2, "the thread with the shop's reply in it is the one to keep");
});

test("an unchanged chat merge hands back the same record", () => {
  const mine = { "o-a": [{ who: "me", t: "hi", at: "1" }] };
  assert.equal(mergeChats(mine as never, { "o-a": [{ who: "me", t: "hi", at: "1" }] } as never), mine as never);
});

/* ---------- the app actually listens ---------- */

test("AppProvider merges on a storage event rather than writing its own list over it", () => {
  assert.ok(/addEventListener\("storage"/.test(provider), "nothing in the guest app hears another tab's write");
  const at = provider.indexOf('addEventListener("storage"');
  const block = provider.slice(Math.max(0, at - 900), at);
  assert.match(block, /DEVICE_KEYS\.bookings/, "the listener does not read the bookings key");
  assert.match(block, /DEVICE_KEYS\.chats/, "the listener does not read the chats key");
  assert.match(block, /deviceMerge/, "the listener must merge, not replace: a hydrate would drop this tab's own rows");
  assert.equal(DEVICE_KEYS.bookings, "outset.bookings.v2");
  assert.equal(DEVICE_KEYS.chats, "outset.chats.v2");
});
