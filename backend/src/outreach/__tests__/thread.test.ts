import { test } from "node:test";
import assert from "node:assert/strict";
import { SentThreads } from "../thread.ts";

/**
 * 6 October 2026: Gmail dropped the Sent connection a paced run had left idle, getMailboxLock threw "Connection
 * not available", and the whole run ended after 18 of 105 sends. A dropped connection must reconnect, and a
 * second failure must give up on that one thread, never on the run.
 */
function fakeBox(opts: { lockFails?: boolean; found?: { messageId: string; subject: string; date: Date }[] }) {
  let loggedOut = false;
  return {
    get loggedOut() { return loggedOut; },
    box: {
      folder: "[Gmail]/Sent Mail",
      client: {
        async getMailboxLock() {
          if (opts.lockFails) throw Object.assign(new Error("Connection not available"), { code: "NoConnection" });
          return { release() {} };
        },
        async search() { return (opts.found || []).map((_, i) => i + 1); },
        async *fetch() { for (const m of opts.found || []) yield { envelope: m }; },
        async logout() { loggedOut = true; },
      } as never,
    },
  };
}

const sent = [{ messageId: "<a@mail.gmail.com>", subject: "Missed calls at X", date: new Date("2026-10-03") }];

test("a dropped connection is logged out, reopened once, and the thread is still found", async () => {
  const dead = fakeBox({ lockFails: true }), live = fakeBox({ found: sent });
  const opened: string[] = [];
  const t = new SentThreads(async (m) => { opened.push(m); return opened.length === 1 ? dead.box : live.box; });
  const got = await t.find("me@gmail.com", "owner@shop.com", new Date("2026-10-03"));
  assert.deepEqual(got, { messageId: "<a@mail.gmail.com>", subject: "Missed calls at X" });
  assert.equal(opened.length, 2, "reconnected once");
  assert.ok(dead.loggedOut, "the dead client was let go");
});

test("a connection that will not come back gives up on the thread without throwing", async () => {
  let n = 0;
  const t = new SentThreads(async () => { n++; return fakeBox({ lockFails: true }).box; });
  assert.equal(await t.find("me@gmail.com", "owner@shop.com", new Date()), null);
  assert.equal(n, 2, "one retry, not a loop");
  assert.equal(await t.find("me@gmail.com", "owner2@shop.com", new Date()), null, "and the next follow-up tries again");
  assert.equal(n, 4);
});

test("a login that failed is retried on the next follow-up instead of staying failed for the run", async () => {
  let n = 0;
  const t = new SentThreads(async () => (++n === 1 ? null : fakeBox({ found: sent }).box));
  assert.equal(await t.find("me@gmail.com", "a@shop.com", new Date()), null);
  assert.ok(await t.find("me@gmail.com", "b@shop.com", new Date()));
});
