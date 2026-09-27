import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { companyAnswer } from "../companyAgent";
import type { Unclaimed } from "../../data/types";

/**
 * A question about the listing as a whole.
 *
 * A guest on a walking tour's page asking "tell me about this tour" was answered "They don't list a this tour.
 * Want to see what they do offer?". Two faults met in one sentence: the branch for a thing the shop does not
 * sell caught a question about the shop itself, and the determiner the capture had swallowed was printed as
 * part of the thing's name. A named offer is still matched first, so a shop that really does sell a row by
 * that name answers with the row, and a thing it really does not sell is still refused.
 *
 * `a-viator-5713p153` is a real shipped listing: a cocktail and street art walking tour with no charter.
 */

const dir = new URL("../../../public/o/", import.meta.url);
const listing = (id: string) => JSON.parse(readFileSync(new URL(id + ".json", dir), "utf8")) as Unclaimed;
const tour = listing("a-viator-5713p153");
const ask = (q: string) => companyAnswer({ item: tour, contact: tour.contact ?? null, live: null }, q).text;

test("a question about the listing as a whole is answered from what the shop publishes", () => {
  for (const q of ["tell me about this tour", "tell me about the tour", "what about this trip", "tell me about this place", "tell me about your business", "what is the tour", "tell me about this activity"]) {
    const text = ask(q);
    assert.doesNotMatch(text, /don't list/, q + " -> " + text);
    assert.match(text, /history of the neighborhood/, q + " -> " + text);
  }
});

test("a thing the shop really does not sell is still refused, and never with two determiners", () => {
  for (const q of ["tell me about this charter", "what about the sunset cruise"]) {
    const text = ask(q);
    assert.match(text, /^They don't list an? [a-z]/, q + " -> " + text);
    assert.doesNotMatch(text, /\ban? (this|that|these|those|the|an?|your|our|their) /, q + " -> " + text);
  }
});
