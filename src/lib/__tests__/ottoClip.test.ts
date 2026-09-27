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
