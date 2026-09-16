import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { guestHearsBack, type OpBooking } from "../operator";

/**
 * What the booking drawer promises an operator about a guest it cannot reach.
 *
 * "Declining sends the guest an automatic note offering your next open time" was on that screen under every
 * request. The decline email says the time is not free and links back to the listing; nothing picks a time and
 * nothing offers one. And email is the only channel the product has, while the booking form asks for a name
 * and a mobile and nothing else, so a guest who skipped the email box hears nothing at all. The fifth run made
 * the guest's side of this honest and left the operator's alone.
 */

const here = dirname(fileURLToPath(import.meta.url));

const bk = (over: Partial<OpBooking> = {}): OpBooking =>
  ({
    id: "b1", code: "ABC123", guest: "Sam", service: "Ride", variant: "", price: 100, qty: 2,
    total: 105, date: "2026-10-01", slot: "10:00", status: "new", created: Date.now(), source: "remote",
    ...over,
  }) as OpBooking;

test("a booking the API holds, with an address, is one the guest hears about", () => {
  assert.equal(guestHearsBack(bk({ email: "sam@example.com" })), true);
});

test("no address means no email, because email is the only channel there is", () => {
  assert.equal(guestHearsBack(bk({ email: "" })), false);
  assert.equal(guestHearsBack(bk({ email: "   " })), false);
  assert.equal(guestHearsBack(bk({})), false);
});

test("a booking decided on the device alone never reaches anyone", () => {
  // A booking made in this same browser and a sample row are both answered locally: decideBooking is only
  // called for a remote one, so nothing is sent whatever address they carry.
  assert.equal(guestHearsBack(bk({ source: "guest", email: "sam@example.com" })), false);
  assert.equal(guestHearsBack(bk({ source: "sample", email: "sam@example.com" })), false);
});

test("the drawer no longer promises a note that offers the guest another time", () => {
  const src = readFileSync(join(here, "../../components/operator/OpBookings.tsx"), "utf8");
  assert.ok(!/offering your next open time/.test(src), "the drawer still promises to offer the guest a time");
  assert.ok(/guestHearsBack\(/.test(src), "the drawer no longer checks whether the guest can be reached at all");
});
