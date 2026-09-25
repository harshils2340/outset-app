import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { companyAnswer, companyFacts } from "../companyAgent";
import type { Unclaimed } from "../../data/types";

/**
 * What goes to the grounded model, and when.
 *
 * `companyFacts` is the whole of what the model may read, so it has to carry what the page shows (prices, hours,
 * rules, where to go, the FAQ) and nothing the page hides (the shop's email and website). `gap` is the switch
 * that sends a question there at all: only a rules answer that admits it has no fact, never a refusal, never a
 * fact the rules already quoted.
 *
 * `o-1000islandscruises-ca` is a real shipped listing with hours, policies, a meeting point and unpriced options.
 */

const dir = new URL("../../../public/o/", import.meta.url);
const listing = (id: string) => JSON.parse(readFileSync(new URL(id + ".json", dir), "utf8")) as Unclaimed;
const cruises = listing("o-1000islandscruises-ca");
const ctx = { item: cruises, contact: cruises.contact ?? null, live: null };

test("the facts carry what the page shows, one titled document per subject", () => {
  const facts = companyFacts(ctx);
  const ids = facts.map((f) => f.id);
  for (const id of ["about", "prices", "hours", "rules", "meet", "cancel", "contact", "fee"]) assert.ok(ids.includes(id), id);
  const by = Object.fromEntries(facts.map((f) => [f.id, f.text]));
  assert.match(by.hours, /9:00 am - 6:00 pm/i);
  assert.match(by.meet, /1 Brock St/);
  assert.match(by.rules, /age 19 and older/);
  assert.match(by.prices, /price not published/);
  for (const f of facts) assert.ok(f.text.length <= 1400 && f.title.length <= 80, f.id);
});

test("the facts keep the shop's email and website off the guest's side", () => {
  const all = companyFacts(ctx).map((f) => f.text).join(" ");
  assert.doesNotMatch(all, /@/);
  assert.doesNotMatch(all, /1000islandscruises\.ca/i);
});

test("gap is set only when the rules admit they have no fact", () => {
  // No rule reads "gift cards", and nothing says whether the dock has step-free access: gaps, worth a read of
  // the policies by the model.
  assert.equal(companyAnswer(ctx, "do you do gift cards?").gap, true);
  assert.equal(companyAnswer(ctx, "is it wheelchair accessible?").gap, true);
  // Refused outright (traffic is nobody's published fact): never sent to the model.
  const refused = companyAnswer(ctx, "what's the traffic like?");
  assert.match(refused.text, /so I can't help with that/);
  assert.notEqual(refused.gap, true);
  // A fact the rules quote themselves: no round trip.
  assert.equal(companyAnswer(ctx, "what are your hours?").gap, false);
  assert.equal(companyAnswer(ctx, "where do we meet?").gap, false);
});
