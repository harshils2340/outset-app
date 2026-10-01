/**
 * "Where" in the guest's own confirmation email.
 *
 * The row falls back to the listing's area line when the shop published no street, and on 1,683 of 46,324
 * shipped operator listings that line is a state or province code with no town in front of it, because the
 * crawl never read the town. So a guest who booked AerOhio Skydiving kept an email that said "Where: OH"
 * while the listing page they booked from said "Ohio" and Otto answered "They're in Ohio".
 *
 * The code is spelled out here. It is not dropped, as the "Meet at" rows on the two confirmation screens drop
 * one: this row is the only place a receipt names, and the email's one other pointer is a link.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { bookingContext } from "../bookingMail.ts";
import type { StoredBooking } from "../bookings.ts";

const rec = { listing: "o-aerohio-com" } as unknown as StoredBooking;
const where = async (detail: Record<string, unknown>) => (await bookingContext(rec, null, detail)).where;

test("a bare state code is spelled out", async () => {
  // o-aerohio-com: area "OH", a phone on file and no street, no city and no postcode.
  assert.equal(await where({ title: "AerOhio Skydiving", area: "OH", contact: { phone: "+13307146349" } }), "Ohio");
  assert.equal(await where({ area: "ON" }), "Ontario");
  assert.equal(await where({ area: "bc" }), "British Columbia");
});

test("a town already in the area line is left as the shop's own page states it", async () => {
  assert.equal(await where({ area: "Clearwater Beach, FL" }), "Clearwater Beach, Florida");
  assert.equal(await where({ area: "Washington, DC" }), "Washington, DC");
  assert.equal(await where({ area: "" }), "");
});

test("a street the shop published still wins over the area line", async () => {
  // o-105fever-com, where the fallback never runs: a street and a town is an address a guest can drive to.
  assert.equal(
    await where({ area: "Houston, TX", contact: { street: "2493 South Braeswood Boulevard", city: "Houston", region: "TX" } }),
    "2493 South Braeswood Boulevard, Houston",
  );
});

test("an address the operator typed into their dashboard wins over both", async () => {
  const profile = { patch: { address: "Gate 3, 2000 Airport Rd" }, owner: { email: "" } } as never;
  assert.equal((await bookingContext(rec, profile, { area: "OH" })).where, "Gate 3, 2000 Airport Rd");
});
