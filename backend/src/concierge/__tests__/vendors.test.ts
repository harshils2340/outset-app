import { strict as assert } from "node:assert";
import test from "node:test";
import { detectVendor } from "../vendors.ts";

/**
 * Who runs this shop's bookings, read off the shop's own page.
 *
 * The account id is the whole point of this module: it is what the hosted booking page is built from, and what
 * the agent opens instead of driving a widget inside somebody's WordPress theme. So the thing worth testing is
 * not "did we see the word checkfront" but "is the id we pulled out this shop's, or the vendor's own".
 */

test("the shop's own account is read out of the embed", () => {
  const fh = detectVendor('<iframe src="https://fareharbor.com/embeds/book/torontohelitours/?full-items=yes"></iframe>');
  assert.equal(fh.vendor, "fareharbor");
  assert.equal(fh.account, "torontohelitours");
  assert.equal(fh.hasFeed, true);

  const cf = detectVendor('<iframe src="https://adventureroomscanada.checkfront.com/reserve/"></iframe>');
  assert.equal(cf.vendor, "checkfront");
  assert.equal(cf.account, "adventureroomscanada");
  assert.equal(cf.hostedUrl, "https://adventureroomscanada.checkfront.com/reserve/");

  const bk = detectVendor('<script src="https://bookeo.com/widget.js?a=41575XY7NH416FC9478769"></script>');
  assert.equal(bk.account, "41575XY7NH416FC9478769");
  assert.equal(bk.hostedUrl, "https://bookeo.com/bookeo/b.html?a=41575XY7NH416FC9478769");
});

test("a link to the vendor's own site is not an account", () => {
  /**
   * Nearly every page a booking widget sits on also links back to the vendor: a powered-by badge, a help link,
   * a script on their CDN. Those read as an account id in exactly the shape a real one has, and the hosted page
   * built from one sent a guest to the vendor's marketing site instead of this shop's booking page.
   */
  const badge = detectVendor('<a href="https://www.checkfront.com/">Powered by Checkfront</a>');
  assert.equal(badge.vendor, "checkfront");
  assert.equal(badge.account, null);
  assert.equal(badge.hostedUrl, null);

  for (const host of ["support", "help", "blog", "api"]) {
    assert.equal(detectVendor(`https://${host}.rezdy.com/anything`).account, null, host + " is not a rezdy shop");
  }
  assert.equal(detectVendor("https://calendly.com/app/scheduled_events").account, null);
  assert.equal(detectVendor("https://fareharbor.com/help/").account, null);
});

test("the vendor's own link does not outrank the widget further down the page", () => {
  const page = [
    '<link rel="stylesheet" href="https://www.checkfront.com/assets/site.css">',
    '<p>Book below</p>',
    '<iframe src="https://kitchenerescape.checkfront.com/reserve/?category_id=3"></iframe>',
  ].join("\n");
  const hit = detectVendor(page);
  assert.equal(hit.account, "kitchenerescape");
  assert.equal(hit.hostedUrl, "https://kitchenerescape.checkfront.com/reserve/");
});

test("a page with no booking vendor on it says so", () => {
  const hit = detectVendor("<html><body>Call us to book on 555 0100</body></html>");
  assert.equal(hit.vendor, "unknown");
  assert.equal(hit.account, null);
  assert.equal(hit.hasFeed, false);
});
