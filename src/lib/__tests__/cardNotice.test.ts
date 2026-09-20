import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Whether a guest's card is taken is decided by the API alone, from the listing's own price: `payNow` in
 * `backend/src/api/bookings.ts` is `stripeEnabled() && priced && total >= 1`, and it has never asked the
 * browser. A request is no exception, because the card is held at booking and captured when the shop accepts.
 *
 * The desktop listing has read `/config` and said so since cards were switched on. The phone's review-and-pay
 * screen did not read it at all, so on a priced listing at a shop that takes cards it said "This is a request.
 * <shop> confirms by email, and nothing is charged until they do" over a button reading "Request to book", and
 * then Stripe's card form came up. Both surfaces read the one answer now.
 */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const SHEETS = read("../../components/booking/Sheets.tsx");
const WEB = read("../../components/web/WebListing.tsx");

test("both booking surfaces ask the API whether a card is taken", () => {
  for (const [name, src] of [["the phone sheet", SHEETS], ["the desktop listing", WEB]] as const) {
    assert.match(src, /apiConfig\(\)\.then\(\(c\) => \{ if \(alive\) setPayments\(c\.payments\)/, name + " reads /config");
  }
});

test("the phone's button says a card is taken when one is", () => {
  const cta = SHEETS.match(/const cta = [^\n]+/)?.[0] || "";
  assert.match(cta, /cardNow \? \(ottoNow \? "Book with Otto " : "Book and pay "\)/, "a priced booking at a shop that takes cards says so");
  // And the desktop says the same words, so the two cannot promise different things.
  assert.match(WEB, /payments && p\.total \? \(ottoNow \? "Book with Otto" : "Book and pay"\)/);
});

test("nothing on the phone says a card is not taken when one is", () => {
  // The old line, and every line like it, has to sit on the other side of the same condition.
  const fine = SHEETS.slice(SHEETS.indexOf('<p className="airfine">'));
  const block = fine.slice(0, fine.indexOf("</p>"));
  assert.match(block, /cardNow\s*\n?\s*\? "Secure card payment\./, "the card branch comes first");
  const notCharged = block.indexOf("is charged until they do");
  const branch = block.indexOf("cardNow");
  assert.ok(branch >= 0 && notCharged > branch, '"nothing is charged" is only reachable with no card step');
});

test("the one thing the guest is charged is the listing's price, decided by the API", () => {
  const api = readFileSync(new URL("../../../backend/src/api/bookings.ts", import.meta.url), "utf8");
  assert.match(api, /const payNow = stripeEnabled\(\) && !!priced && priced\.total >= 1;/);
  // No branch on instantBook: a request takes a card too, which is what the phone copy now says.
  const line = api.slice(api.indexOf("const payNow"), api.indexOf("const payNow") + 120);
  assert.ok(!/instant/i.test(line), "a request takes a card as much as an instant booking does");
});
