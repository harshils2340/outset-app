import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

import { companyReply } from "../companyAgent";
import { faqText } from "../listingDerive";
import { knowFrom } from "../operator";
import type { Unclaimed } from "../../data/types";

/**
 * The questions and answers a shop publishes, swept over every one the catalog ships.
 *
 * 65 listings ship an FAQ, 73 entries between them, and they read cleanly but for two that kept the Q&A
 * page's own label: "A. We generally launch at daybreak" and "A. The route we drive is generally about 192
 * miles". Four surfaces print them, and all four printed the label: the desktop listing page and the phone
 * sheet (both through `tidyLine`), Otto quoting the FAQ, and the dashboard the operator edits, which is
 * prefilled from the same crawled file.
 */

const dir = new URL("../../../public/o/", import.meta.url);
const listing = (id: string) => JSON.parse(readFileSync(new URL(id + ".json", dir), "utf8")) as Unclaimed;

test("a Q&A page's label is dropped, and a sentence that merely starts with A is not", () => {
  assert.equal(faqText("A. We launch at daybreak."), "We launch at daybreak.");
  assert.equal(faqText("Q: How long is it?"), "How long is it?");
  assert.equal(faqText("A) Yes, bring a towel."), "Yes, bring a towel.");
  // The mark after the letter is what makes it a label.
  assert.equal(faqText("A life jacket is provided."), "A life jacket is provided.");
  assert.equal(faqText("Answers vary by season."), "Answers vary by season.");
  assert.equal(faqText("Quick tip: bring a towel."), "Quick tip: bring a towel.");
  assert.equal(faqText(""), "");
});

test("Otto quotes the shop's answer, not the page's label", () => {
  const item = listing("o-incadventures-com");
  assert.match(item.faq![0].a, /^A\.\s/, "the listing changed, so this case needs a new one");
  const said = companyReply({ item, contact: null }, "how far is it from downtown?");
  assert.doesNotMatch(said, /^A\.\s/);
  assert.match(said, /^The route we drive/);
});

test("the dashboard is prefilled with the answer the operator wrote, not the label", () => {
  const filled = knowFrom(listing("o-bobsballoons-com"));
  assert.ok(filled.faq?.length);
  for (const f of filled.faq!) {
    assert.doesNotMatch(f.q, /^\s*[QA]\s*[.:)]\s/i, f.q);
    assert.doesNotMatch(f.a, /^\s*[QA]\s*[.:)]\s/i, f.a);
  }
  assert.match(filled.faq![0].a, /^We generally launch at daybreak/);
});

test("no shipped FAQ entry carries a label, markup, an entity or an empty side", () => {
  const files = readdirSync(new URL(dir)).filter((f) => f.endsWith(".json"));
  let entries = 0;
  const bad: string[] = [];
  for (const f of files) {
    let j: Unclaimed;
    try { j = JSON.parse(readFileSync(new URL(f, dir), "utf8")); } catch { continue; }
    for (const e of j.faq || []) {
      entries++;
      for (const side of [e.q, e.a]) {
        const read = faqText(side);
        if (!read.trim()) bad.push(j.id + ": empty");
        if (/^\s*[QA]\s*[.:)\]]\s/i.test(read)) bad.push(j.id + ": label " + read.slice(0, 40));
        if (/<[a-z/!][^>]*>/i.test(read)) bad.push(j.id + ": markup " + read.slice(0, 40));
        if (/&(amp|nbsp|quot|lt|gt|#\d+);/i.test(read)) bad.push(j.id + ": entity " + read.slice(0, 40));
      }
    }
  }
  assert.ok(entries > 50, "the catalog should still ship an FAQ to check: " + entries);
  assert.deepEqual(bad, []);
});
