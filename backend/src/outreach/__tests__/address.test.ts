import { test } from "node:test";
import assert from "node:assert/strict";
import { outreachAddress } from "../address.ts";

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
