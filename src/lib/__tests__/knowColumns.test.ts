import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { notAlreadyShown } from "../listingDerive";

/**
 * One sentence, one heading.
 *
 * "Who can go" is filled from a shop's `requirements`, and "Safety and waiver" from the waiver lines among its
 * `policies`. Those are two different fields, so a shop that publishes the same sentence in both had it printed
 * twice on one page, under two headings. Shaka Wasaga publishes exactly one requirement, "Waivers must be
 * signed 24 hours prior to boarding", and it is also one of its two policy lines, so the page read:
 *
 *   Who can go            Waivers must be signed 24 hours prior to boarding
 *   Safety and waiver     Waivers must be signed 24 hours prior to boarding
 *
 * with the second column having nothing else in it. Driven in a real Chromium at 1280px and 400px, on both the
 * desktop page and the phone sheet, before and after.
 */

test("a line the waiver column is printing does not lead the other one as well", () => {
  const reqs = ["Waivers must be signed 24 hours prior to boarding"];
  const waiver = ["Waivers must be signed 24 hours prior to boarding"];
  assert.deepEqual(notAlreadyShown(reqs, waiver), []);
});

test("the comparison is the one every other column here uses: letters and digits", () => {
  assert.deepEqual(notAlreadyShown(["Sign the waiver."], ["sign the waiver"]), []);
  assert.deepEqual(notAlreadyShown(["Sign the  waiver!"], ["Sign the waiver"]), []);
});

test("a rule the waiver column is not printing stays where the shop put it", () => {
  const reqs = ["Drivers must be at least 21 with a valid licence", "Waivers must be signed before boarding"];
  const waiver = ["Waivers must be signed before boarding"];
  assert.deepEqual(notAlreadyShown(reqs, waiver), ["Drivers must be at least 21 with a valid licence"]);
});

test("nothing in the other column means nothing to drop", () => {
  const reqs = ["Ages 5 and up", "Closed-toe shoes"];
  assert.deepEqual(notAlreadyShown(reqs, []), reqs);
});

test("both guest surfaces read the same rule", () => {
  const web = readFileSync(new URL("../../components/web/WebListing.tsx", import.meta.url), "utf8");
  const sheet = readFileSync(new URL("../../components/booking/Sheets.tsx", import.meta.url), "utf8");
  assert.match(web, /notAlreadyShown\(requirements,\s*waiverLines\)/, "the desktop page's Who can go column is expected to drop what the waiver column has");
  assert.match(sheet, /notAlreadyShown\(requirements,\s*waiverLines\)/, "the phone sheet's Who can go row is expected to drop what the waiver row has");
  // The requirements list itself stays whole: the age rule and the highlight guard are both read off it.
  assert.match(sheet, /minAge\(requirements\)/, "the age rule is expected to still read every requirement");
  assert.match(web, /minAge\(requirements\)/, "the age rule is expected to still read every requirement");
});
