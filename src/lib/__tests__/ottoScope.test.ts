import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { companyReply } from "../companyAgent";
import type { Unclaimed } from "../../data/types";

/**
 * What Otto refuses, and what it only looked like it should refuse.
 *
 * Rule 4 in `companyAgent.ts` says Otto never answers about weather, traffic or other businesses. The gate that
 * enforces it had no test.
 *
 * It reads the question for words that belong to somebody else's business. Several of those
 * words are also how a guest asks this shop an ordinary question: "how far in advance do I need to book" is a
 * notice period, "the nearest opening" is the next departure, and "rated" sits inside "operated". Those guests
 * were told "I only know what X publishes, so I can't help with that".
 *
 * `o-1000islandscruises-ca` is a real shipped listing, with published hours, policies and a menu.
 */

const dir = new URL("../../../public/o/", import.meta.url);
const listing = (id: string) => JSON.parse(readFileSync(new URL(id + ".json", dir), "utf8")) as Unclaimed;
const cruises = listing("o-1000islandscruises-ca");
const ask = (q: string, item: Unclaimed = cruises) => companyReply({ item, contact: null }, q);

const REFUSAL = /so I can't help with that/;

/* ---------- the gate must still hold ---------- */

test("Otto still refuses another business, a forecast, a review and a drive", () => {
  for (const q of [
    "how far is it from downtown?",
    "what are your reviews like?",
    "how is it rated?",
    "how many stars on Yelp?",
    "are you better than the other operator?",
    "who owns it?",
    "what's the traffic like?",
    "how do I get there from the airport?",
    "have you had any accidents?",
  ]) {
    assert.match(ask(q), REFUSAL, q);
  }
  // The forecast has a refusal of its own, which is still a refusal.
  assert.match(ask("what's the weather tomorrow?"), /I can't check the forecast/);
});

/* ---------- what the gate was catching by accident ---------- */

test("a notice period is not a distance, however the guest phrases it", () => {
  // "how far" was reading as a distance question, so the commonest booking question there is got a refusal.
  for (const q of ["how far in advance do I need to book?", "how far ahead should I book?"]) {
    const said = ask(q);
    assert.doesNotMatch(said, REFUSAL, q);
  }
  // The plain phrasing always worked, and the two now answer alike.
  assert.equal(ask("how far in advance do I need to book?"), ask("do I need to book in advance?"));
});

test("the nearest opening is the next departure, not a nearby business", () => {
  for (const q of ["when is the nearest available slot?", "what's the nearest opening?"]) {
    assert.doesNotMatch(ask(q), REFUSAL, q);
  }
  assert.equal(ask("when is the nearest available slot?"), ask("when is the next available slot?"));
  // A question that really is about somewhere else keeps its refusal.
  assert.match(ask("is there a hotel nearby?"), REFUSAL);
});

test("a rating word inside an ordinary word is not a rating question", () => {
  // "rated" had no word boundaries, so it matched inside "operated", "decorated" and "celebrated".
  assert.doesNotMatch(ask("is the boat operated by a captain?"), REFUSAL);
  assert.doesNotMatch(ask("can I sign up for your newsletter?"), REFUSAL);
  assert.match(ask("how is it rated?"), REFUSAL);
  assert.match(ask("what are your ratings?"), REFUSAL);
});

test("the two scope gates exempt the same topics, so a pet question survives both", () => {
  // `readQuestion` exempted rainPolicy, meet and pets; `companyAnswer` re-ran the gate exempting only the first
  // two, so a pet question carrying a place word was exempted and then refused anyway.
  const said = ask("can I bring a dog on the tour, how far is it?");
  assert.doesNotMatch(said, REFUSAL);
  assert.match(said, /pet policy/i);
});
