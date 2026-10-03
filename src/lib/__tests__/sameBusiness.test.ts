import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { sameBusiness } from "../catalog";

/**
 * A file read out of `public/o` is named by catalog id alone, and that id is the operator's own domain
 * slugged. The slug folds every run of punctuation, so one id can name two shops: "aqua-tots.com" and
 * "aqua_tots.com" both asked for o-aqua-tots-com in the 23 September catalog, Aqua-Tots in Westerville, Ohio
 * and Aqua-Tots in Dallas, Texas. Whatever is read under an id has to name the business it was read for.
 */

test("one business, however its own pages spell the address", () => {
  assert.equal(sameBusiness({ src: "aqua-tots.com" }, { src: "https://www.Aqua-Tots.com/dallas" }), true);
  assert.equal(sameBusiness({ src: "SkydiveCity.com" }, { src: "skydivecity.com" }), true);
});

test("two domains are two businesses, hyphen and underscore included", () => {
  assert.equal(sameBusiness({ src: "aqua-tots.com" }, { src: "aqua_tots.com" }), false);
  assert.equal(sameBusiness({ src: "proparasail.com" }, { src: "skydivecity.com" }), false);
});

test("a record with no domain is not a disagreement", () => {
  // A Maps hit and a demo row both have none, and both are hydrated from a file like any other listing.
  assert.equal(sameBusiness({ src: "" }, { src: "skydivecity.com" }), true);
  assert.equal(sameBusiness({ src: "skydivecity.com" }, {}), true);
  assert.equal(sameBusiness({}, {}), true);
});

test("both places that read a listing's own file ask it", () => {
  // `hydrateItem` replaces a catalog row wholesale with the file; the dashboard seeds a fresh profile's photos
  // and description from a seed's crawled twin, whose id it guesses from the domain.
  const base = new URL("../../", import.meta.url).pathname;
  for (const file of ["lib/catalog.ts", "components/operator/OperatorView.tsx"]) {
    assert.match(readFileSync(base + file, "utf8"), /sameBusiness\(/, file + " must check the record it read");
  }
});
