import assert from "node:assert/strict";
import test from "node:test";
import type { Unclaimed } from "../../data/types";
import { experienceById, hydrateItem, mergeCatalog } from "../catalog";

/**
 * Merging a crawled detail file into a hand verified seed.
 *
 * `options` and `services` are one fact: every service variant carries an `optionIdx` that is a position in
 * `options`. Seeds carry options and never services, so taking the list from the seed and the variants from the
 * crawl pointed those positions at a different list. A seed with four options got services describing eight,
 * and the reserve card offered rows whose index landed on the wrong option or past the end of the array, so a
 * guest clicking "2.5 hours, $220" selected nothing, or booked a different trip than the row they clicked.
 */

const opt = (name: string, detail: string, price: number) => ({ name, detail, price, per: "/person" });

/** The crawl's view: eight options, with services whose indices span all of them. */
const crawled = (id: string) =>
  ({
    id,
    title: "Waterfront Rentals",
    cat: "water",
    art: "jetski",
    area: "Clearwater, FL",
    src: "waterfront.example",
    lite: true,
    options: [opt("Jet ski", "1 hour", 95), opt("Jet ski", "2 hours", 170), opt("Guided tour", "90 minutes", 180), opt("Guided tour", "2.5 hours", 220), opt("Dolphin excursion", "2.5 hours", 220), opt("Sunset ride", "1 hour", 120), opt("Private charter", "half day", 600), opt("Lesson", "1 hour", 80)],
    services: [
      { name: "Jet ski", desc: null, variants: [{ label: "1 hour", price: 95, per: "/person", optionIdx: 0 }, { label: "2 hours", price: 170, per: "/person", optionIdx: 1 }] },
      { name: "Guided tour", desc: null, variants: [{ label: "90 minutes", price: 180, per: "/person", optionIdx: 2 }, { label: "2.5 hours", price: 220, per: "/person", optionIdx: 3 }] },
      { name: "Private charter", desc: null, variants: [{ label: "half day", price: 600, per: "/person", optionIdx: 6 }] },
    ],
    photos: [],
    options_note: undefined,
  }) as unknown as Unclaimed;

test("a seed's own options are never paired with the crawl's service variants", () => {
  // A hand verified seed: four options, and no services, which is how every seed is written.
  const seed = { id: "u-pair-test", title: "Waterfront Rentals", cat: "water", art: "jetski", area: "Clearwater, FL", src: "waterfront.example", lite: true, options: [opt("Jet ski", "1 hour", 95), opt("Jet ski", "2 hours", 170), opt("Guided tour", "90 minutes", 180), opt("Guided tour", "2.5 hours", 220)], photos: [] } as unknown as Unclaimed;
  mergeCatalog([seed], {});

  // The crawl arrives describing eight options under a different id, the way a twin record does.
  hydrateItem(crawled("o-waterfront-example"), "u-pair-test");
  const item = experienceById("u-pair-test")!;

  // The seed's four hand checked options are kept.
  assert.equal(item.options.length, 4);
  // Every variant index, if any survived, has to address an option that exists.
  for (const svc of item.services || []) {
    for (const v of svc.variants) {
      assert.ok(v.optionIdx < item.options.length, `optionIdx ${v.optionIdx} past ${item.options.length} options`);
      // And it must address the option it claims to describe, not merely one that exists.
      assert.equal(item.options[v.optionIdx].price, v.price);
    }
  }
});

test("a seed with no options of its own takes both from the crawl, still in step", () => {
  const bare = { id: "u-bare-test", title: "Waterfront Rentals", cat: "water", art: "jetski", area: "Clearwater, FL", src: "bare.example", lite: true, options: [], photos: [] } as unknown as Unclaimed;
  mergeCatalog([bare], {});
  hydrateItem(crawled("o-bare-example"), "u-bare-test");
  const item = experienceById("u-bare-test")!;
  assert.equal(item.options.length, 8);
  assert.ok((item.services || []).length > 0, "the crawl's services should be kept when its options are");
  for (const svc of item.services || []) {
    for (const v of svc.variants) {
      assert.ok(v.optionIdx < item.options.length);
      assert.equal(item.options[v.optionIdx].price, v.price);
    }
  }
});
