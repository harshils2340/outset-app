import test from "node:test";
import assert from "node:assert/strict";
import { priceOfSlot, rateLabel, rezdyRef } from "../rezdy.ts";

/**
 * Rezdy's price sheet, and which row of it a guest is quoted.
 *
 * The price helpers are tested directly here rather than through `rezdyLive`, which is the exception in this
 * folder. Cloudflare blocks `fetch` on every `*.rezdy.com` subdomain, so the reader speaks HTTP/2 by hand
 * through `node:http2` and there is no `globalThis.fetch` to stand in front of, as `xola.test.ts` does. A
 * hand-rolled HTTP/2 session would be a hundred lines of fake to reach two pure functions, and the two pure
 * functions are the whole of what a guest reads: the number under a shop's name and the word beside it.
 */

test("the money comes off the end of a price option's name before anything reads it", () => {
  assert.equal(rateLabel("Adult (Per Person) ($149.00)"), "Adult (Per Person)");
  assert.equal(rateLabel("Youth (8-16 Years) ($114.00)"), "Youth (8-16 Years)");
  assert.equal(rateLabel("Group from 1 to 2 ($790.00 total)"), "Group from 1 to 2");
  // A single-rate product has no name at all, only the money, and "Ticket" is this file's own word for that.
  assert.equal(rateLabel(" ($131.00)"), "Ticket");
  assert.equal(rateLabel(null), "Ticket");
  assert.equal(rateLabel("Adult"), "Adult");
});

const slot = (price: { priceLabel?: string; price?: string | number | null; priceOptionType?: string; minQuantity?: number; maxQuantity?: number }[]) =>
  ({ price });

test("the cheapest adult fare is the headline, and the youth fare below it is not", () => {
  const { price, label, rates } = priceOfSlot(slot([
    { priceLabel: "Adult (Per Person) ($149.00)", price: 149 },
    { priceLabel: "Youth (8-16 Years) ($114.00)", price: 114 },
  ]));
  assert.equal(price, 149);
  assert.equal(label, "Adult (Per Person)");
  // The youth fare is real and stays on the sheet; it is only kept out of the headline.
  assert.deepEqual(rates.map((r) => r.price), [149, 114]);
});

test("a price option Rezdy gave no name to is quoted with no name, not with ours", () => {
  const { price, label } = priceOfSlot(slot([{ priceLabel: " ($131.00)", price: "131.00" }]));
  assert.equal(price, 131);
  assert.equal(label, null);
});

/**
 * "2-8 Players" is a party size. This file kept its own looser copy of the age rule for one night and read it
 * as a child fare, which dropped an escape room's only real price out of the headline.
 */
test("a party size in the name of a rate is not an age", () => {
  const { price, label } = priceOfSlot(slot([{ priceLabel: "Escape Room 2-8 Players ($32.00)", price: 32 }]));
  assert.equal(price, 32);
  assert.equal(label, "Escape Room 2-8 Players");
});

test("a group rate is carried on the sheet, marked as one, and never heads it", () => {
  const { price, label, rates } = priceOfSlot(slot([
    { priceLabel: "Adult ($285.00)", price: 285 },
    { priceLabel: "Group from 10 to 28 ($240.00)", price: 240, priceOptionType: "GROUP", minQuantity: 10, maxQuantity: 28 },
  ]));
  assert.equal(price, 285);
  assert.equal(label, "Adult");
  assert.deepEqual(rates.map((r) => [r.label, r.group]), [["Adult", false], ["Group from 10 to 28", true]]);
});

/**
 * Black Hills Tour Company sells nothing but the whole bus. $790 is the booking, not the seat, and there is
 * no head price to quote: saying so is the honest answer and $790 a head is not.
 */
test("a shop that sells only by the group has no head price at all", () => {
  const { price, label, rates } = priceOfSlot(slot([
    { priceLabel: "Group from 1 to 2 ($790.00 total)", price: 790, priceOptionType: "GROUP", minQuantity: 1, maxQuantity: 2 },
  ]));
  assert.equal(price, null);
  assert.equal(label, null);
  assert.deepEqual(rates, [{ label: "Group from 1 to 2", price: 790, minParty: 1, maxParty: 2, group: true }]);
});

test("a rate priced at nothing is not a rate", () => {
  assert.deepEqual(priceOfSlot(slot([{ priceLabel: "Infant ($0.00)", price: 0 }])), { price: null, label: null, rates: [] });
  assert.equal(priceOfSlot(slot([])).price, null);
});

test("a quantity of zero means no limit, not a rate nobody fits", () => {
  const { rates } = priceOfSlot(slot([{ priceLabel: "Adult ($99.00)", price: 99, minQuantity: 0, maxQuantity: 0 }]));
  assert.equal(rates[0].minParty, null);
  assert.equal(rates[0].maxParty, null);
});

test("every shape of Rezdy link in the catalog reads back to an account", () => {
  assert.deepEqual(rezdyRef("https://flytoto.rezdy.com/165194/aerial-tour-of-toronto"), {
    account: "flytoto", productId: "165194", path: "/165194/aerial-tour-of-toronto",
  });
  assert.equal(rezdyRef("https://aog.rezdy.com/")?.productId, null);
  assert.equal(rezdyRef("https://bongossportfishing.com/reservations.html#rezdygen"), null);
});
