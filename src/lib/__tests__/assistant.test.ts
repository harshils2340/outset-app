import assert from "node:assert/strict";
import test from "node:test";
import { companyAnswer, companyGreeting, type CompanyContext } from "../companyAgent";
import type { Unclaimed } from "../../data/types";

/**
 * Otto, the 24/7 assistant on a listing page. Nothing had opened this chat before, and the first line every
 * guest reads carried an em dash, as did six of its answers, against the one writing rule this repo states
 * outright. A comma, a period or a colon says the same thing.
 */

const ctx = (over: Partial<Unclaimed> = {}): CompanyContext => ({
  item: {
    id: "u-x", title: "White Knuckle Watersports", cat: "water", art: "jetski", area: "Clearwater Beach, FL",
    metroId: "tampa", src: "example.com", options: [{ name: "Guided tour", detail: "1.5 hours", price: 150 }],
    specs: ["2 riders per ski"], includes: ["Yamaha waverunner"], waiverUrl: "https://example.com/waiver",
    ...over,
  } as unknown as Unclaimed,
  contact: null,
});

const QUESTIONS = [
  "can I book?", "is there a waiver?", "will it rain tomorrow?", "do you have anything Saturday at 10am?",
  "how much is it?", "what's included?", "can I cancel?", "what time do you open?", "is it ok for kids?",
];

test("the assistant's first line and its answers keep to the house writing rule", () => {
  const c = ctx();
  assert.ok(!companyGreeting(c).includes("—"), companyGreeting(c));
  for (const q of QUESTIONS) {
    const text = companyAnswer(c, q).text;
    assert.ok(!text.includes("—"), q + " -> " + text);
  }
});

test("the assistant still answers, it has not just gone quiet", () => {
  const c = ctx();
  assert.match(companyGreeting(c), /White Knuckle Watersports/);
  assert.match(companyAnswer(c, "can I book?").text, /this page/);
  assert.match(companyAnswer(c, "is there a waiver?").text, /waiver/i);
  assert.match(companyAnswer(c, "will it rain tomorrow?").text, /forecast/i);
});
