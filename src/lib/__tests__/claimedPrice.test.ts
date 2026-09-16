import assert from "node:assert/strict";
import test from "node:test";
import type { Unclaimed } from "../../data/types";
import { experienceById, fromPrice, mergeCatalog, setOperatorOverride } from "../catalog";
import { companyAnswer } from "../companyAgent";

/**
 * What a claimed shop's own menu says about its prices, everywhere a price is printed.
 *
 * A crawled record carries a `from` the crawler read off the operator's site, and `fromPrice` falls back to it
 * when no option is priced. That is the honest answer while nobody owns the listing. Once an operator publishes
 * their own menu it is not: the menu is the whole truth about their prices, the same rule the booking API
 * applies in priceBooking. A shop that hid or deleted every service went on advertising the crawled price on
 * every card, rail, search row, compare table and wishlist tile, counted as priced in the price filter, and
 * sorted by a price its own listing page no longer offered.
 */

let n = 0;
function op(over: Partial<Unclaimed> = {}): Unclaimed {
  n += 1;
  return {
    id: "o-price-" + n,
    title: "Shop " + n,
    cat: "water",
    art: "jetski",
    metroId: "tampa",
    area: "Tampa, FL",
    src: "price" + n + ".example.com",
    blurb: "",
    gap: "",
    from: 199,
    specs: [],
    includes: [],
    policies: [],
    quotes: [],
    tags: [],
    options: [{ name: "Jet Ski Tours", detail: "2 hours", price: 199 }],
    ...over,
  } as unknown as Unclaimed;
}

test("an unclaimed shop still shows the from-price the crawl read off its site", () => {
  const u = op({ options: [] });
  mergeCatalog([u], {});
  // No menu and nobody owns the listing: the crawled price is the only thing known, and it is honest.
  assert.equal(fromPrice(experienceById(u.id)!), 199);
});

test("a claimed shop that empties its menu stops advertising the crawled price", () => {
  const u = op();
  mergeCatalog([u], {});
  assert.equal(fromPrice(experienceById(u.id)!), 199);
  // Every service hidden or deleted. toCatalog publishes an empty options array for exactly this state.
  setOperatorOverride(u.id, { title: u.title, options: [], services: [], addons: [] }, true);
  const after = experienceById(u.id)!;
  assert.equal(after.from, undefined);
  assert.equal(fromPrice(after), null);
});

test("a claimed shop whose menu carries no price quotes none either", () => {
  const u = op();
  mergeCatalog([u], {});
  setOperatorOverride(u.id, { title: u.title, options: [{ name: "Jet Ski Rentals", detail: "Standard", price: null }] }, true);
  // The operator publishes the service and not its price: "price on request" is the answer, not the old $199.
  assert.equal(fromPrice(experienceById(u.id)!), null);
});

test("a claimed shop's own menu sets the from-price, not the crawled one", () => {
  const u = op();
  mergeCatalog([u], {});
  setOperatorOverride(u.id, { title: u.title, options: [{ name: "Sunset sail", detail: "2 hours", price: 89 }, { name: "Day charter", detail: "6 hours", price: 450 }] }, true);
  assert.equal(fromPrice(experienceById(u.id)!), 89);
});

test("an edit that does not touch the menu leaves the crawled price alone", () => {
  const u = op({ options: [] });
  mergeCatalog([u], {});
  // A patch with no `options` key is not a published menu: the listing has not been repriced.
  setOperatorOverride(u.id, { title: "Renamed" }, true);
  assert.equal(fromPrice(experienceById(u.id)!), 199);
});

test("Otto stops quoting the crawled price once the operator has taken the menu down", () => {
  const u = op();
  mergeCatalog([u], {});
  setOperatorOverride(u.id, { title: u.title, options: [], services: [], addons: [] }, true);
  const ctx = { item: experienceById(u.id)!, contact: null } as never;
  // AGENTS.md: the company assistant answers only from that operator's published facts and never invents a
  // price. It used to answer "From $199. They haven't published the rest of the price list." for a shop whose
  // own listing page had nothing left to book, because the answer fell through to the crawled from-price.
  for (const q of ["how much is it", "what is the cheapest option"]) {
    const a = companyAnswer(ctx, q).text;
    assert.ok(!/\$\s?199/.test(a), `Otto quoted the removed price for "${q}": ${a}`);
    assert.match(a, /haven't published prices/i);
  }
});
