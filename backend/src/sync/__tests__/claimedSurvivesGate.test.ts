import { test } from "node:test";
import assert from "node:assert/strict";
import { betterDuplicate, passesCatalogFilters, type DuplicateSide } from "../contacts.ts";

/**
 * A listing its operator has claimed is never dropped by the crawl-quality filters.
 *
 * Those filters all read the crawl: the domain we found the business on, the name we scraped off it, the pin
 * OpenStreetMap gave it, and whether any crawler has ever read a photo, a service or an hours line off its own
 * site. The operator's own edits are merged in afterwards, so a row refused here never reaches them.
 *
 * The last of those rules went in on 18 September 2026 and drops 12,332 listings on its first run, on the
 * grounds that a name and a phone number is a lead and not a page. That is right for a lead. It is wrong for
 * the one kind of listing on the site with a person behind it: an operator who found their business, claimed
 * it, typed in their menu, their hours and their photos and pressed Publish would have watched their page
 * disappear on the next sync, because no crawler had ever reached their website.
 */

const row = (over: Partial<Parameters<typeof passesCatalogFilters>[0]> = {}) => ({
  id: "o-example-com",
  domain: "example.com",
  name: "Bayside Jet Ski Rentals",
  legal_name: null,
  city: "Tampa",
  region: "FL",
  lat: 27.95,
  lon: -82.46,
  ...over,
});

const nobodyClaimed = { dead: new Set<string>(), claimed: () => false };
const claimedIt = { dead: new Set<string>(), claimed: () => true };

test("an ordinary crawled row with something read off its site gets a page", () => {
  assert.equal(passesCatalogFilters(row(), nobodyClaimed), true);
});

test("a row nothing has ever been read from is refused", () => {
  const dead = new Set(["o-example-com"]);
  assert.equal(passesCatalogFilters(row(), { dead, claimed: () => false }), false);
});

test("the same row, once its operator has claimed it, keeps its page", () => {
  const dead = new Set(["o-example-com"]);
  assert.equal(passesCatalogFilters(row(), { dead, claimed: (id) => id === "o-example-com" }), true);
});

test("a claim answers the name, the domain and the pin as well as the crawl gap", () => {
  // Every rule below refuses the row on its own, and a claim overrides each of them: the operator has told us
  // by hand what the crawler could not read, and the page they filled in is what a guest opens.
  for (const bad of [
    { name: "Home" },
    { name: "Welcome" },
    { name: "$45" },
    { domain: "amazon.com" },
    { domain: "app.squareup.com" },
    { lat: -16.92, lon: 145.77 }, // Cairns, Australia
    { region: "QL" },
  ] as Partial<ReturnType<typeof row>>[]) {
    assert.equal(passesCatalogFilters(row(bad), nobodyClaimed), false, `unclaimed ${JSON.stringify(bad)} should be refused`);
    assert.equal(passesCatalogFilters(row(bad), claimedIt), true, `claimed ${JSON.stringify(bad)} should keep its page`);
  }
});

test("claiming is the only exemption, so a lead nobody claimed still gets no page", () => {
  const dead = new Set(["o-other-com"]);
  assert.equal(passesCatalogFilters(row({ id: "o-other-com" }), { dead, claimed: (id) => id === "o-example-com" }), false);
});

/**
 * The other two ways a claimed listing could lose its page, both of them the same mistake: a rule that reads
 * the crawl deciding between two rows for one business, when only one of them has a person behind it.
 */

const side = (over: Partial<DuplicateSide> = {}): DuplicateSide => ({ claimed: false, canonical: true, reviews: 40, domain: "bayside.com", ...over });

test("between two rows for one business, the claimed one keeps the page", () => {
  const claimedRow = side({ claimed: true, canonical: false, reviews: 0, domain: "baysidejetskirentals.com" });
  const crawledRow = side({ canonical: true, reviews: 900, domain: "bayside.com" });
  // The claimed row loses every crawl test: not the canonical host, no reviews, the longer domain.
  assert.deepEqual(betterDuplicate(claimedRow, crawledRow), { keep: "a", why: "claimed by its operator" });
  assert.deepEqual(betterDuplicate(crawledRow, claimedRow), { keep: "b", why: "claimed by its operator" });
});

test("with neither claimed, the crawl decides as it always did", () => {
  assert.deepEqual(betterDuplicate(side({ canonical: true }), side({ canonical: false })), { keep: "a", why: "canonical host" });
  assert.deepEqual(betterDuplicate(side({ reviews: 10 }), side({ reviews: 80 })), { keep: "b", why: "more reviews" });
  assert.deepEqual(betterDuplicate(side({ domain: "a-very-long-domain-name.com" }), side({ domain: "short.com" })), { keep: "b", why: "shorter domain" });
});

test("with both claimed, the crawl decides between them rather than nothing deciding", () => {
  const a = side({ claimed: true, reviews: 10 });
  const b = side({ claimed: true, reviews: 80 });
  assert.deepEqual(betterDuplicate(a, b), { keep: "b", why: "more reviews" });
});
