import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { companyAnswer, companySuggestions, type CompanyContext } from "../companyAgent";
import type { LiveAvailability } from "../api";
import type { Unclaimed } from "../../data/types";

/**
 * Every question Otto puts in a guest's hand must have an answer behind it.
 *
 * "When's the next opening?" is one of its own suggestion chips, and tapping it came back "They haven't
 * published opening hours. A booking request on this page reaches them directly" at a shop whose calendar had
 * two o'clock free that afternoon: the hours rule reads "when ... opening" and claimed the question before the
 * next-departure rule could. A bare "what are your hours?" had nowhere to land at all and got "I'm not sure
 * what you mean. I can answer prices, hours, what's included ...", which names the thing it just failed at.
 *
 * So this walks the chips rather than a list of phrasings someone thought of.
 */

const LOST = /I'?m not sure what you mean|Ask me about prices/i;

const HOURS = ["Monday: 9:00 AM - 5:00 PM", "Tuesday: 9:00 AM - 5:00 PM", "Wednesday: 9:00 AM - 5:00 PM", "Thursday: 9:00 AM - 5:00 PM", "Friday: 9:00 AM - 5:00 PM", "Saturday: 10:00 AM - 4:00 PM", "Sunday: Closed"];

const live: LiveAvailability = {
  vendor: "fareharbor",
  live: true,
  days: [{ date: "2026-10-01", slots: [{ startsAt: "2026-10-01T14:00", label: "2:00 PM · Flight", bookUrl: "x" }] }],
};

const ctx: CompanyContext = {
  item: {
    id: "u-x", title: "Gulf Coast Parasail", cat: "water", art: "jetski", area: "Clearwater Beach, FL",
    metroId: "tampa", src: "example.com", hoursText: HOURS,
    options: [{ name: "Tandem flight", detail: "90 minutes", price: 85 }],
    specs: ["2 riders"], includes: ["Life vest"], bring: ["Towel"], requirements: ["Ages 6 and up"],
    policies: ["Cancel 24 hours ahead for a full refund"], cancellation: "Free cancellation up to 24 hours before",
    promos: [{ title: "Midweek 10% off", days: [2, 3] }], waiverUrl: "https://example.com/waiver",
    meetingPoint: "Dock 4, Clearwater Marina",
  } as unknown as Unclaimed,
  contact: null,
  live,
};

/** Every chip the module can offer, read off the source so a new one cannot be added untested. */
function allChips(): string[] {
  const src = readFileSync(new URL("../companyAgent.ts", import.meta.url), "utf8");
  const block = src.slice(src.indexOf("const CHIP = {"), src.indexOf("};", src.indexOf("const CHIP = {")));
  const out = [...block.matchAll(/:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(out.length >= 15, "the chip list should have been read, got " + out.length);
  return out;
}

test("every chip Otto offers is a question Otto answers", () => {
  for (const q of allChips()) {
    const text = companyAnswer(ctx, q).text;
    assert.ok(!LOST.test(text), q + " -> " + text);
  }
});

test("the chips offered on the greeting are answered too", () => {
  for (const q of companySuggestions(ctx)) {
    const text = companyAnswer(ctx, q).text;
    assert.ok(!LOST.test(text), q + " -> " + text);
  }
});

/**
 * And the chips an answer offers next, which is how a guest actually moves through the chat: a chip is only
 * ever tapped from the answer that put it there. A shop with almost nothing published is walked too, because
 * that is most of the catalog, and "they don't publish that" is a real answer where "I'm not sure what you
 * mean" is not.
 */
test("the chips each answer hands back are answered, on a full shop and a bare one", () => {
  const bare: CompanyContext = { item: { id: "u-y", title: "Bare Shop", cat: "water", art: "jetski", area: "Tampa, FL", metroId: "tampa", src: "b.com", options: [], specs: [], includes: [] } as unknown as Unclaimed, contact: null, live: null };
  for (const shop of [ctx, bare]) {
    const seen = new Set<string>();
    const queue = [...companySuggestions(shop)];
    while (queue.length) {
      const q = queue.shift()!;
      if (seen.has(q)) continue;
      seen.add(q);
      const a = companyAnswer(shop, q);
      assert.ok(!LOST.test(a.text), shop.item.title + ", " + q + " -> " + a.text);
      for (const next of a.chips || []) if (!seen.has(next)) queue.push(next);
    }
    assert.ok(seen.size >= 4, shop.item.title + " offered " + seen.size + " chips");
  }
});

test("the next opening is the next departure, not the hour they unlock the door", () => {
  assert.match(companyAnswer(ctx, "When's the next opening?").text, /2:00 PM/);
  assert.match(companyAnswer(ctx, "what's the earliest you have?").text, /2:00 PM/);
  // The hours questions that were right before still are.
  assert.match(companyAnswer(ctx, "what time do you open?").text, /9 AM/);
  assert.match(companyAnswer(ctx, "when do you close?").text, /5 PM/);
});

test("a plain hours question is answered with the published week", () => {
  for (const q of ["what are your hours?", "hours?", "opening hours", "what are the hours"]) {
    assert.equal(companyAnswer(ctx, q).text, "Monday to Friday 9 AM to 5 PM, Saturday 10 AM to 4 PM, Sunday closed.", q);
  }
  // A day or a time in the question still gets that day, not the whole week.
  assert.match(companyAnswer(ctx, "hours today").text, /today/);
  assert.match(companyAnswer(ctx, "hours on saturday").text, /Saturday 10 AM to 4 PM/);
  // And a duration question is not an hours question.
  assert.match(companyAnswer(ctx, "how many hours is the flight?").text, /90 minutes|1.5 hours|hour/i);
});
