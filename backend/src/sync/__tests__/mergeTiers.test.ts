/**
 * The tiers of one service, merged without losing one a guest could book.
 *
 * `options` and `services` are two views of one crawled menu, and a tier is labelled with the row's own duration
 * where the row states one. A shop whose pages state a single duration for a whole rate card gives every row of a
 * service the same label, and the twin merge kept the cheapest and dropped the rest: 1st Class Charter Boat Rental
 * shipped "Sea Doo Jet Ski Rental, 10 hours, $150" as its only tier, while its own menu holds the one through
 * eight hour rentals at $150 to $1,200. The dropped rows stay in `options` with nothing pointing at them, so the
 * booking box could not offer them at all.
 *
 * Every case below is a real listing in `public/o` and names the one it came from.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { mergeTiers, type PlainVariant, type TierRow } from "../plainServices.ts";

/** A menu whose rows all share one raw name, the shape that lost tiers. */
const menuOf = (rows: [detail: string, price: number | null][], name = "Sea Doo Jet Ski Rental") => {
  const rowOf = (optionIdx: number): TierRow => ({ name, detail: rows[optionIdx][0] });
  const variants = rows.map(([, price], optionIdx) => ({ label: "10 hours", price, optionIdx }) as PlainVariant);
  return { rowOf, variants };
};
const read = (out: PlainVariant[]) => out.map((v) => v.label + " $" + v.price);

test("a rate card under one duration keeps every hour the shop sells", () => {
  // o-1stclasscharterboatrental-com: every row's duration read "10 hours", and $150 buys one hour.
  const { rowOf, variants } = menuOf([
    ["One hour rental", 150],
    ["Two hour rental", 300],
    ["Three hour rental", 450],
    ["Eight hour rental", 1200],
  ]);
  assert.deepEqual(read(mergeTiers(variants, rowOf)), ["One hour rental $150", "Two hour rental $300", "Three hour rental $450", "Eight hour rental $1200"]);
});

test("the tier that survives is labelled with its own row, not the rate card's duration", () => {
  // o-aaajetski-com shipped "1 to 8 hours, $125" for a service whose name lists four lengths.
  const { rowOf, variants } = menuOf([
    ["One hour rental", 125],
    ["Half day rental", 349],
  ], "Jet Ski Rental - 1 Hour, 2 Hours, 4 Hours, and 8 Hours");
  assert.deepEqual(read(mergeTiers(variants, rowOf)), ["One hour rental $125", "Half day rental $349"]);
});

test("two rows that publish nothing but a price between them are still one line", () => {
  // o-arayathaimassage-com holds six one-hour massages at $88 to $175. Six lines reading "1 hour" tell a guest
  // less than one, so the cheapest stands for them, which is what this always did.
  const rows: TierRow[] = [
    { name: "Massage", detail: "1 hour" },
    { name: "Massage", detail: "1 hour" },
    { name: "Massage", detail: "1 hour" },
  ];
  const variants = rows.map((r, optionIdx) => ({ label: r.detail, price: [88, 108, 175][optionIdx], optionIdx }) as PlainVariant);
  assert.deepEqual(read(mergeTiers(variants, (i) => rows[i])), ["1 hour $88"]);
});

test("a row with no sub-line of its own cannot be told apart, so the cheapest stands", () => {
  const { rowOf, variants } = menuOf([
    ["2 hours", 200],
    ["", 260],
  ]);
  assert.deepEqual(read(mergeTiers(variants, rowOf)), ["10 hours $200"]);
});

/* ---------- what it did before, unchanged ---------- */

test("the same tier at the same price is one line", () => {
  const { rowOf, variants } = menuOf([
    ["2 hours", 200],
    ["2 hours", 200],
  ]);
  assert.deepEqual(read(mergeTiers(variants, rowOf)), ["10 hours $200"]);
});

test("an unpriced twin takes the price of the priced one", () => {
  const { rowOf, variants } = menuOf([
    ["2 hours", null],
    ["2 hours", 200],
  ]);
  const out = mergeTiers(variants, rowOf);
  assert.deepEqual(read(out), ["10 hours $200"]);
  assert.equal(out[0].optionIdx, 1, "the line has to point at the row that carried the price");
});

test("two rows of different names keep each name in front of the shared label", () => {
  const rows: TierRow[] = [
    { name: "4 Hr Charter", detail: "4 hours" },
    { name: "4 Hr Fishing Trip", detail: "4 hours" },
  ];
  const out = mergeTiers(
    rows.map((_r, optionIdx) => ({ label: "4 hours", price: 400 + optionIdx * 100, optionIdx }) as PlainVariant),
    (i) => rows[i],
  );
  assert.deepEqual(read(out), ["4 Hr Charter · 4 hours $400", "4 Hr Fishing Trip · 4 hours $500"]);
});

test("tiers that already read as themselves are returned as they were", () => {
  const rows: TierRow[] = [
    { name: "Sunset sail", detail: "2 hours" },
    { name: "Sunset sail", detail: "3 hours" },
  ];
  const variants = [
    { label: "2 hours", price: 80, optionIdx: 0 },
    { label: "3 hours", price: 110, optionIdx: 1 },
  ] as PlainVariant[];
  assert.deepEqual(read(mergeTiers(variants, (i) => rows[i])), ["2 hours $80", "3 hours $110"]);
});

test("a tier the merge keeps is never left pointing at another row's price", () => {
  const { rowOf, variants } = menuOf([
    ["One hour rental", 150],
    ["Two hour rental", 300],
    ["Two hour rental", 300],
  ]);
  const out = mergeTiers(variants, rowOf);
  for (const v of out) assert.equal(v.price, variants.find((x) => x.optionIdx === v.optionIdx)!.price);
});
