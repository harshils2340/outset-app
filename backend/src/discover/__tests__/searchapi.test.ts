import { test } from "node:test";
import assert from "node:assert/strict";
import { categoryOfType, cityForMetro, citiesInScope, fromSerper, placeToOperator, planSearch, refineCategory, type Place } from "../searchapi.ts";
import { SEARCH_TERMS, termsForCategories, uncoveredCategories } from "../searchterms.ts";
import { CATEGORIES, METROS } from "../../taxonomy/catalog.ts";
import type { City } from "../cities.ts";

// Hand-written in the providers' shapes. Nothing here was fetched; the test never touches the network or the database.
const toronto: City = { name: "Toronto", region: "ON", country: "CA", lat: 43.65, lon: -79.38 };

/** Serper's /maps shape (camelCase, ratingCount, cid). */
const serperCooking = {
  title: "The Chef Upstairs",
  address: "516 Mt Pleasant Rd, Toronto, ON M4S 2M2, Canada",
  phoneNumber: "+1 416-544-9221",
  website: "https://www.thechefupstairs.com/?utm_source=google",
  rating: 4.8,
  ratingCount: 412,
  type: "Cooking school",
  types: ["Cooking school", "Culinary school"],
  latitude: 43.7017,
  longitude: -79.3886,
  cid: "1234567890123456789",
};

/** SerpApi and SearchApi google_maps shape (local_results entries). */
const serpapiPottery: Place = {
  title: "Clay Space Studio",
  address: "77 Sterling Rd, Toronto, ON M6R 2B7, Canada",
  gps_coordinates: { latitude: 43.6512, longitude: -79.4425 },
  rating: 4.9,
  reviews: 88,
  type: "Pottery classes",
  phone: "(416) 555-0142",
  website: "https://clayspace.ca/classes",
  place_id: "ChIJpottery0001",
};

test("every taxonomy category has at least one Google Maps term, and the original eight strings are untouched", () => {
  assert.deepEqual(uncoveredCategories(), []);
  const qs = new Set(SEARCH_TERMS.map((t) => t.q));
  for (const kept of ["jet ski rental", "pontoon boat rental", "inshore fishing charter", "sunset cruise", "tandem skydive", "helicopter tour", "hot air balloon ride", "parasail"]) {
    assert.ok(qs.has(kept), kept + " must stay so the cache under data/searchapi is still valid");
  }
  assert.equal(qs.size, SEARCH_TERMS.length, "a term must not be listed twice");
  const ids = new Set(CATEGORIES.map((c) => c.id));
  for (const t of SEARCH_TERMS) assert.ok(ids.has(t.categoryId), t.q + " maps to unknown category " + t.categoryId);
  for (const c of CATEGORIES) {
    const n = termsForCategories([c.id]).length;
    assert.ok(n >= 1 && n <= 3, c.id + " has " + n + " terms");
  }
});

test("a Serper cooking-school result becomes a cooking operator with city, region, country, site, phone, rating and reviews", () => {
  const out = placeToOperator(fromSerper(serperCooking), "cooking", toronto);
  assert.ok("row" in out, JSON.stringify(out));
  const r = out.row;
  assert.equal(r.name, "The Chef Upstairs");
  assert.equal(r.category_id, "cooking");
  assert.equal(r.family, "food");
  assert.equal(r.icon_key, "cooking");
  assert.equal(r.city, "Toronto");
  assert.equal(r.region, "ON");
  assert.equal(r.postal, "M4S 2M2");
  assert.equal(r.street, "516 Mt Pleasant Rd");
  assert.equal(r.country, "CA");
  assert.equal(r.website, "https://www.thechefupstairs.com/", "tracking query is stripped");
  assert.equal(r.domain, "thechefupstairs.com");
  assert.equal(r.phone, "+14165449221");
  assert.equal(r.rating, 4.8);
  assert.equal(r.review_count, 412);
  assert.equal(r.metro_id, "toronto");
  assert.equal(r.google_type, "Cooking school");
});

test("a SerpApi pottery result maps the same way, and a place with no website is kept under a gplace domain", () => {
  const out = placeToOperator(serpapiPottery, "pottery", toronto);
  assert.ok("row" in out);
  assert.equal(out.row.category_id, "pottery");
  assert.equal(out.row.family, "wellness");
  assert.equal(out.row.domain, "clayspace.ca");
  assert.equal(out.row.phone, "+14165550142");
  assert.equal(out.row.lat, 43.6512);

  const noSite = placeToOperator({ ...serpapiPottery, website: undefined }, "pottery", toronto);
  assert.ok("row" in noSite);
  assert.equal(noSite.row.website, null);
  assert.equal(noSite.row.domain, "gplace-ChIJpottery0001");

  const social = placeToOperator({ ...serpapiPottery, website: "https://www.instagram.com/clayspace" }, "pottery", toronto);
  assert.ok("row" in social);
  assert.equal(social.row.website, null, "a social page is not a website");
  assert.equal(social.row.domain, "gplace-ChIJpottery0001");
});

test("Google's type files a result under the right new category, even when the term was broader", () => {
  const typed = (type: string): Place => ({ title: "Some Place", type, address: "1 Front St, Toronto, ON M5J 2X5, Canada" });
  const cases: [string, string, string][] = [
    // [Google type, term category, expected category]
    ["Axe throwing", "axe", "axe"],
    ["Escape room center", "escape", "escape"],
    ["Go-kart track", "kart", "kart"],
    ["Rock climbing gym", "fitness", "climbing"],
    ["Boxing gym", "fitness", "martialarts"],
    ["Gym", "fitness", "fitness"],
    ["Brewery", "brewery", "brewery"],
    ["Winery", "winery", "winery"],
    ["Distillery", "distillery", "distillery"],
    ["Day spa", "spa", "spa"],
    ["Bowling alley", "bowling", "bowling"],
    ["Miniature golf course", "golf", "minigolf"],
    ["Golf course", "golf", "golf"],
    ["Pool hall", "swim", "billiards"],
    ["Swimming pool", "swim", "swim"],
    ["Trampoline park", "trampoline", "trampoline"],
    ["Comedy club", "theatre", "theatre"],
    ["Art museum", "museum", "museum"],
    ["Tour operator", "tour", "tour"],
    ["Yoga studio", "yoga", "yoga"],
    ["Dance school", "dance", "dance"],
    ["Karaoke bar", "karaoke", "karaoke"],
    ["ATV rental service", "motorsport", "motorsport"],
  ];
  for (const [type, term, want] of cases) {
    assert.equal(refineCategory(term, typed(type)), want, type);
    const out = placeToOperator(typed(type), term, toronto);
    assert.ok("row" in out, type + " must not be skipped: " + JSON.stringify(out));
    assert.equal(out.row.category_id, want, type);
  }
  assert.equal(categoryOfType({ title: "x", type: "Restaurant" }), null);
});

test("noise types still drop out unless the type names a category we file", () => {
  const skip = placeToOperator({ title: "Bass Pro Shops", type: "Sporting goods store", address: "Toronto, ON" }, "fishing", toronto);
  assert.ok("skip" in skip);
  const keep = placeToOperator({ title: "Lakeshore Yacht Club", type: "Yacht club", address: "Toronto, ON" }, "sailing", toronto);
  assert.ok("row" in keep);
  assert.equal(keep.row.category_id, "sailing");
  const park = placeToOperator({ title: "Rouge", type: "National park", address: "Toronto, ON" }, "garden", toronto);
  assert.ok("skip" in park);
});

test("a metro id resolves to the city string the cache was built with, and a plan counts cache hits without sending", () => {
  assert.deepEqual(cityForMetro("toronto"), toronto);
  assert.equal(cityForMetro("tampa")?.name, "Tampa");
  assert.equal(cityForMetro("niagara")?.name, "Niagara Falls");
  assert.equal(cityForMetro("nowhere"), null);
  assert.equal(citiesInScope({ metros: ["all"] }).length, METROS.length);
  assert.throws(() => citiesInScope({ metros: ["nowhere"] }));

  const plan = planSearch({ metros: ["toronto"], categories: ["heli", "cooking"] });
  assert.equal(plan.cities.length, 1);
  assert.equal(plan.terms.length, 4);
  assert.equal(plan.jobs.length, 4);
  assert.equal(plan.cached + plan.paid, 4);
  assert.equal(plan.costUsd.serper, Math.round(plan.paid * 0.1) / 100);
  const capped = planSearch({ metros: ["toronto"], budget: 5 });
  assert.equal(capped.paid, 5);
});
