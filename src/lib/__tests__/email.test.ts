import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { contactEmail } from "../email";

/**
 * The address on file for a shop is how its owner proves the listing is theirs: the claim gate hashes it,
 * the claim screen shows a masked hint of it, and the dashboard prefills it as the inbox booking alerts go
 * to. 96 of the 14,746 listings that carry one carry something nobody could write to. Every line below is a
 * real one.
 */

test("an address a site hid from scrapers is still the address the shop published", () => {
  assert.equal(contactEmail("%53ere%6eew%61%74%65rsp%6frts@o%75t%6c%6f%6f%6b.c%6fm"), "Serenewatersports@outlook.com");
  assert.equal(contactEmail("i...@spih%65li%63op%74%65%72s.%63%6f%6d".replace("i...", "info")), "info@spihelicopters.com");
  assert.equal(contactEmail("info@charlestonpartycat.com%20"), "info@charlestonpartycat.com");
  assert.equal(contactEmail("mailto:Bookings@10torr.com"), "Bookings@10torr.com");
});

test("a template's own inbox is not the shop's", () => {
  // The 42 shops whose site was never finished: Wix ships "info@mysite.com" in the contact block.
  assert.equal(contactEmail("info@mysite.com"), null);
  assert.equal(contactEmail("info@company.com"), null);
  assert.equal(contactEmail("[email protected]"), null);
  assert.equal(contactEmail("hello@example.com"), null);
  assert.equal(contactEmail("6e1a2b3c4d@o123456.ingest.sentry.io"), null);
});

test("markup, a mask and an address with no house are not addresses", () => {
  assert.equal(contactEmail("<info@voyageraviation.com</big>"), null);
  assert.equal(contactEmail("info@********ng.com"), null);
  assert.equal(contactEmail("dave@goodwoodkartways.comclass=\"link\""), null);
  assert.equal(contactEmail("info@46.21.149.11"), null);
  assert.equal(contactEmail("kevin@48g9-.bybgnptut"), null);
  assert.equal(contactEmail("info@peggy'scoveboattours.com"), null);
  assert.equal(contactEmail("not an address"), null);
  assert.equal(contactEmail(""), null);
  assert.equal(contactEmail(null), null);
});

test("a sentence mark or a slash the crawl kept is not part of the address", () => {
  assert.equal(contactEmail("dbrown@brevardzoo.org."), "dbrown@brevardzoo.org");
  assert.equal(contactEmail("info@skyjump.com/"), "info@skyjump.com");
  assert.equal(contactEmail("k​evin@gmail.com​"), "kevin@gmail.com");
});

test("an ordinary address is left exactly as the shop wrote it", () => {
  assert.equal(contactEmail("BigRedBalloonAdventures@gmail.com"), "BigRedBalloonAdventures@gmail.com");
  assert.equal(contactEmail(" info@adventurecat.com "), "info@adventurecat.com");
  assert.equal(contactEmail("charter.concierge+tours@bluehawaiian.com"), "charter.concierge+tours@bluehawaiian.com");
});

test("every address shipped in the contacts file is one a guest's mail client would accept", () => {
  const src = "src/data/contacts.ts";
  if (!fs.existsSync(src)) return;
  const shipped = [...fs.readFileSync(src, "utf8").matchAll(/"email":"([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
  const unreadable = shipped.filter((e) => !contactEmail(e));
  // This once allowed one shipped placeholder ("[email protected]"); a later sync dropped it. The rule is what
  // matters, not the exception: nothing a mail client would choke on may ship, and a returning placeholder fails here.
  assert.deepEqual(unreadable, []);
});
