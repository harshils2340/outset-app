import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Who a shared host lets claim a listing.
 *
 * `ownDomain` turns a crawled host into "a domain this business owns", and the claim gate hands a signed
 * dashboard link to any address at one. The list of hosts it refuses covered the site builders and the mail
 * providers somebody had thought of, and 803 rows of the shipped claim index named one it had not: a shop's
 * page on booksy.com, setmore.com, yolasite.com, tripod.com or netlify.app, its listing on yelp.com,
 * eventbrite.com or expedia.com, or, worst, its whole row keyed by a consumer mail provider. Fourteen of
 * those rows publish no on-file address at all, so the domain was the only way in and anybody who could sign
 * up for a mailbox at aim.com, usa.com, 126.com, earthlink.net, rr.com or roadrunner.com could have had a
 * working claim link mailed to them for a real business.
 *
 * The rule reads the row rather than trusting it, so an index written by an earlier sync stops granting a
 * host this list now refuses without waiting for the next one.
 */

delete process.env.GITHUB_TOKEN;
process.env.STORE_DIR = mkdtempSync(join(tmpdir(), "outset-claim-shared-"));

const { ownDomain, ownDomains, claimRule, emailMayClaim } = await import("../claimIndex.ts");

/** One host per family, each read off a real row of the shipped index. */
const SHARED = [
  "booksy.com", "do-mothebarber.booksy.com", "setmore.com", "caddycruise.setmore.com",
  "acuityscheduling.com", "app.acuityscheduling.com", "vagaro.com", "m.vagaro.com", "schedulicity.com",
  "mindbodyonline.com", "clients.mindbodyonline.com", "bookeo.com", "fareharbor.com", "book.peek.com",
  "checkfront.com", "resova.us", "rezdy.com", "tripworks.com", "youcanbook.me", "calendly.com",
  "squareup.com", "app.squareup.com", "square.com",
  "yolasite.com", "springspa.yolasite.com", "tripod.com", "members.tripod.com", "angelfire.com",
  "webnode.com", "webnode.page", "jimdosite.com", "jimdofree.com", "simplesite.com", "myfreesites.net",
  "bravesites.com", "dudaone.com", "site123.me", "mystrikingly.com", "tumblr.com", "substack.com",
  "wpcomstaging.com", "wixstudio.com", "godaddy.com", "gem.godaddy.com",
  "netlify.app", "vercel.app", "web.app", "firebaseapp.com", "github.io", "herokuapp.com",
  "azurewebsites.net", "s3.amazonaws.com", "oledallasbrewery.com.s3-website-us-east-1.amazonaws.com",
  "yelp.com", "yelp.ca", "m.yelp.ca", "eventbrite.com", "eventbrite.ca", "groupon.com", "scheduler.groupon.com",
  "airbnb.com", "expedia.com", "classpass.com", "meetup.com", "nextdoor.com", "patch.com", "saline.patch.com",
  "t.co", "goo.gl", "maps.app.goo.gl", "photos.app.goo.gl", "g.page", "bio.link", "beacons.ai", "msha.ke",
  "linktree.com", "mailchi.mp", "campaign-archive.com",
  "aim.com", "usa.com", "mail.com", "126.com", "163.com", "qq.com", "mp.weixin.qq.com", "naver.com",
  "smartstore.naver.com", "free.fr", "aftitanic.free.fr", "earthlink.net", "home.earthlink.net", "rr.com",
  "roadrunner.com", "windstream.net", "frontiernet.net", "suddenlink.net", "home.suddenlink.net",
  "cableone.net", "cogeco.ca", "home.cogeco.ca", "videotron.ca", "ymail.com", "mac.com", "gmx.com",
  "zoho.com",
];

/** Hosts the old list already refused, which must keep being refused. */
const STILL_SHARED = ["wixsite.com", "shop.wixsite.com", "squarespace.com", "weebly.com", "gmail.com", "yahoo.ca", "hotmail.ca", "cox.net", "shaw.ca", "telus.net", "linktr.ee", "square.site", "sites.google.com"];

/** Real operator domains, which must keep the domain route they have always had. */
const OWN = ["sunsetwatersports.com", "book.sunsetwatersports.com", "skydivecity.com", "tombstone.beer", "clubpilates.com", "nysparks.com", "foothill.edu", "golfjoliet.com", "secretfoodtours.com", "iflyworld.com"];

test("a host nobody owns is nobody's domain", () => {
  for (const h of [...SHARED, ...STILL_SHARED]) assert.equal(ownDomain(h), null, h + " reads as a domain the business owns");
});

test("a word that merely ends in a shared host's name is still the shop's own", () => {
  // The rule is anchored on a dot or the start, so these are not the hosts above.
  for (const h of ["notyelp.com", "mybooksy.com", "freemail.com", "nottripod.com", "googleplex.com", "web.deals"]) {
    assert.equal(ownDomain(h), h, h + " was refused as a shared host");
  }
});

test("a real operator keeps its own domain and its subdomains", () => {
  for (const h of OWN) assert.equal(ownDomain(h), h, h + " lost its domain route");
  assert.equal(ownDomain("WWW.SunsetWatersports.com/book"), "sunsetwatersports.com");
});

test("ownDomains keeps the row's order, drops repeats and drops what nobody owns", () => {
  assert.deepEqual(ownDomains(["skydivecity.com", "booksy.com", "www.skydivecity.com", "", "shop.skydivecity.com"]), ["skydivecity.com", "shop.skydivecity.com"]);
  assert.deepEqual(ownDomains(["osm-way-123", "gmail.com"]), []);
  assert.deepEqual(ownDomains(null), []);
  assert.deepEqual(ownDomains(undefined), []);
});

test("a shipped row stops granting a shared host without waiting for the next sync", async () => {
  const { readFileSync } = await import("node:fs");
  const { dirname, join: j } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = dirname(fileURLToPath(import.meta.url));
  const idx = JSON.parse(readFileSync(j(here, "../../../../public/claim-index.json"), "utf8")) as Record<string, { k?: string; d?: string[] }>;
  const ids = Object.keys(idx);
  assert.ok(ids.length > 1000, "the shipped index should hold the catalog");
  // Named outright rather than taken from `ownDomain`, so this says what the file holds and not what the
  // rule happens to think of it: the rows below are granted by the index on disk and must not be granted by
  // the gate that reads it.
  const want = ["booksy.com", "setmore.com", "acuityscheduling.com", "vagaro.com", "yolasite.com", "tripod.com", "webnode.com", "webnode.page", "tumblr.com", "netlify.app", "vercel.app", "github.io", "patch.com", "eventbrite.com", "yelp.com", "squareup.com", "earthlink.net", "rr.com", "aim.com", "usa.com", "126.com", "airbnb.com", "expedia.com", "godaddy.com"];
  const shared = (d: string) => want.some((h) => d === h || d.endsWith("." + h));
  const stale = ids.filter((id) => (idx[id].d || []).some(shared));
  assert.ok(stale.length > 100, "the shipped index should still carry the stale rows: " + stale.length);
  let checked = 0;
  for (const id of stale.slice(0, 150)) {
    const granted = (idx[id].d || []).filter(shared);
    const rule = await claimRule(id);
    assert.ok(rule.known, id + " went unknown");
    for (const d of granted) {
      assert.ok(!rule.domains.includes(d), id + " still offers " + d);
      assert.equal((await emailMayClaim(id, "anyone@" + d)).ok, false, id + " is claimable from " + d);
      checked++;
    }
  }
  assert.ok(checked > 100, "too few rows checked: " + checked);
});

/**
 * The index is 33.8 MB and 423,187 rows, and it is read off a stream rather than parsed whole, because
 * parsing it retained 145 MB of heap and spiked resident memory to 262 MB on a 512 MB instance for the life
 * of the process, on the first call to a public route. What a stream can get wrong that a parse cannot is a
 * row that lands across a read boundary, so this walks the shipped file end to end and asks the gate about
 * every thousandth row, the first and the last among them.
 */
test("every row of the shipped index reads the same off the stream as it does out of a whole parse", async () => {
  const { readFileSync } = await import("node:fs");
  const { dirname, join: j } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = dirname(fileURLToPath(import.meta.url));
  const idx = JSON.parse(readFileSync(j(here, "../../../../public/claim-index.json"), "utf8")) as Record<string, { k?: string; d?: string[]; h?: string }>;
  const ids = Object.keys(idx);
  assert.ok(ids.length > 400000, "the shipped index should hold every operator row: " + ids.length);
  // Every row, not a sample: only about one row in twelve thousand lands across a 1 MB boundary, so a
  // sample is exactly the thing that would miss the one fault a stream can have that a parse cannot.
  let withEmail = 0;
  for (const id of ids) {
    const want = idx[id];
    const rule = await claimRule(id);
    assert.ok(rule.known, id + " is in the file and unknown to the gate");
    assert.equal(rule.hasEmail, !!want.k, id + " disagrees about an address on file");
    assert.equal(rule.hint, want.h || null, id + " disagrees about the masked hint");
    if (want.k) withEmail += 1;
  }
  // The domains are the half that hands out a dashboard, so they are read field by field on a spread sample.
  for (const id of ids.filter((_, i) => i % 1000 === 0)) assert.deepEqual((await claimRule(id)).domains, ownDomains(idx[id].d), id + " disagrees about the domains");
  assert.ok(withEmail > 100000, "the file should span rows with an address on file: " + withEmail);
});
