import { test } from "node:test";
import assert from "node:assert/strict";
import { looksPersonal, outreachAddress, ownerFirstName } from "../address.ts";

/**
 * Which address a claim email may go to. The claim index, the dashboard prefill and the sync were taught to
 * read a crawled address through `contactEmail`; the outreach draft, the one place that actually puts an
 * address in a To line, was still reading the raw column.
 */

const at = (email: string | null, domain = "theirshop.com") => outreachAddress({ email, domain });

test("the operator's own domain is who we write to", () => {
  assert.equal(at("info@theirshop.com"), "info@theirshop.com");
  assert.equal(at("Bookings@Theirshop.com"), "bookings@theirshop.com");
  assert.equal(at("info@mail.theirshop.com"), "info@mail.theirshop.com");
  assert.equal(at("captain@theirshop.com", "www.theirshop.com"), "captain@theirshop.com");
});

test("a personal mailbox is the owner, a partner's role inbox is not", () => {
  assert.equal(at("captainsteve@gmail.com"), "captainsteve@gmail.com");
  assert.equal(at("info@legoland.com"), null);
  assert.equal(at("sales@someagency.com"), null);
  assert.equal(at("t@aamp.agency"), null);
});

/** The 32 addresses a site hid from robots. Decoded they are deliverable, encoded they are a hard bounce. */
test("an address the site hid from scrapers is decoded, not mailed as written", () => {
  assert.equal(at("%69nfo@theirshop.com"), "info@theirshop.com");
  assert.equal(at("%73ere%6eew%61%74%65rsp%6frts@gmail.com"), "serenewatersports@gmail.com");
});

/** The 42 site templates. Nobody reads them and every one is a bounce against our own sending domain. */
test("a site template's placeholder inbox is never written to", () => {
  for (const e of ["info@mysite.com", "info@company.com", "hello@example.com", "owner@yourdomain.com"]) {
    assert.equal(at(e, e.split("@")[1]), null, e);
  }
});

test("what is not an address at all is not drafted to", () => {
  for (const e of [null, "", "   ", "info@", "@theirshop.com", "<info@theirshop.com</big>", "info@127.0.0.1", "i...@********ng.com"]) {
    assert.equal(at(e), null, JSON.stringify(e));
  }
});

test("punctuation the crawl kept on the end is dropped, not treated as a different address", () => {
  assert.equal(at("info@theirshop.com."), "info@theirshop.com");
  assert.equal(at("mailto:info@theirshop.com?subject=Hi"), "info@theirshop.com");
});

test("an operator with no domain gets no claim email, because there is no page to claim", () => {
  assert.equal(outreachAddress({ email: "someone@gmail.com", domain: "" }), null);
});

/**
 * 25 September 2026, Harshil: write to the owner or the manager, not booking@, whenever the site names one.
 * The owners crawl's mailboxes (facts owner_email) are ranked against the front desk; with none, the old
 * rule holds exactly.
 */
test("the owner's own mailbox beats the front desk when the site names one", () => {
  const op = { email: "hello@capitolboatclub.com", domain: "capitolboatclub.com" };
  assert.equal(outreachAddress(op), "hello@capitolboatclub.com");
  assert.equal(outreachAddress(op, ["ron@capitolboatclub.com"]), "ron@capitolboatclub.com");
  assert.equal(outreachAddress(op, ["Ron.Baker@CapitolBoatClub.com"]), "ron.baker@capitolboatclub.com");
  assert.equal(outreachAddress(op, ["mikereyes@gmail.com"]), "mikereyes@gmail.com", "a personal gmail is a person's phone, not a desk");
  assert.equal(outreachAddress(op, ["celebrationcruisesjsh@gmail.com"]), "hello@capitolboatclub.com", "a gmail named for the business is a desk like any other, and ties keep the front desk");
  assert.equal(outreachAddress(op, ["ron@capitolboatclub.com", "mike.reyes@gmail.com"]), "ron@capitolboatclub.com", "their own domain beats a gmail");
  assert.equal(outreachAddress({ email: "islandtimeparasail@gmail.com", domain: "islandtimeparasail.com" }, ["mike.reyes@gmail.com"]), "mike.reyes@gmail.com", "a person's gmail beats the shop's gmail");
});

test("the manager's or owner's own inbox beats a desk, and a named owner beats both", () => {
  const op = { email: "info@puzzlevaultrooms.com", domain: "puzzlevaultrooms.com" };
  assert.equal(outreachAddress(op, ["manager@puzzlevaultrooms.com"]), "manager@puzzlevaultrooms.com");
  assert.equal(outreachAddress(op, ["gm@puzzlevaultrooms.com"]), "gm@puzzlevaultrooms.com");
  assert.equal(outreachAddress(op, ["owner@puzzlevaultrooms.com"]), "owner@puzzlevaultrooms.com");
  assert.equal(outreachAddress(op, ["manager@puzzlevaultrooms.com", "dana@puzzlevaultrooms.com"]), "dana@puzzlevaultrooms.com", "a person's own mailbox first");
  assert.equal(outreachAddress({ email: "manager@puzzlevaultrooms.com", domain: "puzzlevaultrooms.com" }, ["dana@puzzlevaultrooms.com"]), "dana@puzzlevaultrooms.com");
  assert.equal(outreachAddress(op, ["manager@legoland.com"]), "info@puzzlevaultrooms.com", "somebody else's manager");
  assert.equal(ownerFirstName("manager@puzzlevaultrooms.com", ["Dana Price (owner)"]), null, "a role inbox opens with no name");
});

test("a crawl candidate that is junk or a stranger's never displaces the front desk", () => {
  const op = { email: "hello@capitolboatclub.com", domain: "capitolboatclub.com" };
  assert.equal(outreachAddress(op, ["619-1406capitolboatclub@gmail.com"]), "hello@capitolboatclub.com", "a phone number glued to an address");
  assert.equal(outreachAddress(op, ["director@yatespast.org", "info@legoland.com"]), "hello@capitolboatclub.com", "somebody else's inbox");
  assert.equal(outreachAddress(op, ["waivers@capitolboatclub.com"]), "hello@capitolboatclub.com", "one desk does not beat another");
  assert.equal(outreachAddress(op, ["paddlinginfo@capitolboatclub.com"]), "hello@capitolboatclub.com", "a desk word anywhere in the mailbox is a desk");
  assert.equal(outreachAddress({ email: "info@elusiveescaperooms.com", domain: "elusiveescaperooms.com" }, ["farskymediacompany@gmail.com"]), "info@elusiveescaperooms.com", "the web designer in the footer is not the owner");
  assert.equal(outreachAddress({ email: "info@escapethehouse.ca", domain: "escapethehouse.ca" }, ["corporate@escapethehouse.ca"]), "info@escapethehouse.ca", "an events desk is another desk");
  assert.equal(outreachAddress({ email: "info@shop.com", domain: "shop.com" }, ["jessphotography@gmail.com", "vincent@shop.com"]), "vincent@shop.com");
  assert.equal(outreachAddress(op, ["emailhello@capitolboatclub.com", "emailron@capitolboatclub.com", "ron@capitolboatclub.com"]), "ron@capitolboatclub.com", "a label the markup glued onto an address is dropped, not mailed");
  assert.equal(outreachAddress({ email: "info@shop.com", domain: "shop.com" }, ["emailinfo@shop.com"]), "info@shop.com");
  assert.equal(outreachAddress({ email: null, domain: "capitolboatclub.com" }, ["ron@capitolboatclub.com"]), "ron@capitolboatclub.com", "no front desk at all, the owner still counts");
});

test("a mailbox is a person only when it reads like one", () => {
  assert.equal(looksPersonal("ron@capitolboatclub.com", "capitolboatclub.com"), true);
  assert.equal(looksPersonal("patrick.ferro@montgomeryparks.org", "montgomeryparks.org"), true);
  assert.equal(looksPersonal("info@capitolboatclub.com", "capitolboatclub.com"), false);
  assert.equal(looksPersonal("paddlinginfo@sevenriverspaddling.com", "sevenriverspaddling.com"), false);
  assert.equal(looksPersonal("islandtimeparasail@gmail.com", "islandtimeparasail.com"), false);
  assert.equal(looksPersonal("captainsteve@gmail.com", "captainsteve.com"), false);
  assert.equal(looksPersonal("camdenharborcruises@gmail.com", "camdenharborcruises.com"), false);
});

test("the greeting name comes only from a mailbox that is that person's, by the site's own word", () => {
  assert.equal(ownerFirstName("ron@capitolboatclub.com", ["Ron Baker (owner)"]), "Ron");
  assert.equal(ownerFirstName("jeff.rogers@shop.com", ["Ann Lee (co-owner)", "Jeff Rogers (owner)"]), "Jeff");
  assert.equal(ownerFirstName("info@shop.com", ["Jeff Rogers (owner)"]), null, "a desk has no first name");
  assert.equal(ownerFirstName("jeffscharters@gmail.com", ["Jeff Rogers (owner)"]), null, "the business's mailbox, even with his name in it");
  assert.equal(ownerFirstName("ann@shop.com", ["Jeff Rogers (owner)"]), null, "somebody else's name is never used");
  assert.equal(ownerFirstName("ron@shop.com", ["the L. Caroline Underwood (owner)"]), null);
  assert.equal(ownerFirstName("ronald@shop.com", ["Ron Baker (owner)"]), null, "a prefix is not a match");
  assert.equal(ownerFirstName("capt.rayn@icloud.com", ["Capt Rayn (owner)"]), "Rayn", "a title is not a first name");
  assert.equal(ownerFirstName("rayn@shop.com", ["Captain Rayn Cole (owner)"]), "Rayn");
  assert.equal(ownerFirstName("capt@shop.com", ["Capt (owner)"]), null, "a bare title greets nobody");
});
