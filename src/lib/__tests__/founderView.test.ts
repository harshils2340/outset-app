import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

import { adminWebsite } from "../admin";
import type { Unclaimed } from "../../data/types";

/**
 * The founder view, which is the fifth hash our own addresses carry and the one the browser-controls sweep
 * never opened: `#admin` flips a flag in this browser and a dashed "Website" chip appears on the feed card,
 * the home card, the listing page and the phone booking sheet. Guests never see it. Its whole promise is
 * "open the operator's website", so Harshil can hold a listing against the real site.
 *
 * A partner's product has no operator site. Its `src` is the marketplace, so the chip opened viator.com's
 * front door on every one of the 6,492 shipped partner rows and told him nothing about the product.
 */

const dir = new URL("../../../public/o/", import.meta.url);

test("a shop's own website is what the chip opens", () => {
  assert.equal(adminWebsite({ src: "tampabayjetski.com" }), "https://tampabayjetski.com/");
  assert.equal(adminWebsite({ src: "shop.com", contact: { website: "https://www.shop.com/book?a=1" } }), "https://www.shop.com/");
});

test("a map pin is not a website", () => {
  assert.equal(adminWebsite({ src: "osm-node-13123988657" }), null);
  assert.equal(adminWebsite({ src: "" }), null);
  assert.equal(adminWebsite({ src: "javascript:alert(1)" }), null);
});

test("a partner's product draws no website chip at all", () => {
  const product = { src: "viator.com", affiliate: { source: "viator", label: "Viator", url: "https://www.viator.com/tours/x" } };
  assert.equal(adminWebsite(product), null);
  // The marketplace domain on its own is still a domain: it is the affiliate row that decides, not the host.
  assert.equal(adminWebsite({ src: "viator.com" }), "https://viator.com/");
});

test("no shipped partner row offers the marketplace as the operator's website", () => {
  const offenders: string[] = [];
  let partners = 0;
  for (const f of readdirSync(dir)) {
    const j = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as Unclaimed;
    if (!j.affiliate) continue;
    partners++;
    const href = adminWebsite(j);
    if (href) offenders.push(j.id + " -> " + href);
  }
  assert.ok(partners > 1000, "the shipped catalog should still carry partner rows: " + partners);
  assert.deepEqual(offenders.slice(0, 10), []);
});
