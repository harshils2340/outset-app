import test from "node:test";
import assert from "node:assert/strict";
import { getSession, newId, recordTurn, Trace } from "../session.ts";

/**
 * Who a concierge session belongs to.
 *
 * `getSession` answers with the session an id names, and the next answer is shaped by that session's
 * accumulated intent, so the id is a bearer token for somebody's conversation. It was eight characters of
 * `Math.random`, drawn from a generator whose state can be recovered from its own output, and this route
 * hands the caller one output per question. The shape it is drawn in is what these pin down; that an
 * unknown id still opens a session of its own is deliberate, because a browser reopening a thread from its
 * own history sends an id the agent forgot two hours ago and expects to carry on under it.
 */

test("an id is sixteen hex characters, from the platform's own randomness", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 500; i += 1) {
    const id = newId();
    assert.match(id, /^[0-9a-f]{16}$/, id);
    // The shape `getSession` accepts, so an id it minted is an id it takes back.
    assert.match(id, /^[a-z0-9]{4,24}$/);
    ids.add(id);
  }
  assert.equal(ids.size, 500, "no two sessions share an id");
});

test("a session is handed back to the id that named it, and only to that one", () => {
  const first = getSession(null);
  assert.match(first.id, /^[0-9a-f]{16}$/);
  first.intent = { city: "Waterloo" } as never;

  assert.equal(getSession(first.id), first, "the same id is the same conversation");
  assert.notEqual(getSession(newId()).intent, first.intent, "another id is another conversation");
  assert.equal(getSession(null).id === first.id, false, "no id at all starts a fresh one");
});

test("an id that is not the shape we mint is not adopted", () => {
  for (const bad of ["", "  ", "abc", "a".repeat(25), "A1b2c3d4", "../etc", "9f8e7d6c5b4a3210!"]) {
    const s = getSession(bad);
    assert.notEqual(s.id, bad, JSON.stringify(bad));
    assert.match(s.id, /^[0-9a-f]{16}$/);
  }
});

test("a session keeps the last thirty turns and forgets the rest", () => {
  const s = getSession(null);
  for (let i = 0; i < 33; i += 1) recordTurn(s, "question " + i, new Trace(), null);
  assert.equal(s.turns.length, 30);
  assert.equal(s.turns[0].text, "question 3");
  assert.equal(s.turns[29].text, "question 32");
  assert.equal(new Set(s.turns.map((t) => t.id)).size, 30, "a turn is named as carefully as a session");
});
