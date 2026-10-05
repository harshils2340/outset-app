import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyText, classifyReply, subjectBusinesses } from "../bounceSweep.ts";
import { newestThread } from "../thread.ts";
import { draftOttoCopy, type OttoOp } from "../ottoDrafts.ts";
import { nameKeys } from "../touches.ts";

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

test("a reply is matched to its business by subject when it comes from an address we never wrote to", () => {
  assert.deepEqual(subjectBusinesses("Re: Missed calls at Escape 618"), ["escape 618"]);
  assert.deepEqual(subjectBusinesses("RE: Fwd: Missed calls at Puzzle Vault Rooms"), ["puzzle vault rooms"]);
  assert.deepEqual(subjectBusinesses("Re: Who answers Dixie Belle's phone after you close?"), ["dixie belle's", "dixie belle"]);
  assert.deepEqual(subjectBusinesses("Re: Who answers Capt Andy's phone after you close?"), ["capt andy's", "capt andy"], "a name already possessive is tried whole");
  assert.deepEqual(subjectBusinesses("Re: For Bane: Otto for Lock Chicago"), ["lock chicago"]);
  assert.deepEqual(subjectBusinesses("Re: [External] Missed calls at Escape 618"), ["escape 618"]);
  assert.deepEqual(subjectBusinesses("RE[2]: Missed calls at Escape 618"), ["escape 618"]);
  assert.deepEqual(subjectBusinesses("Your order has shipped"), []);
  assert.deepEqual(subjectBusinesses(""), []);
});

/**
 * The subject match only works if the index holds the name the subject actually carries. The pitch addresses
 * the business as `plainName(name)` and the pool holds the registry's spelling, so every name whose legal
 * suffix the copy drops has to be indexed both ways. 645 of the 46,324 operator listings are one.
 */
test("a reply naming the business as the pitch addressed it finds the business", () => {
  const op: OttoOp = {
    id: "op-1", domain: "x.com", name: "", email: "info@x.com", phone: "(208) 555-0100",
    city: "Tampa", region: "FL", calendar_vendor: null, family: "indoor",
  };
  for (const name of ["House of Clues, LLC", "Harbour Cruises Ltd", "Divers Incorporated", "Barrio Brewing Co", "Escape 618"]) {
    const subject = "Re: " + draftOttoCopy({ ...op, name }, "info@x.com").subject;
    const keys = nameKeys(name);
    const named = subjectBusinesses(subject);
    assert.ok(named.some((n) => keys.includes(n)), `a reply titled ${JSON.stringify(subject)} reaches none of ${JSON.stringify(keys)}`);
  }
});

test("the follow-up answers the newest email sent to that address", () => {
  const t = newestThread([
    { messageId: "<old@gmail.com>", subject: "Who answers X's phone after you close?", date: new Date("2026-09-27T14:00:00Z") },
    { messageId: "<new@gmail.com>", subject: "Missed calls at X", date: new Date("2026-10-03T14:00:00Z") },
    { subject: "no id", date: new Date("2026-10-04T14:00:00Z") },
  ]);
  assert.deepEqual(t, { messageId: "<new@gmail.com>", subject: "Missed calls at X" });
  assert.equal(newestThread([]), null);
});
