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

test("the concierge reads the same vendor out of a link as the catalog's own reader does", () => {
  /**
   * Two vendor tables ship: this one and `src/enrich/vendors.ts`, which the crawl and the live readers use.
   * Swept over all 1,664 booking links in `public/live-index.json` they disagreed on 28: this table had never
   * heard of `xola.app`, which is where 27 of the 54 Xola links live, and it read a FareHarbor waiver link as
   * a shop called "waivers". Each line below is a link we really ship.
   */
  for (const [url, vendor, account] of [
    ["https://x2-checkout.xola.app/flows/mvp?button=5e4c0d7b99368212cd009e38&view=grid", "xola", "5e4c0d7b99368212cd009e38"],
    ["https://gift.xola.app/#?button=66184802640795aa3a08269e&_=1739201417213", "xola", "66184802640795aa3a08269e"],
    ["https://checkout.xola.com/index.html#seller/5ff8c239f5657f0aa32ee4e5?openExternal=true", "xola", "5ff8c239f5657f0aa32ee4e5"],
    ["https://waivers-ui.xola.com/templates/5ffcba6148b605221d974d95/preview?sellerId=5bef3317cf8b9c5f2d8b45aa", "xola", "5bef3317cf8b9c5f2d8b45aa"],
    ["https://fareharbor.com/waivers?shortname=enrgkayaking&bookingUuid=ecf456fa-6872-445b-b601-9a7337b1e48e", "fareharbor", "enrgkayaking"],
    ["https://fareharbor.com/embeds/book/lostinalaskaadventures/items/?flow=373906", "fareharbor", "lostinalaskaadventures"],
    ["https://book.peek.com/s/9a1b2c3d-4e5f/abcdef", "peek", "9a1b2c3d-4e5f"],
    ["https://kitchenerescape.checkfront.site/reserve/", "checkfront", "kitchenerescape"],
  ] as const) {
    const hit = detectVendor(url);
    assert.equal(hit.vendor, vendor, url);
    assert.equal(hit.account, account, url);
  }
  // A shop on .resova.us is not sent to a .resova.com page that is not theirs.
  assert.equal(detectVendor("https://bricksescape.resova.us/").hostedUrl, "https://bricksescape.resova.us/");
});

test("a rule that finds the shop beats one that only saw the vendor's name", () => {
  /**
   * The first rule whose name appeared anywhere used to win outright, so a footer link to FareHarbor's privacy
   * page left a Peek shop with no feed and no hosted page.
   */
  const page = [
    '<a href="https://fareharbor.com/legal/privacy/">Privacy</a>',
    '<iframe src="https://book.peek.com/s/5f2d79af-0b93/62569e"></iframe>',
  ].join("\n");
  const hit = detectVendor(page);
  assert.equal(hit.vendor, "peek");
  assert.equal(hit.hostedUrl, "https://book.peek.com/s/5f2d79af-0b93");
  // With nothing else on the page, FareHarbor is still the honest answer, just without an account.
  const alone = detectVendor('<a href="https://fareharbor.com/legal/privacy/">Privacy</a>');
  assert.equal(alone.vendor, "fareharbor");
  assert.equal(alone.account, null);
});

test("a page with no booking vendor on it says so", () => {
  const hit = detectVendor("<html><body>Call us to book on 555 0100</body></html>");
  assert.equal(hit.vendor, "unknown");
  assert.equal(hit.account, null);
  assert.equal(hit.hasFeed, false);
});
