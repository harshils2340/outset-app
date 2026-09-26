import { strict as assert } from "node:assert";
import test from "node:test";
import { Budget, CohereError, groundedAnswer, keepCited, numbersIn, plain, sentencesOf, setCohereFetch, type Fact } from "../cohere.ts";

/**
 * The checks between the model and the guest.
 *
 * Grounded mode makes the model cite what it read; `keepCited` is what makes that a guarantee rather than a
 * habit. Every sentence a guest sees must overlap a citation, and every number in it must already be in the
 * facts or the question. The cases here are the ways a model answer goes wrong in practice: a helpful total
 * it added up, a "usually" from general knowledge, a sentence that reads well and cites nothing.
 */

const facts: Fact[] = [
  { id: "prices", title: "Prices", text: "Escape room, 60 minutes. $34 per person plus tax. Private booking for your group only." },
  { id: "ages", title: "Age rules", text: "Ages 10 and up can play. Under 14 must have an adult in the room." },
  { id: "hours", title: "Hours", text: "Mon-Thu 2pm-10pm, Fri 2pm-11pm, Sat 11am-11pm, Sun 11am-9pm." },
];

test("sentences carry their offsets", () => {
  const s = sentencesOf("No, ages 10 and up. It is $34 per person.  Anything else?");
  assert.deepEqual(s.map((x) => x.text), ["No, ages 10 and up.", "It is $34 per person.", "Anything else?"]);
  assert.equal(s[1].start, 20);
  assert.equal("No, ages 10 and up. It is $34 per person.  Anything else?".slice(s[1].start, s[1].end), "It is $34 per person.");
});

test("numbers are read with and without commas, cents and clock colons", () => {
  const n = numbersIn("$1,000.00 at 9:30, ages 10-14");
  for (const x of ["1000", "1000.00", "9", "30", "10", "14"]) assert.ok(n.has(x), x);
});

test("an uncited sentence is dropped, a cited one kept", () => {
  const text = "Ages 10 and up can play. Most escape rooms allow younger children with a parent.";
  const r = keepCited(text, [{ start: 0, end: 24, sources: [{ id: "ages" }] }], facts);
  assert.equal(r.text, "Ages 10 and up can play.");
  assert.deepEqual(r.cited, ["ages"]);
  assert.equal(r.dropped, 1);
});

test("a total the model added up is dropped even when it cites the price", () => {
  const text = "It is $34 per person plus tax. For three people that is $102 plus tax.";
  const r = keepCited(text, [{ start: 0, end: 30, sources: [{ id: "prices" }] }, { start: 31, end: 70, sources: [{ id: "prices" }] }], facts, "how much for 3 people");
  assert.equal(r.text, "It is $34 per person plus tax.");
  assert.equal(r.dropped, 1);
});

test("a number from the guest's own question is allowed", () => {
  const text = "No, your 9 year old cannot play: ages 10 and up.";
  const r = keepCited(text, [{ start: 0, end: 48, sources: [{ id: "ages" }] }], facts, "can my 9 year old come");
  assert.equal(r.text, text);
});

test("a plain gap line stands without a citation, but not one that carries a number", () => {
  const r = keepCited("They haven't published that.", [], facts);
  assert.equal(r.text, "They haven't published that.");
  assert.deepEqual(r.cited, []);
  const n = keepCited("They haven't published parking for 20 cars.", [], facts);
  assert.equal(n.text, null);
});

test("nothing kept answers null, and markdown is flattened", () => {
  assert.equal(keepCited("Usually about $40.", [], facts).text, null);
  assert.equal(plain("**Yes.**\n- Ages 10 and up\n"), "Yes. Ages 10 and up");
});

test("the budget stops at the per-minute and per-day caps", () => {
  const b = new Budget(2, 3);
  const t = Date.parse("2026-09-25T12:00:00Z");
  assert.ok(b.take(t));
  assert.ok(b.take(t + 1000));
  assert.ok(!b.take(t + 2000), "third call in the minute");
  assert.ok(b.take(t + 61_000), "a minute later");
  assert.ok(!b.take(t + 122_000), "fourth call in the day");
  assert.ok(b.take(t + 24 * 3600 * 1000), "next day");
});

test("groundedAnswer reads Cohere's shape and applies the checks", async () => {
  process.env.COHERE_API_KEY = "test-key";
  let sent: unknown = null;
  setCohereFetch(async (_url, init) => {
    sent = JSON.parse(String(init?.body));
    const text = "Ages 10 and up can play. Most rooms allow younger kids.";
    return new Response(JSON.stringify({ message: { content: [{ type: "text", text }], citations: [{ start: 0, end: 24, sources: [{ type: "document", id: "ages" }] }] } }), { status: 200 });
  });
  try {
    const g = await groundedAnswer({ shop: "Locked In", question: "can my 9 year old come", facts, history: [{ who: "me", t: "hi" }, { who: "them", t: "Hey." }] });
    assert.equal(g.text, "Ages 10 and up can play.");
    assert.deepEqual(g.cited, ["ages"]);
    assert.equal(g.dropped, 1);
    const body = sent as { messages: { role: string }[]; documents: { id: string }[]; citation_options: { mode: string } };
    assert.deepEqual(body.messages.map((m) => m.role), ["system", "user", "assistant", "user"]);
    assert.deepEqual(body.documents.map((d) => d.id), ["prices", "ages", "hours"]);
    assert.equal(body.citation_options.mode, "FAST");
  } finally {
    setCohereFetch(null);
    delete process.env.COHERE_API_KEY;
  }
});

test("a refusal from Cohere is an error the route can read, never an answer", async () => {
  process.env.COHERE_API_KEY = "test-key";
  setCohereFetch(async () => new Response("rate limited", { status: 429 }));
  try {
    await assert.rejects(groundedAnswer({ shop: "x", question: "q", facts }), (e: unknown) => e instanceof CohereError && e.status === 429);
  } finally {
    setCohereFetch(null);
    delete process.env.COHERE_API_KEY;
  }
});

/**
 * A stop inside a word is not the end of a sentence.
 *
 * The splitter used to read one, and it did not merely mis-count: the text in front of the stop was thrown
 * away with it. "Adults are $34.50 per person." reached the guest as "50 per person.", and a waiver answer
 * as "com/waiver.", because `keepCited` joins the sentences the splitter hands it and those were the only
 * ones it saw. Prices with cents and a shop's own domain are both everywhere in the facts, and the prompt
 * asks the model to quote them exactly, so this was the ordinary case rather than an odd one.
 */
test("a price with cents, a domain and an abbreviation keep their sentence whole", () => {
  const cases: [string, string[]][] = [
    ["Adults are $34.50 per person.", ["Adults are $34.50 per person."]],
    ["You need to sign a waiver at example.com/waiver.", ["You need to sign a waiver at example.com/waiver."]],
    ["Doors open at 9 a.m. and close at 5 p.m.", ["Doors open at 9 a.m. and close at 5 p.m."]],
    ["No. It is $34.50, and $12.00 for kids. Anything else?", ["No.", "It is $34.50, and $12.00 for kids.", "Anything else?"]],
  ];
  for (const [text, want] of cases) {
    const s = sentencesOf(text);
    assert.deepEqual(s.map((x) => x.text), want, text);
    for (const x of s) assert.equal(text.slice(x.start, x.end), x.text, text);
  }
});

test("a cited answer quoting a price with cents reaches the guest whole", () => {
  const cents: Fact[] = [{ id: "prices", title: "Prices", text: "Escape room, 60 minutes. $34.50 per person plus tax." }];
  const text = "Adults are $34.50 per person plus tax.";
  const r = keepCited(text, [{ start: 0, end: text.length, sources: [{ id: "prices" }] }], cents, "how much is it");
  assert.equal(r.text, text);
  assert.equal(r.dropped, 0);
  assert.deepEqual(r.cited, ["prices"]);
});

test("an uncited sentence sitting behind a decimal is still dropped", () => {
  const cents: Fact[] = [{ id: "prices", title: "Prices", text: "$34.50 per person." }];
  const text = "It is $34.50 per person. Most rooms nearby charge about the same.";
  const r = keepCited(text, [{ start: 0, end: 24, sources: [{ id: "prices" }] }], cents);
  assert.equal(r.text, "It is $34.50 per person.");
  assert.equal(r.dropped, 1);
});
