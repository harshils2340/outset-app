import { test } from "node:test";
import assert from "node:assert/strict";
import { draftOttoCopy, possessive, type OttoOp } from "../ottoDrafts.ts";

/**
 * The Otto pitch had no test of its own. It is a commercial email that goes out unattended at 9:30 every
 * weekday from launchd, to businesses that never asked for it and that all have an unclaimed page in the
 * catalog, so the rules backend/src/outreach/AGENTS.md sets are checked here the same way the listing pitch's
 * are in draftCopy.test.ts.
 */
const op: OttoOp = {
  id: "op1",
  domain: "seabreezejetski.com",
  name: "Sea Breeze Jet Ski",
  email: "info@seabreezejetski.com",
  phone: "+17275550100",
  city: "Clearwater Beach",
  region: "FL",
  calendar_vendor: null,
};

const TO = "info@seabreezejetski.com";

test("the mail carries a take-it-down link and a way to stop, per the outreach folder's own rule", () => {
  const c = draftOttoCopy(op, TO);
  // Every recipient already has an unclaimed page in the catalog, so the way off it goes in the mail.
  assert.ok(c.body.includes("#remove=o-seabreezejetski-com"), c.body);
  assert.ok(c.html.includes("#remove=o-seabreezejetski-com"), c.html);
  assert.ok(c.body.includes("/unsubscribe.html?t="), c.body);
  assert.ok(c.html.includes("/unsubscribe.html?t="), c.html);
});

test("the take-it-down line sits after the sign-off, not in the middle of the pitch", () => {
  const c = draftOttoCopy(op, TO);
  assert.ok(c.body.indexOf("#remove=") > c.body.indexOf("Harshil"), c.body);
});

test("nothing is offered as already claimable: no claim link", () => {
  const c = draftOttoCopy(op, TO);
  assert.ok(!c.body.includes("#claim="), c.body);
  assert.ok(!c.html.includes("#claim="), c.html);
});

test("the subject and the opening line name the business", () => {
  const c = draftOttoCopy(op, TO);
  assert.ok(c.subject.includes("Sea Breeze Jet Ski"), c.subject);
  assert.ok(c.body.includes("Sea Breeze Jet Ski"), c.body);
});

test("a name that is already possessive does not grow a second apostrophe", () => {
  assert.equal(possessive("Sea Breeze Jet Ski"), "Sea Breeze Jet Ski's");
  assert.equal(possessive("Capt Andy's"), "Capt Andy's");
  assert.equal(possessive("Shaod’s"), "Shaod’s");
  // A name ending in a plural s is left as it was on purpose. "Gulf Jet Skis'" is the correct form, but it
  // would change the subject of 2,261 of the 4,728 shipped targets, which is a copy call for Harshil; the
  // doubled apostrophe is the typo, and that is one shop.
  assert.equal(possessive("Gulf Jet Skis"), "Gulf Jet Skis's");
  const c = draftOttoCopy({ ...op, name: "Capt Andy's" }, TO);
  assert.equal(c.subject, "Who answers Capt Andy's phone after you close?");
});

test("a business name with markup in it cannot reach the html as markup", () => {
  const c = draftOttoCopy({ ...op, name: 'Reef & Rays <script>alert(1)</script>' }, TO);
  assert.ok(!c.html.includes("<script>"), c.html);
  assert.ok(c.html.includes("&amp;"), c.html);
});

test("no em dash anywhere, including the footer", () => {
  const c = draftOttoCopy(op, TO);
  assert.ok(!c.subject.includes("—"), c.subject);
  assert.ok(!c.body.includes("—"), c.body);
  assert.ok(!c.html.includes("—"), c.html);
});

test("the vendor line is generic when no booking system is on file", () => {
  const none = draftOttoCopy(op, TO);
  assert.ok(none.body.includes("whatever you already use to take bookings"), none.body);
  const known = draftOttoCopy({ ...op, calendar_vendor: "fareharbor" }, TO);
  assert.ok(known.body.includes("FareHarbor"), known.body);
});

test("a draft with no address still carries the terms and privacy lines", () => {
  // AGENTS.md: a draft with no to_email is kept so a human can find a contact, so it still has to read right.
  const c = draftOttoCopy(op);
  assert.ok(c.body.includes("terms.html"), c.body);
  assert.ok(c.body.includes("privacy.html"), c.body);
  assert.ok(!c.body.includes("/unsubscribe.html?t="), "no address means no address to sign an unsubscribe for");
  assert.ok(c.body.includes("#remove="), "the take-it-down link needs no address, so it is there either way");
});
