import { test } from "node:test";
import assert from "node:assert/strict";
import { kindFor, toAffiliateItem, type AffiliateRow } from "../catalog.ts";
import { bestImages, bookingUrl, durationText, metroDestinations, type ViatorProduct } from "../viator.ts";

const row: AffiliateRow = {
  id: "a-viator-5010syd",
  source: "viator",
  product_code: "5010SYD",
  title: "Newport Beach Whale Watching Cruise",
  description: "Two hours on the water looking for whales and dolphins.",
  images: JSON.stringify(["https://media.tacdn.com/a.jpg", "https://media.tacdn.com/b.jpg"]),
  from_cents: 4500,
  currency: "USD",
  rating: 4.7,
  review_count: 1200,
  duration: "2 hours",
  destination_name: "Newport Beach",
  metro_id: "los-angeles",
  lat: 33.6,
  lon: -117.9,
  tags: "[]",
  booking_url: "https://www.viator.com/tours/Newport-Beach/x/d123-5010SYD?pid=P00012345&mcid=42383&medium=api",
  flags: JSON.stringify(["FREE_CANCELLATION"]),
  fetched_at: new Date().toISOString(),
};

test("a partner product becomes an ordinary listing that links out, and nothing an operator path touches", () => {
  const item = toAffiliateItem(row);
  assert.equal(item.id, "a-viator-5010syd");
  assert.equal(item.cat, "water");
  assert.equal(item.art, "cruise");
  assert.equal(item.from, 45);
  assert.equal(item.fc, "Free cancellation");
  assert.equal(item.cover, "https://media.tacdn.com/a.jpg");
  assert.equal(item.assistant, false);
  assert.deepEqual(item.affiliate, { source: "viator", label: "Viator", url: row.booking_url });
  assert.deepEqual(item.options, []);
  assert.ok(!("claimKey" in item), "no claim key on a partner product");
});

test("the kind is read from the title, specific before generic, tour when nothing matches", () => {
  assert.deepEqual(kindFor("Whale Watching Cruise"), { cat: "water", art: "cruise" });
  assert.deepEqual(kindFor("The Met Museum Skip-the-Line Ticket"), { cat: "culture", art: "museum" });
  assert.deepEqual(kindFor("Hot Air Balloon Ride at Sunrise"), { cat: "air", art: "balloon" });
  assert.deepEqual(kindFor("Small-Group Food Tour of the Mission"), { cat: "food", art: "tour" });
  assert.deepEqual(kindFor("Half-Day City Highlights"), { cat: "culture", art: "tour" });
});

test("images pick the variant nearest 720px wide and only https", () => {
  const p: ViatorProduct = {
    productCode: "X",
    images: [
      { variants: [{ url: "https://cdn/a-100.jpg", width: 100 }, { url: "https://cdn/a-720.jpg", width: 720 }, { url: "https://cdn/a-2000.jpg", width: 2000 }] },
      { variants: [{ url: "http://cdn/insecure.jpg", width: 720 }] },
    ],
  };
  assert.deepEqual(bestImages(p), ["https://cdn/a-720.jpg"]);
});

test("duration reads like a person wrote it", () => {
  assert.equal(durationText({ productCode: "X", duration: { fixedDurationInMinutes: 120 } }), "2 hours");
  assert.equal(durationText({ productCode: "X", duration: { fixedDurationInMinutes: 60 } }), "1 hour");
  assert.equal(durationText({ productCode: "X", duration: { fixedDurationInMinutes: 45 } }), "45 minutes");
  assert.equal(durationText({ productCode: "X", duration: { variableDurationFromMinutes: 120, variableDurationToMinutes: 180 } }), "2 hours to 3 hours");
  assert.equal(durationText({ productCode: "X" }), null);
});

test("the booking link is the API's own, and never a non-https one", () => {
  assert.equal(bookingUrl({ productCode: "X", productUrl: "https://www.viator.com/tours/x?pid=P1" }), "https://www.viator.com/tours/x?pid=P1");
  assert.equal(bookingUrl({ productCode: "X", productUrl: "http://www.viator.com/tours/x" }), null);
  assert.equal(bookingUrl({ productCode: "X" }), null);
});

test("each metro gets the nearest city destination, and a metro with none is skipped rather than guessed", () => {
  const map = metroDestinations([
    { destinationId: 1, name: "Tampa", type: "CITY", center: { latitude: 27.95, longitude: -82.46 } },
    { destinationId: 2, name: "St Petersburg", type: "CITY", center: { latitude: 27.77, longitude: -82.64 } },
    { destinationId: 3, name: "Florida", type: "STATE", center: { latitude: 27.95, longitude: -82.46 } },
    { destinationId: 4, name: "Reykjavik", type: "CITY", center: { latitude: 64.1, longitude: -21.9 } },
  ]);
  assert.equal(map.get("tampa")?.destinationId, 1, "the closest city, not the state that shares its centre");
  assert.equal(map.get("miami"), undefined, "no destination within 40 km of Miami in this list");
});
