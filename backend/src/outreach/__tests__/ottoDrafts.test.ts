import { test } from "node:test";
import assert from "node:assert/strict";
import { COPY_VERSION, draftOttoCopy, type OttoOp } from "../ottoDrafts.ts";

const op: OttoOp = {
  id: "op-1", domain: "clockwiseescape.com", name: "Clockwise Escape Room Boise", email: "info@clockwiseescape.com",
  phone: "(208) 555-0100", city: "Boise", region: "ID", calendar_vendor: null,
};
const copy = (o: Partial<OttoOp> = {}) => draftOttoCopy({ ...op, ...o }, "info@clockwiseescape.com");

/**
 * The 2 October copy reached Gmail's Primary tab where the 1 October copy went to Promotions every time, and
 * what made the difference was length and tone. These pin the shape that earned Primary, so an edit that drifts
 * back toward a marketing email fails here before it fails in 100 inboxes.
 */
test("short: a question, the pain, what Otto does, one recording, an offer", () => {
  const c = copy();
  assert.equal(c.subject, "Missed calls at " + op.name);
  assert.ok(c.body.includes("When everyone at " + op.name + " is busy with guests or you've closed for the day, where do the calls go?"), c.body);
  assert.ok(c.body.includes("books with the next place that picks up"), c.body);
  assert.ok(c.body.includes("I built Outset, a 24/7 customer service line for your phone."), c.body);
  assert.ok(c.body.includes("answers only from your own company info"), "grounded: never makes anything up");
  assert.ok(c.body.includes("you only keep it if it books you a guest. Worth a quick reply?"), c.body);
  const beforeSignoff = c.body.split("\nHarshil\n")[0];
  assert.ok(beforeSignoff.split(/\s+/).length < 130, "the body before the sign-off stays a short note: " + beforeSignoff.split(/\s+/).length + " words");
  assert.equal(c.variant, COPY_VERSION);
});

test("the recording is the only link in the body, hyperlinked as a phrase in the html", () => {
  const c = copy();
  const otto = "https://onoutset.com/#call";
  assert.equal(c.body.split(otto).length - 1, 1, c.body);
  assert.ok(c.html.includes('<a href="' + otto + '">give it a listen</a>'), c.html);
  assert.equal((c.html.match(/<a /g) || []).length, 3, "recording, unsubscribe, take-down and nothing else");
  assert.ok(!/<img|<table|font-family/i.test(c.html), "no logo, no layout, no styling that reads as a newsletter");
});

test("the live-calendar claim is made only where Otto really reads the calendar", () => {
  assert.ok(copy({ calendar_vendor: "fareharbor" }).body.includes("tells the caller what's actually open and sends them the link to book that exact slot"));
  assert.ok(copy({ calendar_vendor: "fareharbor" }).body.includes("FareHarbor booking system"));
  for (const v of [null, "calendly", "resova"]) {
    const b = copy({ calendar_vendor: v }).body;
    assert.ok(!b.includes("actually open"), `${v}: no calendar claim it cannot back`);
    assert.ok(b.includes("takes the booking down for you"), b);
  }
});

test("still carries the postal address, unsubscribe, reply-no opt-out and the take-down, and no em dash", () => {
  const c = copy();
  assert.ok(c.body.includes("/unsubscribe.html?t="), c.body);
  assert.ok(c.body.includes("#remove="), c.body);
  assert.ok(c.body.includes('Reply "no" and I won\'t email again'), c.body);
  assert.ok(!c.body.includes("—") && !c.html.includes("—"));
  assert.ok(!/!/.test(c.body), "no exclamation marks");
});

test("an operator the site names no owner for is greeted plainly, never with a guessed name", () => {
  assert.ok(copy().body.startsWith("Hi,\n"), copy().body.slice(0, 40));
  assert.ok(draftOttoCopy(op, "x@y.com", { greet: "Ron" }).body.startsWith("Hi Ron,\n"));
});
