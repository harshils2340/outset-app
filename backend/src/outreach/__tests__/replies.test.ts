import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyText, classifyReply } from "../bounceSweep.ts";

const own = new Set(["harshils2340@gmail.com", "outset.founder@gmail.com", "hs20041230@gmail.com"]);
const ORIGINAL = "\n\n-------- Original Message --------\nHi, I'm Harshil. I built Otto, the AI front desk for local businesses like yours.";

// The three replies the sweep logged in its first week, as they arrived (29 September to 1 October 2026).
test("an unread-inbox notice with a plain Re: subject is automatic, and its named contact is kept", () => {
  const c = classifyReply({
    from: "info@fishobsession.com",
    subject: "Re: Who answers Ocean Obsession Deep Sea Fishing's phone after you close?",
    headers: "Return-Path: <fishobsession.com-info@fishobsession.com>",
    body: "Please note - This email doesn't get checked often. If you are in need of assistance right away please email: Mirela.c.morais@gmail.com Thank you, Management" + ORIGINAL,
    own,
  });
  assert.equal(c.auto, true);
  assert.equal(c.redirect, "mirela.c.morais@gmail.com");
});

test("a domain-retirement notice is automatic and points to the new address", () => {
  const c = classifyReply({
    from: "info@commisso.ca",
    subject: "Forwarding Email",
    headers: "Return-Path: <info@commisso.ca>",
    body: "<p>Hello, this domain will be removed in the near future and updated to a new domain. Please forward your email to leighann@commisso.ca. We thank-you for reaching out to Commisso Estate Winery.</p>",
    own,
  });
  assert.equal(c.auto, true);
  assert.equal(c.redirect, "leighann@commisso.ca");
});

test("a real owner's reply, sent base64-encoded, is human and readable", () => {
  const said = "Ok, we are not interested at this time.  Just installing Ring Central now and do not want to get things to complicated all at once.  Maybe check back in a year.";
  const raw = Buffer.from(said + "\r\n________________________________\r\nFrom: Harshil Shah <harshils2340@gmail.com>").toString("base64").replace(/(.{76})/g, "$1\r\n");
  const c = classifyReply({ from: "keith@dixiebellelhc.com", subject: "Re: Who answers Dixie Belle's phone after you close?", headers: "In-Reply-To: <x@mail.gmail.com>", body: raw, own });
  assert.equal(c.auto, false);
  assert.equal(c.redirect, null);
  assert.ok(c.text.startsWith("Ok, we are not interested at this time."), c.text);
  assert.ok(!c.text.includes("From: Harshil"), "the quoted original is cut off");
});

test("a person promising to follow up is never mistaken for an auto-reply", () => {
  for (const said of [
    "Hi Harshil, this sounds interesting. I will get back to you soon about pricing.",
    "Thanks for reaching out! Can you call me tomorrow? My cell is below.",
    "Yes. Our office manager is anna@example-escapes.com, she handles the phones.",
  ]) {
    const c = classifyReply({ from: "owner@example-escapes.com", subject: "Re: Otto", headers: "", body: said + ORIGINAL, own });
    assert.equal(c.auto, false, said);
    assert.equal(c.redirect, null, said);
  }
});

test("quoted-printable bodies decode", () => {
  assert.equal(bodyText("caf=C3=A9 =\r\nopen").trim(), "café open");
});

/**
 * The part's own Content-Transfer-Encoding is not fetched with it, so base64 is a guess from the text, and a
 * sentence written without punctuation is nothing but letters and spaces once the whitespace is squeezed
 * out. Three plausible bodies were being decoded as base64 into mojibake: the auto-reply phrases then matched
 * nothing, so an unread inbox was logged as a person, that business was retired from the campaign, and the
 * snippet in Harshil's alert was rubbish.
 */
test("a reply written without punctuation is read as the sentence it is, not decoded as base64", () => {
  for (const body of [
    "Hi thanks for the email I am away until Monday",
    "Thank you for reaching out we will get back to you shortly",
    "Yes please send me the details thanks",
  ]) {
    assert.equal(bodyText(body), body);
  }
});

/**
 * A quoted original carries punctuation of its own, which is what kept most replies readable; an
 * auto-responder that quotes nothing is the shape that broke, and it is the shape most of them have.
 */
test("an out of office with no punctuation and nothing quoted still counts as automatic", () => {
  const c = classifyReply({
    from: "info@example.com",
    subject: "Re: Who answers the phone after you close?",
    headers: "Return-Path: <info@example.com>",
    body: "Hi thanks for the email I am away until Monday",
    own,
  });
  assert.equal(c.auto, true);
});

test("a body that really is base64 is still decoded", () => {
  const text = "This is an automated reply, the inbox is not monitored.";
  assert.equal(bodyText(Buffer.from(text).toString("base64")), text);
});
