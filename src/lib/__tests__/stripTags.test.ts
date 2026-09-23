import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

import { plainWords } from "../catalog";
import { companyReply } from "../companyAgent";
import { stripTags } from "../markdown";
import type { Unclaimed } from "../../data/types";

/**
 * An HTML tag left in the words a guest reads.
 *
 * `plainWords` is the one funnel every crawled and partner-supplied line goes through on its way to a guest,
 * and it took markdown out but not markup. Nothing on either surface renders HTML, so a tag arrived as its own
 * characters: 60 Viator listings printed their refund tiers as "a full refund.<br>If you cancel between 2 and
 * 6 day(s)", on the listing page, in the phone sheet and in Otto's answer, and six operators' service
 * descriptions carried what their own editor left behind.
 */

const dir = new URL("../../../public/o/", import.meta.url);
const listing = (id: string) => JSON.parse(readFileSync(new URL(id + ".json", dir), "utf8")) as Unclaimed;

/* ---------- the rule ---------- */

test("a break between two sentences leaves a space, and a tag inside a word leaves none", () => {
  assert.equal(stripTags("a full refund.<br>If you cancel"), "a full refund. If you cancel");
  assert.equal(stripTags("<p>E-Bikes</p><p class=\"MsoNormal\">School District 22"), "E-Bikes School District 22");
  assert.equal(stripTags("BOTOX<sup>®</sup> Cosmetic"), "BOTOX® Cosmetic");
  assert.equal(stripTags("<strong>Gerald E.</strong>"), "Gerald E.");
});

test("a bracket that is not a tag is arithmetic and stays", () => {
  for (const line of ["under 5' <6 ft", "hulls <2 years old", "we take <3 hours", "no <"]) {
    assert.equal(stripTags(line), line, line);
  }
});

test("a tag the crawl's cut left open gives up the tag and keeps the words", () => {
  // Six blurbs open with one. Taking the bracket to the end of the string would leave the shop no description.
  assert.equal(stripTags("<p Comedy Key West is the only comedy club in the Florida Keys."), "Comedy Key West is the only comedy club in the Florida Keys.");
  assert.equal(stripTags("Published %2$s at %4$s in <a href=\"%6$s\""), "Published %2$s at %4$s in");
});

/* ---------- and on the shipped catalog ---------- */

test("a partner's refund tiers read as sentences rather than as markup", () => {
  // a-viator-132218p116, the shape 60 partner rows carry.
  const j = listing("a-viator-132218p116");
  assert.match(j.cancellation!, /full refund\.<br>If you cancel/, "the line changed, so this case needs a new listing");
  assert.doesNotMatch(plainWords(j.cancellation!), /<|>/);
  assert.doesNotMatch(companyReply({ item: j, contact: null }, "what is your cancellation policy?"), /<|>/);
});

test("a camp's service description is the words its editor wrapped, not the wrapper", () => {
  // o-campconquest-org: two TinyMCE bookmark spans in front of the whole description.
  const j = listing("o-campconquest-org");
  const desc = (j.services || []).map((s) => s.desc || "").find((d) => d.includes("mce_SELRES"));
  assert.ok(desc, "the description changed, so this case needs a new listing");
  assert.match(plainWords(desc!), /^Residential Summer Camp is a great way/);
});

test("no shipped listing sends a guest a tag, and none loses its words to one", () => {
  const left: string[] = [];
  const emptied: string[] = [];
  const walk = (id: string, v: unknown) => {
    if (typeof v === "string") {
      if (!v.includes("<")) return;
      const said = plainWords(v);
      if (/<\/?[a-z]/i.test(said)) left.push(id + ": " + said.slice(0, 90));
      if (v.trim() && !said.trim()) emptied.push(id + ": " + v.slice(0, 90));
      return;
    }
    if (Array.isArray(v)) return void v.forEach((x) => walk(id, x));
    if (v && typeof v === "object") for (const k of Object.keys(v)) walk(id, (v as Record<string, unknown>)[k]);
  };
  let seen = 0;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    let j: Unclaimed;
    try {
      j = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as Unclaimed;
    } catch {
      continue;
    }
    seen++;
    walk(j.id, j);
  }
  assert.ok(seen > 40000, "only " + seen + " listings read");
  assert.deepEqual(left.slice(0, 10), [], left.length + " lines still carry a tag a guest would read");
  assert.deepEqual(emptied.slice(0, 10), [], emptied.length + " lines lost every word they had to the tag rule");
});
