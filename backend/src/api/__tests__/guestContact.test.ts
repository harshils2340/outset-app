import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { dialPhone, displayPhone } from "../../../../src/lib/phone.ts";
import { GUEST_EMAIL_MAX, GUEST_NAME_MAX, GUEST_PHONE_MAX } from "../../../../src/lib/guestForm.ts";

/**
 * What `POST /bookings` keeps of the three things a guest types about themselves, and whether the operator
 * can ring the number it kept.
 *
 * The mobile used to be cut at 24 characters and then have every character but a digit, a plus, a bracket, a
 * space and a hyphen taken out. That is the rule `src/lib/phone.ts` was written to replace, applied to the
 * guest's side of the marketplace rather than the shop's: "ext." and "x" went and left the extension's digits
 * glued to the number, two numbers typed into one box became one, and 24 characters is shorter than
 * "+1 (813) 555-0100 ext. 301", so the cut landed inside the number too. The dashboard's Call button then
 * dialled the result verbatim, so the operator rang a stranger or nobody and the guest heard nothing.
 *
 * `STORE_DIR` is only here because importing the route touches the catalog reader; nothing below needs a
 * database, which is why this is a unit test of the reader rather than a run of the route.
 */

const dir = mkdtempSync(join(tmpdir(), "outset-guest-"));
mkdirSync(join(dir, "o"), { recursive: true });
process.env.CLAIM_SECRET ||= "guest-contact-test-secret";
process.env.STORE_DIR = dir;
const { readGuest } = await import("../bookings.ts");

/** How the route used to read the field, kept here so the difference is the test rather than the claim. */
const old = (s: string) => s.trim().slice(0, 24).replace(/[^\d+() -]/g, "");

test("a number with an extension reaches the operator whole, and dials the number alone", () => {
  for (const typed of ["(813) 555-0100 ext. 301", "+1 (813) 555-0100 ext. 301", "813-555-0100 x102"]) {
    const kept = readGuest({ name: "Sam Guest", phone: typed, email: "" }).phone;
    assert.equal(dialPhone(kept), "+18135550100", typed);
    // The old field dialled the extension's digits onto the end of the number, or a number cut mid-digit.
    assert.equal(dialPhone(old(typed)), null, typed);
  }
  assert.equal(displayPhone(readGuest({ phone: "813-555-0100 x102" }).phone), "(813) 555-0100 ext. 102");
});

test("two numbers typed into one box ring the first, not a seventeen digit one", () => {
  const kept = readGuest({ phone: "813-555-0100 / 727-555-0199" }).phone;
  assert.equal(dialPhone(kept), "+18135550100");
  assert.equal(old("813-555-0100 / 727-555-0199").replace(/\D/g, "").length, 17);
});

test("an ordinary number is kept exactly as it was before", () => {
  for (const typed of ["8135550100", "(813) 555-0100", "+1 813 555 0100", "+44 20 7946 0958"]) {
    assert.equal(readGuest({ phone: typed }).phone, old(typed), typed);
  }
});

test("the caps are the ones the fields a guest types into carry", () => {
  assert.equal(GUEST_NAME_MAX, 80);
  assert.equal(GUEST_PHONE_MAX, 40);
  assert.equal(GUEST_EMAIL_MAX, 200);
  assert.equal(readGuest({ phone: "9".repeat(60) }).phone.length, GUEST_PHONE_MAX);
  assert.equal(readGuest({ name: "n".repeat(200) }).name.length, GUEST_NAME_MAX);
  assert.equal(readGuest({ email: "a".repeat(250) + "@b.com" }).email.length, GUEST_EMAIL_MAX);
  // 40 is long enough for the longest shape a guest writes, which 24 was not.
  assert.ok("+1 (813) 555-0100 ext. 301".length <= GUEST_PHONE_MAX);
  assert.ok("+1 (813) 555-0100 ext. 301".length > 24);
});

test("the address is still lowercased, and a missing field is still an empty string", () => {
  assert.equal(readGuest({ email: "  Sam@Example.COM " }).email, "sam@example.com");
  assert.deepEqual(readGuest(undefined), { name: "", phone: "", email: "" });
  assert.deepEqual(readGuest({}), { name: "", phone: "", email: "" });
});

test("control characters are still taken out of all three", () => {
  assert.equal(readGuest({ name: "Sam\u0000 Guest" }).name, "Sam Guest");
  assert.equal(readGuest({ phone: "813\n555\t0100" }).phone, "8135550100");
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
