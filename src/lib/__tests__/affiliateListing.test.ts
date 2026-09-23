import assert from "node:assert/strict";
import test from "node:test";
import type { Unclaimed } from "../../data/types";
import { awayLine } from "../../components/explore/feed";
import { experienceById, getCatalog, mergeCatalog, partnerBookLine } from "../catalog";
import { assistantOn } from "../companyAgent";
import { searchByName, searchSuggest } from "../search";

/**
 * A partner product arrives as an ordinary lite catalog record plus `affiliate`. Everything downstream (the
 * card, the listing page, the phone sheet, Otto) reads that one field, so it has to survive the merge, and
 * the record has to be one the app will draw at all.
 */
const lite: Unclaimed = {
  id: "a-viator-t1",
  title: "Tampa Bay Dolphin Cruise",
  cat: "water",
  art: "cruise",
  area: "Tampa, FL",
  metroId: "tampa",
  src: "viator.com",
  rating: 4.8,
  reviews: 321,
  lat: 27.95,
  lon: -82.46,
  cover: "https://media.tacdn.com/T1-720.jpg",
  from: 89,
  dur: "2 hours",
  fc: "Free cancellation",
  options: [],
  specs: [],
  includes: [],
  gap: "",
  lite: true,
  assistant: false,
  affiliate: { source: "viator", label: "Viator", url: "https://www.viator.com/tours/Tampa/x/d123-T1?pid=P1&mcid=42383&medium=api" },
};

test("a partner product merges in with its affiliate link intact and is not marked thin", () => {
  mergeCatalog([lite], {});
  const u = experienceById("a-viator-t1");
  assert.ok(u, "merged");
  assert.deepEqual(u!.affiliate, lite.affiliate);
  assert.equal(u!.from, 89, "the from-price the partner quoted, since there is no menu");
  assert.ok(!u!.thin, "a photo and a price are something a guest can act on");
  assert.ok(getCatalog().some((x) => x.id === "a-viator-t1"), "in the catalog every rail and search reads");
});

test("every partner product merges in, not only the first: they all share the partner's domain", () => {
  // The merge keeps one listing per business website. 1,873 Viator products all say src "viator.com", and on
  // 23 September 2026 the live site showed exactly one of them in its rails, the rest shut out by that rule.
  const second: Unclaimed = { ...lite, id: "a-viator-t2", title: "Skydive Tampa Tandem Jump", art: "skydive", cat: "air", affiliate: { ...lite.affiliate!, url: "https://www.viator.com/tours/Tampa/x/d123-T2?pid=P1" } };
  const third: Unclaimed = { ...lite, id: "a-viator-t3", title: "Ybor City Food Tour", art: "tour", cat: "food", metroId: "tampa" };
  mergeCatalog([lite, second, third], {});
  for (const id of ["a-viator-t1", "a-viator-t2", "a-viator-t3"]) assert.ok(getCatalog().some((x) => x.id === id), id + " is in the catalog");
  assert.equal(experienceById("a-viator-t2")!.affiliate!.url, second.affiliate!.url);
});

test("a partner product is found by search like any other listing", () => {
  const hit = JSON.stringify(searchSuggest(getCatalog(), "Tampa Bay Dolphin Cruise"));
  assert.ok(hit.includes("a-viator-t1"), hit.slice(0, 300));
});

test("a partner product is never claimed, never instant, and Otto does not answer for it", () => {
  const u = experienceById("a-viator-t1")!;
  assert.ok(!u.claimed);
  assert.ok(!u.instant);
  assert.equal(assistantOn(u), false, "the partner's page has the answers, on the partner's terms");
});

test("Otto stays off for a partner product the lite record never marked", () => {
  // `assistant` is written into the detail file and not into catalog.json, so the record the cards and a
  // page's first paint hold has no such key. The affiliate field is the one that always travels.
  const { assistant: _off, ...noFlag } = lite;
  assert.equal(assistantOn(noFlag as Unclaimed), false);
  assert.equal(assistantOn({ ...noFlag, affiliate: undefined } as Unclaimed), true, "an ordinary listing is unchanged");
});

test("a card with no price from the partner says where it books, not that it can be requested", () => {
  const u = experienceById("a-viator-t1")!;
  assert.equal(partnerBookLine(u), "Book on Viator");
  assert.equal(partnerBookLine({ ...u, affiliate: undefined }), null, "every other listing keeps its own wording");
});

test("a partner product never tells a guest how far away it is", () => {
  // Viator files every product in a destination at that destination's centre, Tiqets at the metro's, so the
  // coordinate on the record is one point for a whole city. The card falls back to the city it is filed under.
  const u = experienceById("a-viator-t1")!;
  const nearby = { label: "Ybor City", sub: "Tampa, FL", lat: 27.96, lon: -82.44 };
  assert.equal(awayLine(u, nearby), null);
  const own = { ...u, affiliate: undefined };
  assert.match(String(awayLine(own, nearby)), /away$/, "an operator's own pin is a real one and still counts");
});

test("the claim screen's business search never offers a partner product", () => {
  // searchByName is the operator picker: what an owner types their business name into. A partner's product is
  // nobody's to claim, and picking one ends in "we have no email on file for this business".
  const pool = [...getCatalog()];
  assert.ok(pool.some((u) => u.id === "a-viator-t1"), "it is in the catalog a guest searches");
  assert.deepEqual(searchByName(pool, "Tampa Bay Dolphin Cruise").map((u) => u.id).filter((id) => id === "a-viator-t1"), []);
});
