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

/**
 * What the operator published beats what the crawl read.
 *
 * These lines read `patch.address` and `patch.phone`, and `toCatalog` has never put either key on the patch:
 * the dashboard's "Meeting point or address" field and its phone field are published inside `patch.contact`.
 * So an operator who corrected a wrong crawled address, moved, or typed the gate their guests should meet at
 * had their listing page updated and every booking email still naming the street the crawl found.
 */
test("the address and phone the operator published reach the email", async () => {
  const crawled = { street: "1 Old Rd", city: "Houston", region: "TX", phone: "+18327070680" };
  const detail = { area: "Houston, TX", contact: crawled };
  const published = (patch: Record<string, unknown>) => ({ patch, owner: { email: "" } }) as never;

  // Untouched since the claim: the patch carries the crawled record back, so nothing moves.
  const same = await bookingContext(rec, published({ contact: crawled }), detail);
  assert.equal(same.where, "1 Old Rd, Houston");
  assert.equal(same.shopPhone, "+18327070680");

  // Edited: `contactPatch` publishes the operator's own line with no town beside it.
  const own = await bookingContext(rec, published({ contact: { street: "Gate 3, 2000 Airport Rd", city: null, region: null, phone: "+18135550123" } }), detail);
  assert.equal(own.where, "Gate 3, 2000 Airport Rd", "the crawled street beat the operator's own");
  assert.equal(own.shopPhone, "+18135550123", "the alert rang the crawled number");

  // A meeting point that is not a street at all is still theirs to state.
  const gate = await bookingContext(rec, published({ contact: { street: "The kiosk by the boat ramp", city: null } }), detail);
  assert.equal(gate.where, "The kiosk by the boat ramp");

  // Cleared: there is no street to print, so the row falls back to the place, as it does for an unclaimed shop.
  const cleared = await bookingContext(rec, published({ contact: { street: null, city: null } }), detail);
  assert.equal(cleared.where, "Houston, Texas");
});

/**
 * A town and a state typed into that field is not a meeting point, and `streetOf` is the rule the listing page
 * reads the same published line by, so both now answer alike.
 */
test("a town typed where a street goes is read the way the listing page reads it", async () => {
  const profile = { patch: { contact: { street: "Agawam, MA", city: null } }, owner: { email: "" } } as never;
  assert.equal((await bookingContext(rec, profile, { area: "Agawam, MA" })).where, "Agawam, Massachusetts");
});
