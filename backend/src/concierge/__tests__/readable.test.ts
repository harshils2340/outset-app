import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { readerFor, isReadable, unreadableSql } from "../readable.ts";
import { xolaRef } from "../readers/xola.ts";
import { squareRef } from "../readers/square.ts";
import { rezdyRef } from "../readers/rezdy.ts";
import { acuityRef } from "../readers/acuity.ts";
import { tripworksAccount } from "../readers/tripworks.ts";

/**
 * A link a reader can read, and the router would not send it.
 *
 * Five readers landed in one night and the three copies of "which vendors can we read" were written from the
 * vendor's marketing domain rather than from the shapes the readers themselves accept. The gap was not
 * theoretical: every one of the 27 `xola.app` links this catalog ships parses cleanly in `xolaRef` and was
 * routed to the browser agent, so a guest looking at Sky Pirate Parasail was told we had no feed for a shop
 * whose calendar we could have read in one call.
 *
 * These read the shipped corpus rather than a handful of hand-typed URLs, because that is where the
 * discrepancy lived: nothing hand-typed would have had the `.app` host in it.
 */

const SHIPPED: string[] = Object.values(
  JSON.parse(readFileSync(new URL("../../../../public/live-index.json", import.meta.url), "utf8")).urls as Record<string, string>,
);

test("every shipped booking link a reader's own parser accepts is routed to that reader", () => {
  const stranded: string[] = [];
  for (const url of SHIPPED) {
    const parsed =
      (xolaRef(url) && "xola") ||
      (squareRef(url)?.kind === "widget" || squareRef(url)?.kind === "page" ? "square" : null) ||
      (rezdyRef(url) && "rezdy") ||
      (acuityRef(url) && "acuity") ||
      (tripworksAccount(url) && "tripworks") ||
      null;
    if (!parsed) continue;
    if (readerFor(url) !== parsed) stranded.push(url);
  }
  assert.deepEqual(stranded, [], stranded.length + " shipped links parse but are not routed to their reader");
});

test("half of Xola lives on xola.app, and the router knows it", () => {
  // `vendors.ts` widened its own detection to `xola.(com|app)` and these three did not follow it.
  assert.equal(readerFor("https://x2-checkout.xola.app/flows/mvp?button=5e4c0d7b99368212cd009e38"), "xola");
  assert.equal(readerFor("https://checkout.xola.app/#buttons/678a84da6672b2d3f40ab4a0?cache=1760978201389"), "xola");
  assert.equal(readerFor("https://gift.xola.app/#buttons/5d9e16d28f231e5bce2818b8"), "xola");
  assert.equal(readerFor("https://checkout.xola.com/#buttons/5d9e16d28f231e5bce2818b8"), "xola");

  const app = SHIPPED.filter((u) => /xola\.app/i.test(u));
  assert.ok(app.length >= 20, "the shipped corpus still carries the .app links this is about: " + app.length);
  assert.deepEqual(app.filter((u) => readerFor(u) !== "xola"), []);
});

test("Square's Appointments profile page is readable and its storefront is not", () => {
  assert.equal(readerFor("https://squareup.com/appointments/book/rivga4vgg85qfq/LN0J87F6T53R6/start"), "square");
  assert.equal(readerFor("https://book.squareup.com/appointments/7edam4qdlxi81s/location/L0MK9A5HH4A0N"), "square");
  // The profile page: one hop from readable, and `squareRef` says so, so the router has to send it.
  assert.equal(readerFor("https://mysite.square.site/book/0B3MPEAG89AR7/sunstate-charters"), "square");
  assert.equal(readerFor("https://square.site/appointments/book/L0MK9A5HH4A0N/some-shop"), "square");
  // Not a calendar: a storefront, a payment link and a checkout.
  assert.equal(readerFor("https://blissful-zen-healing.square.site/"), null);
  assert.equal(readerFor("https://square.link/u/AbCdEf12"), null);
  assert.equal(readerFor("https://checkout.square.site/merchant/ML1234/checkout/ABC"), null);
});

test("Acuity's own host, Squarespace's two spellings of it, and the short link", () => {
  assert.equal(readerFor("https://app.acuityscheduling.com/schedule.php?owner=12345"), "acuity");
  assert.equal(readerFor("https://app.squarespacescheduling.com/schedule.php?owner=12345"), "acuity");
  assert.equal(readerFor("https://app.squarespace-scheduling.com/schedule.php?owner=12345"), "acuity");
  assert.equal(readerFor("https://shop.as.me/lesson"), "acuity");
  // "square" is inside "squarespacescheduling", so the Square rule must not claim an Acuity link.
  assert.notEqual(readerFor("https://app.squarespacescheduling.com/schedule.php?owner=1"), "square");
});

test("a shop with no booking system at all is not readable", () => {
  assert.equal(readerFor(null), null);
  assert.equal(readerFor(""), null);
  assert.equal(isReadable("https://someshop.com/book-now"), false);
  assert.equal(isReadable("https://bookeo.com/stlouisescape"), false, "Bookeo has no reader; see readers/bookeo.ts");
});

test("the SQL twin of the list names every vendor the regexes do", () => {
  const sql = unreadableSql("booking");
  for (const vendor of ["fareharbor", "resova", "peek.com", "checkfront", "xola.", "rezdy.com", "tripworks.", "square.site/%book/", "acuityscheduling"]) {
    assert.ok(sql.includes(`booking NOT LIKE '%${vendor}%'`), vendor + " is missing from the ordering");
  }
  // It is pasted into a query, so it must not carry a quote of its own.
  assert.equal(sql.includes('"'), false);
  assert.equal(sql.split("'").length % 2, 1, "unbalanced quotes would break every shortlist query");
});
