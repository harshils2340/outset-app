import assert from "node:assert/strict";
import test from "node:test";
import { addonPrice, priceUnclaimed, serviceFee } from "../pricing";
import { priceWith } from "../format";

/**
 * The money the booking box shows a guest, which has to be the money the server charges them
 * (priceBooking in backend/src/payments/money.ts). A price is money: only a positive number is one.
 *
 * The dashboard's price box saved whatever was typed, and `min={0}` marks a typed "-20" invalid without
 * anyone reading it, so a stray minus reached the guest listing. An extra at -20 came off the bill, an extra
 * at -500 put the total below zero, and an experience typed at -50 read "Confirm and pay -$100" on the
 * button while the server, which is held to "positive or no price", stored the booking with no price at all.
 */

const sail = (price: number | null) => ({ name: "Sunset sail", detail: "2 hours", price, per: "/person" });
const extra = (name: string, price: number | null) => ({ name, detail: "", price });

test("an extra priced below zero takes nothing off the bill", () => {
  const p = priceUnclaimed(sail(100), 2, [extra("Beer package", -20)]);
  assert.equal(p.add, 0);
  assert.equal(p.sub, 200);
  assert.equal(p.total, 200 + serviceFee(200));
});

test("no pile of negative extras can make a trip cost less than nothing", () => {
  const p = priceUnclaimed(sail(100), 1, [extra("Discount", -500), extra("More off", -500)]);
  assert.equal(p.total, 100 + serviceFee(100));
});

test("a free extra is free and a priced one still counts", () => {
  assert.equal(priceUnclaimed(sail(100), 1, [extra("Photo pack", 0), extra("Wetsuit", 30)]).add, 30);
  assert.equal(priceUnclaimed(sail(100), 1, [extra("Photo pack", null)]).add, 0);
});

/**
 * "Pay on site" is what a zero total reads as on every screen, so an experience with no real price must land
 * on zero rather than on a number nobody will be charged.
 */
test("an experience priced at or below zero has no total, the same as one with no price", () => {
  for (const price of [null, 0, -50]) {
    const p = priceUnclaimed(sail(price), 2, [extra("Wetsuit", 30)]);
    assert.equal(p.total, 0, "price " + price);
    assert.equal(p.add, 30, "price " + price);
  }
});

test("addonPrice is the one rule both the lines and the total are read through", () => {
  assert.equal(addonPrice({ price: 30 }), 30);
  assert.equal(addonPrice({ price: 0 }), 0);
  assert.equal(addonPrice({ price: null }), 0);
  assert.equal(addonPrice({ price: -20 }), 0);
});

/**
 * The unit a price is sold in, as a guest reads it. The crawl used to singularise a unit by stripping a trailing
 * "s", so "$30 per class" was stored "/clas" and the booking box quoted "$30 / clas". 11 rows on 10 listings
 * still carry that spelling; `backend/src/enrich/sitescrape.ts` no longer writes a new one, because PRICE_NEAR
 * captures the unit singular already.
 */
test("a unit the crawl over-stripped is still read as the word the shop wrote", () => {
  assert.equal(priceWith(30, "/clas"), "$30 / class"); // o-aikidoburnaby-com
  assert.equal(priceWith(15, "/clas"), "$15 / class"); // o-ashkenaz-com
  assert.equal(priceWith(40, "/clas"), "$40 / class"); // o-pacificreign-com
});

test("every unit the shipped catalog publishes reads as a word, not as a fragment", () => {
  // Every distinct `per` in public/o, and the word each one prints. Nothing may read as a cut-off word.
  const units = ["/group", "/trip", "/hr", "/boat", "/person", "/night", "/jet ski", "/hour", "/day", "/room", "/half day", "/child", "/each", "/kayak", "/session", "/vehicle", "/adult", "/clas", "/jetski", "/30 min", "/ski", "/round", "/half-day", "/ride", "/half hour", "/kid", "/vessel", "/table"];
  for (const per of units) {
    const line = priceWith(50, per);
    assert.ok(line.startsWith("$50"), per);
    const word = line === "$50" ? "" : line.slice("$50 / ".length);
    assert.ok(!/\b(?:clas|pas|bu|glas|les|proces)$/.test(word), per + " prints " + JSON.stringify(word));
  }
});
