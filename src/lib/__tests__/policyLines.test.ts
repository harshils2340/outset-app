/**
 * What a guest reads under "Things to know", held to the catalog the app ships.
 *
 * Both listing surfaces filed every policy line that was not a waiver under the heading "Cancellation policy",
 * so 2,129 listings headed "No outside food, beverages or ice chests permitted" and "$20 fuel surcharge may
 * apply" as their cancellation terms, and 2,658 more mixed the two under the one heading. The same filter
 * swallowed the terms themselves on 74 listings whose shop states them as a policy line rather than in
 * `cancellation` ("Full refund if canceled 5 days or more before sail date"), and the page then told the guest
 * to contact the business, on the page where Otto quotes the line.
 *
 * Every line below is a real one from `public/o`, named by the listing it came from.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

import { bringLine, splitPolicies } from "../listingDerive";

const dir = new URL("../../../public/o/", import.meta.url);
type Detail = { id: string; policies?: string[]; bring?: string[]; cancellation?: string };
const details = (): Detail[] => readdirSync(dir).map((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")) as Detail);

/* ---------- which lines are cancellation terms ---------- */

test("a shop's cancellation terms are cancellation terms wherever it states them", () => {
  assert.deepEqual(splitPolicies(["Full refund if canceled 5 days or more before sail date"]).cancel, ["Full refund if canceled 5 days or more before sail date"]); // o-ancloterivertours-com
  assert.deepEqual(splitPolicies(["Flights may be rescheduled at no charge due to unsuitable weather conditions"]).other, []); // o-aerigohelicoptertours-com
  assert.equal(splitPolicies(["Party reservation requires $100 deposit, non-refundable but can be credited with 14 days advance notice"]).cancel.length, 1); // o-adventurecity-com
  assert.equal(splitPolicies(["No-shows are charged the full amount"]).cancel.length, 1);
});

test("a house rule is not a cancellation term", () => {
  const rules = [
    "No outside food, beverages or ice chests permitted", // o-22ndstreet-com
    "Park admission to Keewaydin State Park is $6.00", // o-1000islandswatertours-com
    "Beer to go limited to 288 oz. per person per day", // o-3nationsbrewing-com
    "NYC tax and 18% gratuity added to final bill", // o-233starrkaraoke-com
    "Dogs allowed on patio if well behaved and leashed", // o-180wines-ca
  ];
  assert.deepEqual(splitPolicies(rules).other, rules);
  assert.deepEqual(splitPolicies(rules).cancel, []);
});

test("a waiver line stays in the waiver column and nowhere else", () => {
  // "Recommended to arrive a few minutes early for party check-in" was printed twice, once under
  // "Safety and waiver" and once under "Cancellation policy".
  const waiver = ["All participants must sign a liability waiver", "Recommended to arrive a few minutes early for party check-in"];
  const split = splitPolicies(waiver);
  assert.deepEqual(split.cancel, []);
  assert.deepEqual(split.other, []);
});

test("no line the catalog ships lands in two columns, and none is lost", () => {
  const waiverLine = /\bwaivers?\b|\bliabilit|\brelease form|\bsign(ed|ing)? (a |the |our |your )?(waiver|release|form)|\bcheck-?in\b/i;
  let lines = 0;
  for (const d of details()) {
    const pol = d.policies || [];
    if (!pol.length) continue;
    const { cancel, other } = splitPolicies(pol);
    const waiver = pol.filter((l) => waiverLine.test(l));
    lines += pol.length;
    assert.equal(cancel.length + other.length + waiver.length, pol.length, d.id + " prints every policy line once");
    for (const l of cancel) assert.ok(!other.includes(l) && !waiver.includes(l), d.id + " files " + l + " once");
  }
  assert.ok(lines > 19000, "read the shipped policy lines, got " + lines);
});

test("thousands of listings publish policies that are not cancellation terms", () => {
  let onlyOther = 0;
  let both = 0;
  for (const d of details()) {
    const { cancel, other } = splitPolicies(d.policies || []);
    if (!other.length) continue;
    if (cancel.length || d.cancellation) both++;
    else onlyOther++;
  }
  // The heading is picked from this: "Policies" when there are other lines, "Cancellation policy" when not.
  assert.ok(onlyOther > 1500, "listings with no cancellation term and other policies: " + onlyOther);
  assert.ok(both > 1500, "listings with both: " + both);
});

/* ---------- the heading the two surfaces print ---------- */

test("neither surface heads other policies as a cancellation policy", () => {
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
  for (const [name, src] of [
    ["the phone listing sheet", read("../../components/booking/Sheets.tsx")],
    ["the desktop listing page", read("../../components/web/WebListing.tsx")],
  ] as const) {
    assert.match(src, /splitPolicies[^\n]*from "\.\.\/\.\.\/lib\/listingDerive"/, name + " imports the one splitter");
    assert.doesNotMatch(src, /filter\(\(l\) => !\/cancel\|refund\|waiver\|liabilit\/i\.test\(l\)\)/, name + " keeps no copy of the old filter");
    assert.match(src, /otherPolicies\.length \? "Policies" : "Cancellation policy"/, name + " names the column after what is in it");
  }
});

/* ---------- what to bring ---------- */

test("an acronym keeps its capitals when the page says to bring it", () => {
  assert.equal(bringLine("ID for age verification"), "Bring ID for age verification"); // o-averybrewing-com
  assert.equal(bringLine("BYOB allowed with reservation for events"), "Bring BYOB allowed with reservation for events"); // o-agawambowl-com
  assert.equal(bringLine("US Coast Guard approved life vest if bringing own"), "Bring US Coast Guard approved life vest if bringing own"); // o-adventureisland-com
  assert.equal(bringLine("SPF apparel and hat"), "Bring SPF apparel and hat"); // o-biloxideepsea-com
});

test("ordinary prose still reads as one sentence", () => {
  assert.equal(bringLine("Water shoes and a towel"), "Bring water shoes and a towel");
  assert.equal(bringLine("Closed-toe shoes"), "Bring closed-toe shoes");
  assert.equal(bringLine("your own fishing poles"), "Bring your own fishing poles");
});

test("every bring line the catalog ships keeps the letters the shop typed", () => {
  let repaired = 0;
  for (const d of details()) {
    for (const b of d.bring || []) {
      const line = bringLine(b);
      assert.ok(line.startsWith("Bring "), d.id);
      const rest = line.slice("Bring ".length);
      const before = b.charAt(0).toLowerCase() + b.slice(1); // what the page printed before
      if (rest !== before) {
        repaired++;
        assert.equal(rest, b, d.id + " leaves " + b + " alone");
      }
    }
  }
  assert.ok(repaired > 100, "bring lines the old rule mangled: " + repaired);
});
