import { strict as assert } from "node:assert";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The two concierge routes, driven as a caller reaches them.
 *
 * Both are public and both are dearer than they look: one question fans out into a handful of requests to
 * somebody else's booking provider. Every other public route in this API is counted per caller, and these two
 * were not, so a stranger could point our server at a vendor and we would pay for it in reputation.
 *
 * The catalog is a scratch file with the real schema and no rows in it, so nothing here reaches the network:
 * with nothing to shortlist the route answers with a question back, which is the path worth counting anyway.
 */

process.env.OUTSET_DB = join(mkdtempSync(join(tmpdir(), "outset-concierge-api-")), "catalog.db");
process.env.CLAIM_SECRET = process.env.CLAIM_SECRET || "test-secret-for-the-concierge-routes";
const { migrate } = await import("../../db/client.ts");
migrate();
const { concierge } = await import("../concierge.ts");

const ask = (body: unknown) =>
  concierge.request("/concierge/ask", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" },
    body: JSON.stringify(body),
  });

test("an empty question is refused before anything is searched", async () => {
  const r = await ask({ text: "   " });
  assert.equal(r.status, 400);
  const long = await ask({ text: "x".repeat(301) });
  assert.equal(long.status, 400);
});

test("a sentence with nothing to search on gets a question back, not an empty screen", async () => {
  const r = await ask({ text: "something fun" });
  assert.equal(r.status, 200);
  /**
   * `followUp` is an object now, not a string: a question arrives with the answers to it, so the guest taps
   * rather than guessing what phrasing will be understood. A question with nothing to tap is a form.
   */
  const body = (await r.json()) as {
    followUp: { question: string; choices: { label: string; text: string }[]; why: string } | null;
    options: unknown[];
    counts: { total: number };
  };
  assert.ok(body.followUp, "a sentence with nowhere in it gets a question back");
  assert.ok(body.followUp.question.length > 10);
  /**
   * `choices` are the towns with the most businesses, so against this test's empty catalog there are none to
   * offer. What must always hold is that the field exists and is a list: the page renders it without checking.
   */
  assert.ok(Array.isArray(body.followUp.choices), "a question always carries a choices list, even an empty one");
  assert.deepEqual(body.options, []);
  assert.equal(body.counts.total, 0);
});

test("the number of shops to ask cannot be turned into a negative", async () => {
  /**
   * `ask` is handed to Array.slice, which reads a negative count from the end: -5 dropped the shops we can
   * actually quote instead of asking fewer of them.
   */
  const r = await ask({ text: "escape room in kitchener ontario", ask: -5 });
  assert.equal(r.status, 200);
  const huge = await ask({ text: "escape room in kitchener ontario", ask: 9999 });
  assert.equal(huge.status, 200);
});

test("the route is counted per caller, like every other public one", async () => {
  // The four above are already on the count for this address, so the ceiling arrives 56 questions from here.
  let sawLimit = false;
  for (let i = 0; i < 70; i += 1) {
    const r = await ask({ text: "something fun" });
    if (r.status === 429) {
      sawLimit = true;
      assert.equal(i < 60, true, "the ceiling should be sixty an hour, not fewer");
      break;
    }
  }
  assert.ok(sawLimit, "an uncounted route lets a stranger point our server at a booking vendor");
});

/**
 * The watch window, which was neither gated nor counted.
 *
 * `concierge` is mounted above the blanket x-admin-key middleware in routes.ts, because the routes above have
 * to answer a stranger's browser. These two came up beside them and inherited that, so anyone on the internet
 * could read the last forty guests' sentences. On the site `withPlace` appends the guest's own town to the
 * sentence before it is sent, so that is other people's questions and roughly where each of them was sitting.
 * It also printed every live session id, and `getSession` adopts any id a caller sends.
 */
const watch = (path: string, headers: Record<string, string> = {}) =>
  concierge.request(path, { headers: { "cf-connecting-ip": "198.51.100.4", ...headers } });

test("a stranger cannot read what other guests have been asking", async () => {
  const had = { local: process.env.OUTSET_LOCAL_ADMIN, key: process.env.ADMIN_KEY };
  process.env.OUTSET_LOCAL_ADMIN = "";
  process.env.ADMIN_KEY = "a-key-only-the-founder-has";
  try {
    for (const path of ["/concierge/sessions", "/sessions"]) {
      const r = await watch(path);
      assert.equal(r.status, 404, path + " answered a caller with no key");
      const wrong = await watch(path, { "x-admin-key": "a-key-only-the-founder-ha!" });
      assert.equal(wrong.status, 404, path + " answered a wrong key of the right length");
      const right = await watch(path, { "x-admin-key": "a-key-only-the-founder-has" });
      assert.equal(right.status, 200, path + " should still answer the founder's own terminal");
    }
  } finally {
    if (had.local === undefined) delete process.env.OUTSET_LOCAL_ADMIN;
    else process.env.OUTSET_LOCAL_ADMIN = had.local;
    if (had.key === undefined) delete process.env.ADMIN_KEY;
    else process.env.ADMIN_KEY = had.key;
  }
});

test("the founder's own laptop still opens it, the way the blanket gate lets it", async () => {
  const had = { local: process.env.OUTSET_LOCAL_ADMIN, key: process.env.ADMIN_KEY };
  process.env.OUTSET_LOCAL_ADMIN = "1";
  delete process.env.ADMIN_KEY;
  try {
    assert.equal((await watch("/concierge/sessions")).status, 200);
    assert.equal((await watch("/sessions")).status, 200);
  } finally {
    if (had.local === undefined) delete process.env.OUTSET_LOCAL_ADMIN;
    else process.env.OUTSET_LOCAL_ADMIN = had.local;
    if (had.key !== undefined) process.env.ADMIN_KEY = had.key;
  }
});
