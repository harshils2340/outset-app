import { test } from "node:test";
import assert from "node:assert/strict";
import { draftOttoCopy, type OttoOp } from "../ottoDrafts.ts";
import { CALL_LINK } from "../drafts.ts";

const op: OttoOp = {
  id: "op-1", domain: "seabreezejetski.com", name: "Sea Breeze Jet Ski Rentals", email: "info@seabreezejetski.com",
  phone: "(727) 555-0100", city: "Clearwater", region: "FL", calendar_vendor: null,
};
const copy = () => draftOttoCopy(op, "info@seabreezejetski.com");

test("the recording link and the call link are both in the mail, each exactly once", () => {
  const c = copy();
  const otto = "https://onoutset.com/otto";
  assert.equal(c.body.split(otto).length - 1, 1, c.body);
  assert.equal(c.body.split(CALL_LINK).length - 1, 1, c.body);
  assert.equal(c.html.split(CALL_LINK).length - 1, 1, c.html);
  assert.ok(c.html.includes('<a href="' + otto + '">Hear the 42-second recording</a>'), c.html);
});

/** Added 25 September 2026 at Harshil's request: the "love to chat" line is a hyperlink to his Cal.com
 * page, with the overlay parameter he gave, and the plain-text version puts the URL on its own line. */
test("the call link is the 'love to chat' hyperlink, with the overlay parameter Harshil gave", () => {
  const c = copy();
  assert.equal(CALL_LINK, "https://cal.com/harshil-shah-7tkvs7/outset?overlayCalendar=true");
  assert.ok(c.html.includes("see how it would be set up for your business, <a href=\"" + CALL_LINK + "\">I'd love to chat</a>."), c.html);
  assert.ok(c.body.includes("I'd love to chat:\n" + CALL_LINK + "\nAnd if it's not a fit, even a one-line reply on why helps a lot."), c.body);
  assert.ok(c.html.includes("Give the demo a quick listen. If this could be helpful"), "the close opens with the listen ask");
  assert.ok(c.html.includes("</a>. And if it's not a fit, even a one-line reply on why helps a lot.</p>"), "the not-a-fit fallback closes the same paragraph");
  assert.ok(c.body.indexOf("free until it proves its value") < c.body.indexOf(CALL_LINK), "the offer comes before the ask");
  assert.ok(c.body.indexOf(CALL_LINK) < c.body.indexOf("one-line reply"), "the call ask comes before the not-a-fit fallback");
});

test("the vendor line is honest: named when known, generic when not, never a live-read claim", () => {
  assert.ok(copy().body.includes("Otto plugs right into whatever you already use"), copy().body);
  const withVendor = draftOttoCopy({ ...op, calendar_vendor: "fareharbor" }, "info@seabreezejetski.com");
  assert.ok(withVendor.body.includes("Since you use FareHarbor, Otto plugs right into it."), withVendor.body);
  assert.ok(!/reads your .* calendar/i.test(withVendor.body), withVendor.body);
});

test("no em dash, no exclamation mark, no shouty word, and the footer still carries unsubscribe", () => {
  const c = copy();
  assert.ok(!c.body.includes("—") && !c.html.includes("—"));
  assert.ok(!/!/.test(c.body), "no exclamation marks");
  assert.ok(!/\b[A-Z]{4,}\b/.test(c.body), "no shouty all-caps word");
  assert.ok(c.body.includes("/unsubscribe.html?t="), c.body);
});

test("an operator the site names no owner for is greeted plainly, never with a guessed name", () => {
  const c = copy();
  assert.ok(c.body.startsWith("Hi,\n"), c.body.slice(0, 40));
  assert.ok(c.html.startsWith('<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.55;color:#222"><p>Hi,</p>'), c.html.slice(0, 120));
});
