import { test } from "node:test";
import assert from "node:assert/strict";
import { candidateFromPlace, FIELD_MASK, locationBias, nearbyHitFromPlace, placesQueries, BIAS_RADIUS_M, type GooglePlace, type PlacesResponse } from "../places.ts";
import { METROS } from "../../taxonomy/catalog.ts";

/** Hand-written from the Text Search (New) reference example shape; no request was ever made for this. */
const sample: PlacesResponse = {
  places: [
    {
      id: "ChIJ_toronto_cooking_1",
      displayName: { text: "Dish Cooking Studio", languageCode: "en" },
      formattedAddress: "390 Dupont St, Toronto, ON M5R 1V9, Canada",
      addressComponents: [
        { longText: "390", shortText: "390", types: ["street_number"] },
        { longText: "Dupont Street", shortText: "Dupont St", types: ["route"] },
        { longText: "Toronto", shortText: "Toronto", types: ["locality", "political"] },
        { longText: "Ontario", shortText: "ON", types: ["administrative_area_level_1", "political"] },
        { longText: "Canada", shortText: "CA", types: ["country", "political"] },
        { longText: "M5R 1V9", shortText: "M5R 1V9", types: ["postal_code"] },
      ],
      websiteUri: "https://www.dishcookingstudio.com/",
      nationalPhoneNumber: "(416) 920-5559",
      rating: 4.7,
      userRatingCount: 312,
      location: { latitude: 43.6749, longitude: -79.4082 },
      primaryType: "cooking_school",
      types: ["cooking_school", "point_of_interest", "establishment"],
      businessStatus: "OPERATIONAL",
      regularOpeningHours: { openNow: true, weekdayDescriptions: ["Monday: 10:00 AM – 6:00 PM", "Tuesday: 10:00 AM – 6:00 PM"] },
    },
    {
      id: "ChIJ_no_site",
      displayName: { text: "Pop-Up Pasta Night" },
      formattedAddress: "Toronto, ON, Canada",
      location: { latitude: 43.65, longitude: -79.38 },
      businessStatus: "OPERATIONAL",
    },
    {
      id: "ChIJ_closed",
      displayName: { text: "Old Culinary School" },
      websiteUri: "https://oldculinary.example.com",
      businessStatus: "CLOSED_PERMANENTLY",
    },
    {
      id: "ChIJ_aggregator",
      displayName: { text: "Sushi Class Experience" },
      websiteUri: "https://www.tripadvisor.ca/AttractionProductReview-g155019-d1234",
      businessStatus: "OPERATIONAL",
    },
    {
      id: "ChIJ_social",
      displayName: { text: "Bake With Me" },
      websiteUri: "https://www.instagram.com/bakewithme",
      businessStatus: "OPERATIONAL",
    },
  ],
  nextPageToken: "AeCrKXs_next",
};

const toronto = METROS.find((m) => m.id === "toronto")!;
const q = { term: "cooking classes", category: "cooking", metro: toronto, text: "cooking classes in Toronto, ON" };

test("a place with a website maps to a candidate with every field we use", () => {
  const r = candidateFromPlace(sample.places![0], q);
  assert.ok("candidate" in r, "expected a candidate");
  const c = r.candidate;
  assert.equal(c.name, "Dish Cooking Studio");
  assert.equal(c.website, "https://www.dishcookingstudio.com/");
  assert.equal(c.domain, "dishcookingstudio.com");
  assert.equal(c.phone, "+14169205559");
  assert.equal(c.street, "390 Dupont Street");
  assert.equal(c.city, "Toronto");
  assert.equal(c.region, "ON");
  assert.equal(c.country, "CA");
  assert.equal(c.postal, "M5R 1V9");
  assert.equal(c.lat, 43.6749);
  assert.equal(c.lon, -79.4082);
  assert.equal(c.rating, 4.7);
  assert.equal(c.reviewCount, 312);
  assert.equal(c.placeId, "ChIJ_toronto_cooking_1");
  assert.equal(c.query, "cooking classes in Toronto, ON");
  assert.equal(c.kind, "cooking");
  assert.equal(c.activity, "cooking classes");
  assert.equal(c.source, "web");
  assert.equal(c.sourceUrl, "https://www.google.com/maps/place/?q=place_id:ChIJ_toronto_cooking_1");
  assert.deepEqual(c.hours, ["Monday: 10:00 AM – 6:00 PM", "Tuesday: 10:00 AM – 6:00 PM"]);
});

test("a place without a website is skipped, so are closed places and aggregator or social sites", () => {
  const reasons = sample.places!.slice(1).map((p) => candidateFromPlace(p, q));
  assert.deepEqual(reasons, [
    { drop: "no website" },
    { drop: "not operational" },
    { drop: "aggregator, directory or social host" },
    { drop: "aggregator, directory or social host" },
  ]);
});

test("missing address components fall back to the metro, and a bad phone stays as given", () => {
  const p: GooglePlace = { id: "x1", displayName: { text: "Somewhere Kitchen" }, websiteUri: "https://somewherekitchen.ca", nationalPhoneNumber: "ext 12" };
  const r = candidateFromPlace(p, q);
  assert.ok("candidate" in r);
  assert.equal(r.candidate.city, "Toronto");
  assert.equal(r.candidate.region, "ON");
  assert.equal(r.candidate.country, "CA");
  assert.equal(r.candidate.street, null);
  assert.equal(r.candidate.lat, null);
  assert.equal(r.candidate.rating, null);
  assert.equal(r.candidate.phone, "ext 12");
});

test("the field mask never asks for an Atmosphere-tier field and does ask for the website", () => {
  assert.ok(FIELD_MASK.includes("places.websiteUri"));
  assert.ok(FIELD_MASK.includes("nextPageToken"));
  for (const f of ["reviews", "editorialSummary", "generativeSummary", "servesBeer", "parkingOptions", "photos"]) assert.ok(!FIELD_MASK.includes(f), f);
});

test("the query grid is metro x term and a term filter matches by word or category", () => {
  const list = placesQueries({ metros: ["toronto"], terms: ["cooking"] });
  assert.deepEqual(list.map((x) => x.text), ["cooking classes in Toronto, ON"]);
  // food, walking, ghost, bike, segway and helicopter tours: the filter is a substring of the term or its category.
  assert.equal(placesQueries({ metros: ["toronto"], terms: ["tour"] }).length, 6);
  assert.throws(() => placesQueries({ metros: ["atlantis"] }), /unknown metro/);
});

test("Text Search is biased to a 40 km circle on the pin, the way Maps ranks near you", () => {
  assert.equal(BIAS_RADIUS_M, 40_000);
  assert.deepEqual(locationBias(43.4643, -80.5204), {
    circle: { center: { latitude: 43.4643, longitude: -80.5204 }, radius: 40_000 },
  });
  const kw = placesQueries({ metros: ["waterloo"], terms: ["karate"] });
  assert.deepEqual(kw.map((x) => x.text), ["karate in Waterloo, ON"]);
  assert.equal(kw[0].metro.lat, 43.46);
  assert.equal(kw[0].metro.lon, -80.52);
});

test("a live nearby hit keeps a named pin even without a website, and still drops directories", () => {
  const dojo: GooglePlace = {
    id: "ChIJ_kw_karate",
    displayName: { text: "Sealy's Karate" },
    formattedAddress: "Waterloo, ON, Canada",
    addressComponents: [
      { longText: "Waterloo", shortText: "Waterloo", types: ["locality", "political"] },
      { longText: "Ontario", shortText: "ON", types: ["administrative_area_level_1", "political"] },
    ],
    location: { latitude: 43.4643, longitude: -80.5204 },
    businessStatus: "OPERATIONAL",
  };
  const hit = nearbyHitFromPlace(dojo, toronto);
  assert.ok(hit);
  assert.equal(hit.name, "Sealy's Karate");
  assert.equal(hit.website, "");
  assert.equal(hit.lat, 43.4643);
  assert.equal(hit.city, "Waterloo");
  const yelp: GooglePlace = {
    ...dojo,
    id: "ChIJ_yelp",
    websiteUri: "https://www.yelp.ca/biz/sealys",
  };
  assert.equal(nearbyHitFromPlace(yelp, toronto), null);
});
