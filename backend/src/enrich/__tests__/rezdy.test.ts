import { test } from "node:test";
import assert from "node:assert/strict";
import { readRezdy, rezdyRef } from "../vendors/rezdy.ts";

// Rezdy storefronts answer a Cloudflare 403 to plain clients (see vendors/rezdy.ts), so there is no recorded fixture.
// The parser is exercised against a small storefront written in the markup the module header documents: product
// cards on the root and a catalog page, and product pages with one <select data-price-...> per price option.

test("rezdyRef reads the tenant, a product code or a catalog id from links, and the most-mentioned tenant from HTML", () => {
  assert.deepEqual(rezdyRef("https://acmeparasail.rezdy.com/"), { shortname: "acmeparasail", productCode: null, catalogId: null, origin: "https://acmeparasail.rezdy.com", path: "/" });
  assert.deepEqual(rezdyRef("https://acmeparasail.rezdy.com/757013/vip-parasail-ride?lang=en"), { shortname: "acmeparasail", productCode: "757013", catalogId: null, origin: "https://acmeparasail.rezdy.com", path: "/757013/vip-parasail-ride" });
  assert.deepEqual(rezdyRef("https://acmeparasail.rezdy.com/productsCalendar/403318"), { shortname: "acmeparasail", productCode: "403318", catalogId: null, origin: "https://acmeparasail.rezdy.com", path: "/productsCalendar/403318" });
  assert.deepEqual(rezdyRef("https://acmeparasail.rezdy.com/catalog/75184/boats"), { shortname: "acmeparasail", productCode: null, catalogId: "75184", origin: "https://acmeparasail.rezdy.com", path: "/catalog/75184/boats" });
  assert.equal(rezdyRef("https://www.rezdy.com/pricing"), null);
  assert.equal(rezdyRef("https://api.rezdy.com/v1/products"), null);
  assert.equal(rezdyRef("https://fareharbor.com/embeds/book/x/"), null);
  const html = '<script src="https://widget.rezdy.com/pluginJs"></script><a href="https://other.rezdy.com/">x</a><iframe src="https://acmeparasail.rezdy.com/calendarWidget/757013"></iframe><a href="https://acmeparasail.rezdy.com/">book</a>';
  assert.deepEqual(rezdyRef(html), { shortname: "acmeparasail", productCode: "757013", catalogId: null, origin: "https://acmeparasail.rezdy.com", path: "/calendarWidget/757013" });
});

const ORIGIN = "https://acmeparasail.rezdy.com";

const card = (code: string, slug: string, name: string, blurb: string, duration: string, amount: string, img: string) => `
<div class="products-list-item">
  <div class="products-list-item-side"><a href="/${code}/${slug}"><img src="https://img.rezdy.com/PRODUCT_IMAGE/${img}_tb.jpg"></a></div>
  <div class="products-list-item-overview">
    <h2><a href="/${code}/${slug}">${name}</a></h2>
    <p>${blurb}</p>
    <ul><li><strong>Duration:</strong> ${duration}</li></ul>
    <span class="price" data-original-amount="${amount}" data-currency-base="USD">From USD $${amount}</span>
  </div>
</div>`;

const ROOT = `<html><body><nav><a href="/catalog/75184/boat-rentals">Boat Rentals</a></nav><div class="products-list">
${card("757013", "vip-parasail-ride", "VIP Parasail Ride", "Fly 500 feet above the bay with a friend.", "90 Minutes (approx.)", "150.00", "12345/parasail")}
${card("403318", "sunset-cruise", "Sunset Cruise", "Two hours on the water as the sun goes down.", "2 Hours (approx.)", "68.00", "12346/sunset")}
</div></body></html>`;

const CATALOG = `<html><body><div class="products-list">
${card("812001", "boat-rental-max-7-people", "Boat Rental (MAX 7 people)", "Take a 20&#039; Nauticstar out for a half or full day.", "4 Hours", "299.00", "12347/boat")}
</div></body></html>`;

const PARASAIL = `<html><body>
<div class="product-overview">
<h1>VIP Parasail Ride</h1>
<ul class="unstyled">
<li><strong>Duration:</strong> 90 Minutes (approx.)</li>
<li><strong>Product code:</strong> PARA1</li>
<li><strong>Location:</strong> Pier 39, San Francisco</li>
</ul></div>
<div class="product-main-image"><img src="https://img.rezdy.com/PRODUCT_IMAGE/12345/parasail_lg.jpg"><img src="https://img.rezdy.com/PRODUCT_IMAGE/12345/parasail_med.jpg"></div>
<!-- Description -->
<div class="product-description"><p>Guests must be at least 6 years old and weigh under 425 lbs combined. Cancellations less than 24 hours before departure are non-refundable. Includes a harness and a safety briefing.</p></div>
<div class="booking-form" data-currency-base="USD">
<select name="q1" data-price-type="ADULT" data-price="150.00" data-price-label="Adult" data-price-id="1" data-unit-label="Guests"></select>
<select name="q2" data-price-type="CHILD" data-price="42.45" data-price-label="Child (6-12)" data-price-id="2"></select>
<select name="q3" data-price-type="INFANT" data-price="0" data-price-label="Infant (under 6)" data-price-id="3"></select>
</div></body></html>`;

const BOAT = `<html><body>
<div class="product-overview">
<h1>Boat Rental (MAX 7 people)</h1>
<ul class="unstyled">
<li><strong>Duration:</strong> 4 Hours</li>
<li><strong>Product code:</strong> BOAT7</li>
</ul></div>
<div class="product-main-image"><img src="https://img.rezdy.com/PRODUCT_IMAGE/12347/boat_lg.jpg"></div>
<div class="product-description"><p>A valid boating license is required to rent. Gas is provided for the first tank.</p></div>
<div class="booking-form" data-currency-base="USD">
<select name="q1" data-price-type="QUANTITY" data-price="299.00" data-price-label="Half Day" data-price-id="10" data-unit-label="Rentals"></select>
<select name="q2" data-price-type="QUANTITY" data-price="499.00" data-price-label="Full Day" data-price-id="11"></select>
</div></body></html>`;

const PAGES: Record<string, string | null> = {
  [ORIGIN + "/robots.txt"]: "User-agent: *\nDisallow: /admin/\n",
  [ORIGIN + "/"]: ROOT,
  [ORIGIN + "/catalog/75184/boat-rentals"]: CATALOG,
  [ORIGIN + "/757013/vip-parasail-ride"]: PARASAIL,
  // The storefront will not serve this product page; the card is all that is known.
  [ORIGIN + "/403318/sunset-cruise"]: null,
  [ORIGIN + "/812001/boat-rental-max-7-people"]: BOAT,
};

test("Rezdy: the storefront's cards and product pages become one row per price option", async () => {
  const fetched: string[] = [];
  const fetchHtml = async (url: string) => {
    fetched.push(url);
    if (!(url in PAGES)) throw new Error("unexpected fetch " + url);
    return PAGES[url];
  };
  const r = await readRezdy(rezdyRef(ORIGIN + "/")!, { fetchHtml, pauseMs: 0 });
  assert.ok(r, "reader returned null");
  assert.equal(r.vendor, "rezdy");
  assert.equal(r.pages, 5);
  assert.deepEqual(fetched, [ORIGIN + "/robots.txt", ORIGIN + "/", ORIGIN + "/catalog/75184/boat-rentals", ORIGIN + "/757013/vip-parasail-ride", ORIGIN + "/403318/sunset-cruise", ORIGIN + "/812001/boat-rental-max-7-people"]);
  assert.deepEqual(r.offerings.map((o) => [o.name, o.detail, o.duration, o.price, o.unit]), [
    ["VIP Parasail Ride", "Adult", "1.5 hours", 150, "each"],
    ["VIP Parasail Ride", "Child (6-12)", "1.5 hours", 42.45, "each"],
    ["Sunset Cruise", "2 hours", "2 hours", 68, "each"],
    ["Boat Rental (MAX 7 people)", "Half Day", "4 hours", 299, "/boat"],
    ["Boat Rental (MAX 7 people)", "Full Day", "4 hours", 499, "/boat"],
  ]);
  const adult = r.offerings[0];
  assert.equal(adult.url, ORIGIN + "/757013/vip-parasail-ride");
  assert.equal(adult.desc, "Fly 500 feet above the bay with a friend.");
  // The largest rendition of each photo wins; the card thumbnail is a different URL and follows.
  assert.equal(adult.photo, "https://img.rezdy.com/PRODUCT_IMAGE/12345/parasail_lg.jpg");
  assert.deepEqual(adult.photos, ["https://img.rezdy.com/PRODUCT_IMAGE/12345/parasail_lg.jpg", "https://img.rezdy.com/PRODUCT_IMAGE/12345/parasail_tb.jpg"]);
  assert.equal(r.offerings[1].desc, null);
  assert.equal(r.offerings[1].photos.length, 0);
  assert.equal(r.offerings[2].photo, "https://img.rezdy.com/PRODUCT_IMAGE/12346/sunset_tb.jpg");
  assert.equal(r.company.currency, "USD");
  assert.deepEqual(r.requirements, ["Guests must be at least 6 years old and weigh under 425 lbs combined.", "A valid boating license is required to rent."]);
  assert.deepEqual(r.policies, ["Cancellations less than 24 hours before departure are non-refundable."]);
  assert.deepEqual(r.includes, ["VIP Parasail Ride: Infant (under 6) free.", "Includes a harness and a safety briefing.", "VIP Parasail Ride: meets in Pier 39, San Francisco.", "Gas is provided for the first tank."]);
});

test("Rezdy: a Cloudflare block on the root answers null rather than an empty menu", async () => {
  const fetchHtml = async () => "<html><head><title>Just a moment...</title></head><body>Sorry, you have been blocked</body></html>";
  assert.equal(await readRezdy(rezdyRef(ORIGIN + "/")!, { fetchHtml, pauseMs: 0 }), null);
});
