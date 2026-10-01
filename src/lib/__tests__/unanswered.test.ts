import assert from "node:assert/strict";
import test from "node:test";

/**
 * One rule, read at the three places that remember what the API said: a real answer is kept, a call nobody
 * answered is not. `apiConfig` and `guessPlace` already wrote it down ("a fallback is not an answer, and
 * caching it would stop the next visit from asking again"); the shop's live calendar and the Trips tab both
 * broke it, because `call` turns a dead connection, a timeout, a 429 and a 500 into an ordinary resolved
 * answer, so neither could tell the two apart.
 *
 * The calendar: a listing opened while the API was asleep cached "no live calendar" for five minutes, and the
 * booking box, the phone sheet and Otto all read that shop as having nothing on, with a reload unable to
 * clear it. The tab: a trip the guest had paid for lost its "Confirmed" pill and was never asked after again.
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

const { askStatus, rememberStatus } = await import("../tripStatus");
const { apiDidNotAnswer, availabilityNow, fetchAvailability } = await import("../api");

/* ---------- which statuses say nobody answered ---------- */

test("a timeout, a rate limit and a server fault are not answers; a refusal is", () => {
  for (const s of [0, 408, 429, 500, 502, 503]) assert.equal(apiDidNotAnswer(s), true, String(s));
  for (const s of [200, 400, 401, 403, 404, 409]) assert.equal(apiDidNotAnswer(s), false, String(s));
});

/* ---------- the shop's live calendar ---------- */

test("a calendar nobody answered for is not remembered as an empty one", async () => {
  // No VITE_API_URL under node, so the call cannot reach anything: status 0, the shape of a dead connection.
  const a = await fetchAvailability("o-unanswered-test-com");
  assert.equal(a.live, false, "the caller still gets something to draw");
  assert.equal(availabilityNow("o-unanswered-test-com"), null, "and nothing is pinned on the listing for Otto to read");
  await fetchAvailability("o-unanswered-test-com");
  assert.equal(availabilityNow("o-unanswered-test-com"), null, "a second look does not pin it either");
});

/* ---------- the Trips tab ---------- */

test("a trip's confirmed status survives a read nobody answered", () => {
  assert.equal(rememberStatus("accepted", { status: null, unanswered: true }), "accepted");
  assert.equal(askStatus("accepted", 1), true, "and it is asked again on the next focus");
});

test("a first read nobody answered leaves the booking unasked, so the tab asks again", () => {
  const keep = rememberStatus(undefined, { status: null, unanswered: true });
  assert.equal(keep, undefined);
  assert.equal(askStatus(keep, 0), true);
});

test("the API saying it has no such booking is an answer and is remembered", () => {
  const keep = rememberStatus(undefined, { status: null, unanswered: false });
  assert.equal(keep, "");
  assert.equal(askStatus(keep, 0), false, "a hand-built listing's trip is not asked after on every mount");
  assert.equal(askStatus(keep, 1), true, "a focus still re-asks it: nothing has settled it");
});

test("a status the API gave is remembered, and a settled one is never asked again", () => {
  assert.equal(rememberStatus("new", { status: "accepted", unanswered: false }), "accepted");
  assert.equal(rememberStatus("accepted", { status: "declined", unanswered: false }), "declined");
  for (const s of ["declined", "cancelled", "completed"]) assert.equal(askStatus(s, 1), false, s);
  for (const s of ["new", "accepted", "pending"]) assert.equal(askStatus(s, 1), true, s);
});
