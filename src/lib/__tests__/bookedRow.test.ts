import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { bookedRow } from "../storage";
import type { Booking, UnclaimedOption } from "../../data/types";

/**
 * A booking names the service it was for, and the menu it was picked from moves underneath it.
 *
 * `toCatalog` rebuilds a claimed shop's `options` from its services on every save, so dragging a service up
 * the list, hiding one or deleting one renumbers every row after it. Both guest confirmation screens read the
 * stored index into that live menu, so an operator tidying their Services page relabelled bookings a guest
 * had already made, and a deleted service left the confirmation with nothing where the booking should be.
 */

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const menu = (...names: string[]): UnclaimedOption[] => names.map((n) => ({ name: n, detail: "2 hours", price: 100 }));

const booking = (over: Partial<Booking>): Booking => ({
  listing: "o-shop-com",
  date: "2026-10-09",
  slot: "10:00",
  qty: 2,
  addons: [],
  total: 210,
  code: "SH-1234",
  created: 0,
  ...over,
});

test("the service the booking wrote down survives the operator reordering their menu", () => {
  const b = booking({ addons: ["1", "Dry bag"], service: "Sunset sail", variant: "2 hours", price: 100, per: "/person" });
  // The guest booked row 1 of "Kayak rental, Sunset sail". The operator then dragged the sail to the top.
  const after = menu("Sunset sail", "Kayak rental");
  const row = bookedRow(b, after);
  assert.equal(row?.name, "Sunset sail", "the confirmation named whatever now sits at the stored index");
  assert.equal(row?.detail, "2 hours");
  assert.equal(row?.price, 100);
  assert.equal(row?.per, "/person");
});

test("a deleted service does not empty the confirmation", () => {
  const b = booking({ addons: ["2"], service: "Sunset sail", variant: "", price: 140 });
  assert.equal(bookedRow(b, menu("Kayak rental"))?.name, "Sunset sail");
  assert.equal(bookedRow(b, [])?.name, "Sunset sail");
  assert.equal(bookedRow(b, undefined)?.name, "Sunset sail");
});

test("a booking older than those fields still reads its index, and an index past the end is nothing", () => {
  const old = booking({ addons: ["1", "Dry bag"] });
  assert.equal(bookedRow(old, menu("Kayak rental", "Sunset sail"))?.name, "Sunset sail");
  assert.equal(bookedRow(old, menu("Kayak rental")), null);
  assert.equal(bookedRow(booking({ addons: ["Dry bag"] }), menu("Kayak rental")), null);
});

test("neither confirmation screen reads the live menu by index again", () => {
  for (const p of ["../../components/web/WebConfirm.tsx", "../../components/booking/ConfirmView.tsx"]) {
    const src = read(p);
    assert.match(src, /bookedRow\(/, `${p} no longer asks what the booking booked`);
    assert.doesNotMatch(src, /options\[\s*(?:split\.)?optionIdx\s*\]/, `${p} is back on the stored index`);
  }
});
