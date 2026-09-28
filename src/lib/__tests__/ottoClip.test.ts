import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

import { companyAnswer } from "../companyAgent";
import { cleanDesc } from "../listingDerive";
import type { Unclaimed } from "../../data/types";

/**
 * The chat quotes a shop in the words the page above it prints.
 *
 * Otto's `clip` ran only `plainWords`, while the listing page runs `cleanDesc`, which also closes the space the
 * crawl leaves in front of a comma and drops a button label the crawl swept up. So one sentence was printed two
 * ways on the same screen: the hero said "the safest way to visit Oahu." and Otto said "the safest way to visit
 * Oahu. ", and the hero said "the history of the neighborhood, walk among" where Otto said "the history of the
 * neighborhood , walk among". Both listings below are real shipped records.
 */

const dir = new URL("../../../public/o/", import.meta.url);
const listing = (id: string) => JSON.parse(readFileSync(new URL(id + ".json", dir), "utf8")) as Unclaimed;
const ask = (item: Unclaimed, q = "what services do you have") =>
  companyAnswer({ item, contact: item.contact ?? null, live: null }, q).text;

test("Otto never leaves the space the crawl put in front of a comma", () => {
  const item = listing("a-viator-5713p153");
  assert.match(String(item.blurb), /neighborhood , walk/, "the shipped record still has the spaced comma");
  const text = ask(item);
  assert.match(text, /neighborhood, walk/, text);
  assert.doesNotMatch(text, / ,/, text);
});

/**
 * The guard for the whole class, not just the two listings: whatever Otto quotes of a shop's blurb has to be a
 * run of what `cleanDesc` makes of that blurb, because that is the string the page prints. Held over a sample of
 * real shipped records rather than a hand-typed one, since the defect was in what the crawl leaves behind.
 */
test("what Otto quotes of a blurb is a run of what the page prints of it", () => {
  const ids = readdirSync(new URL(dir)).filter((f) => f.endsWith(".json")).sort().slice(0, 2000);
  let checked = 0;
  for (const file of ids) {
    const item = listing(file.replace(/\.json$/, ""));
    const blurb = String(item.blurb || "");
    if (blurb.trim().length < 40) continue;
    const page = cleanDesc(blurb);
    const said = ask(item).replace(/…$/, "").replace(/\.$/, "");
    if (!page.startsWith(said.slice(0, 30))) continue; // a shop whose answer comes from a field other than the blurb
    checked += 1;
    assert.ok(page.startsWith(said), file + "\n  page: " + page.slice(0, 200) + "\n  otto: " + said.slice(0, 200));
    assert.doesNotMatch(said, /\s[.,;:]/, file + ": " + said);
    assert.equal(said, said.trim(), file + ": ends on a space");
  }
  assert.ok(checked > 20, "only " + checked + " listings in the sample answered from their blurb");
});

/**
 * A full stop is not a sentence end when the word in front of it is short for something.
 *
 * `clip` cut at the first `. ` followed by a capital, and an initial or a shortened word reads exactly like
 * that: a balloon company's blurb was quoted "designed to showcase Mt.", an airboat ride's "Slide across the
 * legendary St." and a sauna's "red light therapy in St.". 1,545 clipped texts on 1,078 shipped listings read
 * one way or the other, counted over every blurb, policy, rule, inclusion, FAQ answer and service description
 * in the catalog. All three records below are real and shipped.
 */
test("Otto keeps what follows an abbreviation the shop wrote", () => {
  assert.match(ask(listing("o-seattleballooning-com"), "tell me about this place"), /Mt\. Rainier/);
  assert.match(ask(listing("o-airboatridesatmidway-com"), "tell me about this place"), /St\. Johns River/);
  assert.match(ask(listing("o-balancehousestudio-com"), "tell me about this place"), /in St\. Petersburg\.$/);
});

/**
 * The other half of the same bug. A shop whose copy opens on an initial put the first full stop inside the
 * first twenty characters, the `stop > 20` floor threw that stop away, and nothing then looked for the next
 * one, so the quote ran on through every later sentence of the text.
 */
test("Otto still ends the sentence when a text opens on an initial", () => {
  const said = ask(listing("o-bakkerproject-com"), "tell me about this place");
  assert.match(said, /^James R\. Bakker/, said);
  assert.doesNotMatch(said, /Over the next fifty years/, said);
});

/** A bare abbreviation is never where a quote of a shop's blurb stops, over a sample of shipped records. */
const ABBREVIATED = /(?:(?:^|[^\p{L}'’])\p{L}|\b(?:St|Ste|Mt|Ft|Dr|Mr|Mrs|Ms|Jr|Sr|Capt|Lt|Sgt|Col|Rev|Prof|Ave|Blvd|Rd|Hwy|Rte|Pkwy|Inc|Ltd|Approx|Vs|Etc|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec))$/iu;

test("Otto never stops a quote on an abbreviation", () => {
  const ids = readdirSync(new URL(dir)).filter((f) => f.endsWith(".json")).sort().slice(0, 4000);
  let cut = 0;
  for (const file of ids) {
    const item = listing(file.replace(/\.json$/, ""));
    const blurb = String(item.blurb || "");
    if (blurb.trim().length < 40) continue;
    const page = cleanDesc(blurb);
    const said = ask(item, "tell me about this place");
    if (said.endsWith("…")) continue; // clamped by length, not by a sentence end
    const body = said.replace(/\.$/, "");
    if (!page.startsWith(body) || body.length >= page.length) continue;
    cut += 1;
    assert.doesNotMatch(body, ABBREVIATED, file + "\n  page: " + page.slice(0, 200) + "\n  otto: " + said);
  }
  assert.ok(cut > 20, "only " + cut + " listings in the sample had their blurb cut at a sentence end");
});
