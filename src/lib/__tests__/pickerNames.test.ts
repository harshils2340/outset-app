import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { variantPickLabel } from "../listingDerive";

/**
 * What the booking menu calls each row it offers.
 *
 * Driven in a real Chromium and read through Chrome's own accessible-name computation, the picker on Mad
 * Beach Party Charter was four buttons all called "4 hours $499 / trip": the shop sells four boats at one
 * price for one length, and the boat's name is the heading above each row, which no screen reader reads as
 * part of the button under it. A service whose only tier is called "Standard" already carried the service
 * name as its label, and that way round lost the money instead, because an `aria-label` replaces a button's
 * content rather than adding to it.
 *
 * The same sweep turned up the rest of a listing's repeated two-word buttons: a "Show more" for the
 * description and one per "Things to know" column, a "Show more" per review card, and, on a phone, one
 * "More" per service description. Six on one page in the worst case, every one of them reading the same.
 */

test("a menu row reads as the thing being booked, its length and its price", () => {
  assert.equal(
    variantPickLabel("Private Party Boat Rental - Pink Paradise", "4 hours", "$499 / trip"),
    "Private Party Boat Rental - Pink Paradise, 4 hours, $499 / trip",
  );
  // The single-tier shape: the length may be unknown, and the price still has to be in there.
  assert.equal(variantPickLabel("Swamp tour", null, "$65 / person"), "Swamp tour, $65 / person");
  assert.equal(variantPickLabel("Swamp tour", "", "Price on request"), "Swamp tour, Price on request");
  // The shop's own note about a tier rides along rather than being dropped.
  assert.equal(variantPickLabel("Kayak hire", "2 hours", "$40", "per kayak"), "Kayak hire, 2 hours, $40, per kayak");
  assert.equal(variantPickLabel("  Kayak hire ", " 2 hours ", "$40"), "Kayak hire, 2 hours, $40", "whitespace is not a part");
});

test("both pickers name their rows through the one reader", () => {
  const desktop = readFileSync(new URL("../../components/web/WebListing.tsx", import.meta.url), "utf8");
  const phone = readFileSync(new URL("../../components/booking/Sheets.tsx", import.meta.url), "utf8");
  for (const src of [desktop, phone]) {
    assert.match(src, /aria-label=\{variantPickLabel\(svc\.name, single \? length : tidyLength\(v\.label\)/);
    assert.doesNotMatch(src, /aria-label=\{single \? tidyName\(svc\.name\) : undefined\}/, "the old label is back");
  }
});

test("the repeated open-this buttons on a listing each name what they open", () => {
  const desktop = readFileSync(new URL("../../components/web/WebListing.tsx", import.meta.url), "utf8");
  const phone = readFileSync(new URL("../../components/booking/Sheets.tsx", import.meta.url), "utf8");
  // The description and each "Things to know" column.
  assert.match(desktop, /label=\{"Show more about " \+ item\.title\}/);
  assert.match(desktop, /label=\{"Show more under " \+ c\.title\}/);
  assert.doesNotMatch(desktop, /<MoreLink onClick=\{\(\) => setModal\("desc"\)\}>/, "an unnamed Show more is back");
  // A review card, drawn once per review.
  assert.match(desktop, /possessive\(r\.name \|\| "A guest"\) \+ " review"/);
  // A service description, on both surfaces.
  assert.match(desktop, /"Show more about " : "Show less about "|"Show less about " : "Show more about "/);
  assert.match(phone, /"Show less about " : "Show more about "/);
});

test("a month arrow the booking window does not reach says so", () => {
  const cal = readFileSync(new URL("../../components/booking/SlotCalendar.tsx", import.meta.url), "utf8");
  assert.match(cal, /title=\{canPrev \? "Previous month" : "Nothing can be booked before this month"\}/);
  const desk = readFileSync(new URL("../../components/web/WebListing.tsx", import.meta.url), "utf8");
  assert.equal((desk.match(/title=\{canPrev \?/g) || []).length, 2, "the desktop listing has two month grids and both arrows explain themselves");
  assert.equal((desk.match(/title=\{canNext \?/g) || []).length, 2);
  assert.match(cal, /title=\{canNext \? "Next month" : "The booking window ends this month"\}/);
});
