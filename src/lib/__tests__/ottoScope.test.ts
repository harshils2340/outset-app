import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { companyReply } from "../companyAgent";
import type { OperatorContact, Unclaimed } from "../../data/types";

/**
 * What Otto refuses, and what it only looked like it should refuse.
 *
 * Rule 4 in `companyAgent.ts` says Otto never confirms a booking and never answers about weather, traffic or
 * other businesses. Two gates enforce it and neither had a test.
 *
 * The out-of-scope gate reads the question for words that belong to somebody else's business. Several of those
 * words are also how a guest asks this shop an ordinary question: "how far in advance do I need to book" is a
 * notice period, "the nearest opening" is the next departure, and "rated" sits inside "operated". Those guests
 * were told "I only know what X publishes, so I can't help with that".
 *
 * The other gate is intent order. `book` fired on any question carrying the word "booking", and it was read
 * before `cancel`, so a guest trying to cancel was answered "Yes. Pick a service and time on this page", with
 * the shop's own published refund policy sitting right there unread. The same "Yes." answered "is my booking
 * confirmed?", which is the one thing Otto must never say.
 *
 * `o-1000islandscruises-ca` is a real shipped listing: it publishes a refund policy, hours and a phone.
 */

const dir = new URL("../../../public/o/", import.meta.url);
const listing = (id: string) => JSON.parse(readFileSync(new URL(id + ".json", dir), "utf8")) as Unclaimed;
const cruises = listing("o-1000islandscruises-ca");
const ask = (q: string, item: Unclaimed = cruises, contact: OperatorContact | null = null) =>
  companyReply({ item, contact }, q);

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

/* ---------- a booking the guest already has ---------- */

test("a guest cancelling is read the shop's refund policy, not offered the booking flow", () => {
  const policy = /Ticket Assurance refundable up to 3 hours/;
  assert.match(cruises.cancellation!, policy, "the listing changed, so this case needs a new one");
  for (const q of [
    "cancel my booking please",
    "how do I cancel my booking?",
    "I need to cancel my reservation",
    "can I get a refund on my booking?",
    "can I reschedule my booking?",
  ]) {
    const said = ask(q);
    assert.match(said, policy, q);
    assert.doesNotMatch(said, /^Yes\./, q);
  }
  // A shop with no published policy says so rather than pointing at the booking flow.
  assert.match(ask("cancel my booking please", listing("o-033b649-netsolhost-com")), /haven't published a cancellation policy/);
});

test("Otto never says a booking it cannot see is confirmed", () => {
  for (const q of ["is my booking confirmed?", "did my reservation go through?", "where's my booking?", "can you check my reservation?"]) {
    const said = ask(q);
    assert.doesNotMatch(said, /^Yes\./, q);
    assert.match(said, /can't look up a booking you already have/, q);
    assert.match(said, /Kingston 1000 Islands Cruises can check it/, q);
  }
  // With a number on file it hands the guest the shop instead.
  const said = ask("is my booking confirmed?", cruises, { phone: "+16135495544" } as OperatorContact);
  assert.match(said, /Call /);
});

test("making a booking still reads as making one", () => {
  for (const q of ["can I book online?", "how do I book?", "do you take walk-ins?"]) {
    assert.doesNotMatch(ask(q), /can't look up a booking/, q);
  }
  assert.match(ask("can I book online?"), /^Yes\./);
});

test("Otto can start a booking but never takes a card", () => {
  const said = ask("can you book it for me?");
  assert.match(said, /I can start it/);
  assert.match(said, /never see the card/);
  assert.match(said, /Stripe/);
  assert.doesNotMatch(said, /^Yes\./);
  assert.doesNotMatch(said, /confirmed/i);
});

test("an entry rule is still an entry rule unless the guest is cancelling", () => {
  // The `rules` reader matches "need to", which "I need to cancel my reservation" also says.
  for (const q of ["do I need to swim?", "do I need a licence?", "must I be 18?", "do I need experience?"]) {
    assert.doesNotMatch(ask(q), /cancellation|refund/i, q);
  }
});
