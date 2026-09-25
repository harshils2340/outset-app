import { strict as assert } from "node:assert";
import test from "node:test";

/**
 * `POST /otto/ask`, driven as the page reaches it.
 *
 * It is public and it costs a model call, so the route has to refuse the wrong shapes before it spends, count
 * calls, and remember an answer it already gave. The fetch to Cohere is a fixture: nothing here reaches the
 * network, and the key is a test string set before the route module loads.
 */

process.env.COHERE_API_KEY = "test-key";
process.env.COHERE_DAILY_CAP = "3";
process.env.COHERE_RPM = "10";
const { setCohereFetch } = await import("../../lib/cohere.ts");
const { otto, resetOttoForTests } = await import("../otto.ts");

const facts = [
  { id: "ages", title: "Age rules", text: "Ages 10 and up can play." },
  { id: "prices", title: "Prices", text: "$34 per person plus tax." },
];

let calls = 0;
setCohereFetch(async () => {
  calls++;
  const text = "Ages 10 and up can play. Younger kids are usually fine elsewhere.";
  return new Response(JSON.stringify({ message: { content: [{ type: "text", text }], citations: [{ start: 0, end: 24, sources: [{ id: "ages" }] }] } }), { status: 200 });
});

const ask = (body: unknown, ip = "203.0.113.9") =>
  otto.request("/otto/ask", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify(body),
  });

const good = { id: "o-lockedin-com", shop: "Locked In", question: "can my 9 year old come", facts };

test("the wrong shapes are refused before anything is spent", async () => {
  resetOttoForTests();
  calls = 0;
  assert.equal((await ask({})).status, 400);
  assert.equal((await ask({ ...good, question: "" })).status, 400);
  assert.equal((await ask({ ...good, question: "x".repeat(301) })).status, 400);
  assert.equal((await ask({ ...good, facts: [] })).status, 400);
  assert.equal((await ask({ ...good, facts: [{ id: "a", title: "b", text: "x".repeat(1501) }] })).status, 400);
  assert.equal((await ask({ ...good, history: [{ who: "us", t: "hi" }] })).status, 400);
  assert.equal(calls, 0);
});

test("a good question comes back checked, and the same question again comes from the cache", async () => {
  resetOttoForTests();
  calls = 0;
  const r = await ask(good);
  assert.equal(r.status, 200);
  const body = (await r.json()) as { text: string; cited: string[]; dropped: number };
  assert.equal(body.text, "Ages 10 and up can play.");
  assert.deepEqual(body.cited, ["ages"]);
  assert.equal(body.dropped, 1);
  const again = await ask({ ...good, question: "Can my 9 year old  come" });
  assert.equal(again.status, 200);
  assert.equal(calls, 1, "the second ask was answered from the cache");
});

test("the daily cap answers busy rather than spending", async () => {
  resetOttoForTests();
  calls = 0;
  for (let i = 0; i < 3; i++) assert.equal((await ask({ ...good, question: "question number " + i })).status, 200);
  const r = await ask({ ...good, question: "one more" });
  assert.equal(r.status, 429);
  assert.deepEqual(await r.json(), { text: null, reason: "cap" });
  assert.equal(calls, 3);
});

test("without a key the route says it is off, and the page keeps the rules' line", async () => {
  resetOttoForTests();
  const key = process.env.COHERE_API_KEY;
  delete process.env.COHERE_API_KEY;
  try {
    const r = await ask(good);
    assert.equal(r.status, 503);
    assert.deepEqual(await r.json(), { text: null, reason: "off" });
  } finally {
    process.env.COHERE_API_KEY = key;
  }
});
