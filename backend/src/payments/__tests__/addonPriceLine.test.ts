/**
 * The price table in a guest's booking email, against the breakdown the page they paid on showed them.
 *
 * `priceBooking` adds the experience's price to the extras the guest ticked and returned the sum alone, so the
 * email's first line carried the whole subtotal under the experience's own name: a $200 sunset cruise booked with
 * a $30 dry bag and a $20 photo package read "Sunset Cruise $250.00", with an "Add-ons" row above naming both
 * extras and pricing neither. The page had listed the three separately all along, and the guest's own receipt was
 * the one surface that said the cruise cost $250. 1,824 shipped listings sell a priced add-on.
 *
 * The two halves are recorded on the booking now and the table prints both. A booking taken before the split was
 * stored holds only the subtotal, so it reads as the experience alone and the table is the three lines it was.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { priceBooking, serviceFee } from "../money.ts";
import { guestLines, moneyOf, type BookingContext } from "../../api/bookingMail.ts";
import type { StoredBooking } from "../../api/bookings.ts";

const CRUISE = [{ name: "Sunset Cruise", detail: "", price: 200 }];
const EXTRAS = [
  { name: "Dry bag", detail: "", price: 30 },
  { name: "Photo package", detail: "", price: 20 },
];

const ctx: BookingContext = { title: "Gulf Charters", currency: "usd", where: "", shopPhone: "", ownerEmail: "", listingUrl: "", arrival: "" };
const booking = (over: Partial<StoredBooking>): StoredBooking =>
  ({ service: "Sunset Cruise", variant: "", addons: [], qty: 1, ...over }) as unknown as StoredBooking;

test("the experience and the extras are priced apart as well as added up", () => {
  const p = priceBooking(CRUISE, EXTRAS, "Sunset Cruise", "", 1, ["Dry bag", "Photo package"]);
  assert.ok(p);
  assert.equal(p.base, 200);
  assert.equal(p.extras, 50);
  assert.equal(p.subtotal, 250);
  assert.equal(p.total, 250 + serviceFee(250));
});

test("a booking with no extras prices the experience alone", () => {
  const p = priceBooking(CRUISE, EXTRAS, "Sunset Cruise", "", 1, []);
  assert.ok(p);
  assert.equal(p.base, 200);
  assert.equal(p.extras, 0);
  assert.equal(p.subtotal, 200);
});

test("a per-person row counts the party into the experience, not into the extras", () => {
  const p = priceBooking([{ name: "Kayak tour", detail: "per person", price: 50 }], EXTRAS, "Kayak tour", "per person", 3, ["Dry bag"]);
  assert.ok(p);
  assert.equal(p.base, 150);
  assert.equal(p.extras, 30);
  assert.equal(p.subtotal, 180);
});

test("the guest's table names the experience at its own price and the extras at theirs", () => {
  const p = priceBooking(CRUISE, EXTRAS, "Sunset Cruise", "", 1, ["Dry bag", "Photo package"])!;
  const rec = booking({ total: p.total, pricing: { subtotal: p.subtotal, fee: p.fee, base: p.base, extras: p.extras }, addons: ["Dry bag", "Photo package"] });
  assert.deepEqual(guestLines(rec, ctx), [
    { label: "Sunset Cruise", amount: "$200.00 USD" },
    { label: "Add-ons", amount: "$50.00 USD" },
    { label: "Service fee", amount: "$" + serviceFee(250).toFixed(2) + " USD" },
    { label: "Total", amount: "$" + p.total.toFixed(2) + " USD", total: true },
  ]);
});

test("one extra is an add-on, not add-ons", () => {
  const p = priceBooking(CRUISE, EXTRAS, "Sunset Cruise", "", 1, ["Dry bag"])!;
  const rec = booking({ total: p.total, pricing: { subtotal: p.subtotal, fee: p.fee, base: p.base, extras: p.extras }, addons: ["Dry bag"] });
  assert.equal(guestLines(rec, ctx)?.[1].label, "Add-on");
});

test("a booking with no extras keeps the three line table", () => {
  const p = priceBooking(CRUISE, EXTRAS, "Sunset Cruise", "", 1, [])!;
  const rec = booking({ total: p.total, pricing: { subtotal: p.subtotal, fee: p.fee, base: p.base, extras: p.extras } });
  const lines = guestLines(rec, ctx);
  assert.equal(lines?.length, 3);
  assert.deepEqual(lines?.[0], { label: "Sunset Cruise", amount: "$200.00 USD" });
});

/**
 * A booking stored before the split, and a booking the listing could not price at all: neither may lose the
 * table it already had, and neither may invent an extras line out of a subtotal it cannot divide.
 */
test("a booking recorded before the split still prices the experience at its subtotal", () => {
  const rec = booking({ total: 268.75, pricing: { subtotal: 250, fee: 18.75 }, addons: ["Dry bag", "Photo package"] });
  const m = moneyOf(rec);
  assert.equal(m?.extras, 0);
  assert.equal(m?.base, 250);
  assert.deepEqual(guestLines(rec, ctx), [
    { label: "Sunset Cruise", amount: "$250.00 USD" },
    { label: "Service fee", amount: "$18.75 USD" },
    { label: "Total", amount: "$268.75 USD", total: true },
  ]);
});

test("a booking with no price has no table at all", () => {
  assert.equal(moneyOf(booking({ total: null })), null);
  assert.equal(guestLines(booking({ total: null }), ctx), undefined);
});

test("the split adds back up to the subtotal the operator is paid on", () => {
  const cases: [number, number, string[]][] = [[19, 1, ["Dry bag"]], [45.5, 2, ["Photo package"]], [1249.5, 4, ["Dry bag", "Photo package"]], [9.99, 7, []]];
  for (const [price, qty, extras] of cases) {
    const p = priceBooking([{ name: "Row", detail: "per person", price }], EXTRAS, "Row", "per person", qty, extras)!;
    assert.equal(Math.round((p.base + p.extras) * 100) / 100, p.subtotal, `${price} x ${qty}`);
  }
});
