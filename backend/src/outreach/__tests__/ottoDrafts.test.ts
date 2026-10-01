import { test } from "node:test";
import assert from "node:assert/strict";
import { COPY_VERSION, draftOttoCopy, type OttoOp } from "../ottoDrafts.ts";

const op: OttoOp = {
  id: "op-1", domain: "clockwiseescape.com", name: "Clockwise Escape Room Boise", email: "info@clockwiseescape.com",
  phone: "(208) 555-0100", city: "Boise", region: "ID", calendar_vendor: null,
};
const copy = () => draftOttoCopy(op, "info@clockwiseescape.com");

test("the recording link is in the mail exactly once", () => {
  const c = copy();
  const otto = "https://onoutset.com/otto";
  assert.equal(c.body.split(otto).length - 1, 1, c.body);
  assert.ok(c.html.includes('<a href="' + otto + '">Hear the 42-second recording</a>'), c.html);
});

/** Body written by Harshil on 1 October 2026: one ask, reply yes, no call link. */
test("the body is Harshil's 1 October copy, named for the business, ending on a bold reply-yes ask", () => {
  const c = copy();
  assert.ok(c.body.includes("I built Otto, an AI front desk for local activity businesses like " + op.name + "."), c.body);
  assert.ok(c.body.includes("Here's a 42-second sample so you can hear what a call sounds like:"), c.body);
  assert.ok(c.body.includes("I can set up a version specifically for " + op.name + " in a day"), c.body);
  assert.ok(c.body.includes("before paying for anything."), c.body);
  assert.ok(c.body.includes("If you're interested, just reply yes and I'll put one together for you."), c.body);
  assert.ok(c.html.includes("just reply <b>yes</b> and"), c.html);
  assert.ok(!c.body.includes("cal.com"), "no call link in this version");
  assert.equal(c.variant, COPY_VERSION);
});

test("the vendor line names the booking system when known and stays generic when not", () => {
  assert.ok(copy().body.includes("\nOtto can work with your existing booking flow so reservations go into the same system you already use."), copy().body);
  const withVendor = draftOttoCopy({ ...op, calendar_vendor: "resova" }, "info@clockwiseescape.com");
  assert.ok(withVendor.body.includes("Since you use Resova, Otto can work with your existing booking flow"), withVendor.body);
});

test("no em dash, no exclamation mark, no shouty word, and the footer still carries unsubscribe and take-down", () => {
  const c = copy();
  assert.ok(!c.body.includes("—") && !c.html.includes("—"));
  assert.ok(!/!/.test(c.body), "no exclamation marks");
  assert.ok(!/\b[A-Z]{4,}\b/.test(c.body), "no shouty all-caps word");
  assert.ok(c.body.includes("/unsubscribe.html?t="), c.body);
  assert.ok(c.body.includes("#remove="), c.body);
});

test("an operator the site names no owner for is greeted plainly, never with a guessed name", () => {
  const c = copy();
  assert.ok(c.body.startsWith("Hi,\n"), c.body.slice(0, 40));
  assert.ok(c.html.startsWith('<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.55;color:#222"><p>Hi,</p>'), c.html.slice(0, 120));
});
