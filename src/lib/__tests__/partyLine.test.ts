import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { perPerson } from "../catalog";
import { priceUnclaimed } from "../pricing";
import type { UnclaimedOption } from "../../data/types";

/**
 * A per-person price is multiplied by the party, and the Price details line is the only place that says so
 * before the guest pays. Both desktop surfaces have shown "$29 × 4 guests" since cards were switched on. The
 * phone's review-and-pay screen showed "Sunset sail · 2 hours  $116" over a tier row reading "$29", so the
 * only number that ever explained the other three was one the guest had to work out. On a phone the frame goes
 * away and that screen is the whole app.
 */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const SHEETS = read("../../components/booking/Sheets.tsx");
const WEB_LISTING = read("../../components/web/WebListing.tsx");
const WEB_CONFIRM = read("../../components/web/WebConfirm.tsx");

/** The one line each surface writes for the experience itself. */
const partyLine = /perPerson\(picked\) &&[^?]*\? money\(picked\.price\) \+ " × " \+ (?:qty|booking\.qty) \+ \((?:qty|booking\.qty) === 1 \? " guest" : " guests"\)/;

test("every surface that shows Price details names the party the price was multiplied by", () => {
  for (const [name, src] of [
    ["the phone review-and-pay sheet", SHEETS],
    ["the desktop booking box", WEB_LISTING],
    ["the desktop confirmation", WEB_CONFIRM],
  ] as const) {
    assert.match(src, partyLine, name + " spells out the multiplication");
  }
});

test("the phone's line sits on the same condition as the sum beside it", () => {
  // The label and the amount have to agree: "$29 × 4 guests" beside anything but 29 * 4 is worse than silence.
  const line = SHEETS.slice(SHEETS.indexOf('<h2>Price details</h2>'));
  const block = line.slice(0, line.indexOf("</div>"));
  assert.match(block, /money\(picked\.price\) \+ " × " \+ qty/, "the label multiplies");
  assert.match(block, /<span>\{money\(p\.base\)\}<\/span>/, "the amount beside it is the same product");
});

test("a flat price keeps its own name on the line, on every surface", () => {
  // "$18,500 × 4 guests" on a group rate would be the old bug written out in words.
  assert.match(SHEETS, /: picked \? optionLabel\(picked\) : "Experience"/);
  for (const src of [WEB_LISTING, WEB_CONFIRM]) assert.match(src, /: tidyName\(picked\.name\)/);
});

test("the sum the line describes is the one priceUnclaimed works out", () => {
  const opt = (o: Partial<UnclaimedOption> & { price: number }) => ({ name: "Sunset sail", detail: "2 hours", ...o }) as UnclaimedOption;
  const perGuest = opt({ price: 29, per: "/person" });
  assert.equal(perPerson(perGuest), true);
  assert.equal(priceUnclaimed(perGuest, 4).base, 116);

  const flat = opt({ name: "Event Venue Rental Riviera Lawn", detail: "Event space for up to 200 guests", price: 18500, per: "/group" });
  assert.equal(perPerson(flat), false);
  assert.equal(priceUnclaimed(flat, 4).base, 18500);
});
