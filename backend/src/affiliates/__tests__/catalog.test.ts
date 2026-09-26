import { test } from "node:test";
import assert from "node:assert/strict";
import { kindFor, notIncludedLine, toAffiliateItem, type AffiliateRow } from "../catalog.ts";
import { bestImages, bookingUrl, detailFields, durationText, isWhoCanGo, metroDestinations, type ViatorProduct } from "../viator.ts";

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
  assert.deepEqual(kindFor("Busch Gardens Tampa Bay Ticket"), { cat: "play", art: "themepark" }, "a park named without the words is not a garden");
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

/**
 * The API states every length in minutes and plenty of the products run for days. Written back in hours, a
 * four day Canadian Rockies tour reached a guest as "96 hours", a nine day CityPASS as "216 hours", and an
 * e-bike rental as "24 hours to 744 hours", which is a month: 218 shipped listings said one of those.
 */
test("a product that runs for days is counted in days, not in hours", () => {
  assert.equal(durationText({ productCode: "X", duration: { fixedDurationInMinutes: 1440 } }), "1 day");
  assert.equal(durationText({ productCode: "X", duration: { fixedDurationInMinutes: 2880 } }), "2 days");
  assert.equal(durationText({ productCode: "X", duration: { fixedDurationInMinutes: 12960 } }), "9 days");
  assert.equal(durationText({ productCode: "X", duration: { fixedDurationInMinutes: 44640 } }), "31 days");
  assert.equal(durationText({ productCode: "X", duration: { fixedDurationInMinutes: 5520 } }), "3.8 days");
  assert.equal(durationText({ productCode: "X", duration: { variableDurationFromMinutes: 1440, variableDurationToMinutes: 44640 } }), "1 day to 31 days");
  assert.equal(durationText({ productCode: "X", duration: { fixedDurationInMinutes: 870 } }), "14.5 hours", "under a day is untouched");
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

/* ---------- what the detail pass makes of a product's own sections ---------- */

/**
 * Every line below is a real one from a shipped `public/o/a-viator-*.json`, named by the listing it came from.
 * The first group is what Viator generates from its own fixed list of types; the second is what the operator
 * typed into the same bag, which is where the "Who can go" column filled up with tour apps and dress codes.
 */
test("a partner's additional info is sorted into who may come and what is true of the booking", () => {
  const who = [
    "Wheelchair accessible", // a-viator-100118p1
    "Infants are required to sit on an adult's lap", // a-viator-100118p4
    "Not recommended for travelers with poor cardiovascular health", // a-viator-102020p105
    "Travelers should have at least a moderate level of physical fitness", // a-viator-100118p1
    "A minimum of 2 people per booking is required", // a-viator-100118p1
    "Minimum drinking age is 21 years", // a-viator-11593p10
    "No minimum age required", // a-viator-128704p1
    "Children must be accompanied by an adult", // a-viator-100118p1
    "Games are recommended for ages 13 and up. Younger players are allowed, but some of the game content may be too difficult for them", // a-viator-175552p6
    "Please provide weights for all passengers when booking", // a-viator-3657p1
  ];
  for (const line of who) assert.ok(isWhoCanGo(line), `who can go: ${line}`);

  const notWho = [
    "Operates in all weather conditions, please dress appropriately", // a-viator-100118p1, 208 listings
    "Download in advance: Download the Tour Guide app by Action and tour while connected to Wi-Fi or a strong cellular signal.", // a-viator-102020p105
    "More ways to save: Choose a single tour, a nearby bundle, or access to 200+ tours.", // a-viator-102020p135
    "Works offline: Once downloaded, the tour works using GPS without Wi-Fi or cellular service.", // a-viator-102020p141
    "Dress code is smart casual", // a-viator-15064p2
    "What to Bring: Comfortable shoes and clothes, sun hat, sunglasses, sunscreen, cash, and drinks for hydration.", // a-viator-3643p10
    "Itineraries may change due to unforeseen issues such as flight arrival and departure times and road and weather conditions.", // a-viator-40048p36
  ];
  for (const line of notWho) assert.ok(!isWhoCanGo(line), `not who can go: ${line}`);
});

test("the detail keeps what a product excludes, and files its notes apart from its rules about the guest", () => {
  const fields = detailFields({
    inclusions: [{ typeDescription: "Local guide" }, { typeDescription: "Other", otherDescription: "Hotel pickup" }],
    exclusions: [{ typeDescription: "Gratuities" }, { typeDescription: "Other", otherDescription: "Lunch is not included" }],
    additionalInfo: [
      { type: "WHEELCHAIR_ACCESSIBLE", description: "Wheelchair accessible" },
      { type: "OPERATES_ALL_WEATHER", description: "Operates in all weather conditions, please dress appropriately" },
      { type: "OTHER", description: "Minimum drinking age is 21 years" },
      { type: "OTHER", description: "Dress code is smart casual" },
      { type: "CONFIRMATION", description: "Confirmation will be received at time of booking" },
    ],
    cancellationPolicy: { description: "For a full refund, cancel at least 24 hours before the scheduled departure time." },
    itinerary: { privateTour: true, maxTravelersInSharedTour: 12 },
  });
  assert.deepEqual(fields.includes, ["Local guide", "Hotel pickup"]);
  assert.deepEqual(fields.excludes, ["Gratuities", "Lunch is not included"]);
  assert.deepEqual(fields.requirements, ["Wheelchair accessible", "Minimum drinking age is 21 years"]);
  assert.deepEqual(fields.notes, ["Operates in all weather conditions, please dress appropriately", "Dress code is smart casual"]);
  assert.equal(fields.groupSize, 12);
  assert.equal(fields.privateTour, true);
});

test("an exclusion reaches a guest in the words both listing surfaces already strike through", () => {
  assert.equal(notIncludedLine("Gratuities"), "Gratuities (not included)");
  assert.equal(notIncludedLine("Hotel pickup and drop-off."), "Hotel pickup and drop-off (not included)");
  // A partner that says it in its own sentence keeps the sentence: "Lunch is not included (not included)" reads twice.
  assert.equal(notIncludedLine("Lunch is not included"), "Lunch is not included");
  assert.equal(notIncludedLine("Food and drinks are not provided"), "Food and drinks are not provided");
});

test("a listing publishes the product's own sections, not the copy an older detail pass left behind", () => {
  const item = toAffiliateItem({
    ...row,
    raw: JSON.stringify({
      detail: {
        inclusions: [{ typeDescription: "Local guide" }],
        exclusions: [{ typeDescription: "Gratuities" }],
        additionalInfo: [
          { type: "WHEELCHAIR_ACCESSIBLE", description: "Wheelchair accessible" },
          { type: "OTHER", description: "Dress code is smart casual" },
        ],
        cancellationPolicy: { description: "Cancel at least 24 hours before for a full refund." },
        // What the pass of 23 September wrote: every line of the bag under requirements, and no exclusions at all.
        fields: { includes: ["Local guide"], requirements: ["Wheelchair accessible", "Dress code is smart casual"], cancellation: "Cancel at least 24 hours before for a full refund." },
      },
    }),
  });
  assert.deepEqual(item.includes, ["Local guide", "Gratuities (not included)"]);
  assert.deepEqual(item.requirements, ["Wheelchair accessible"]);
  assert.deepEqual(item.policies, ["Dress code is smart casual"]);
});

test("a row whose detail is only the older copy still publishes it", () => {
  const item = toAffiliateItem({ ...row, raw: JSON.stringify({ detail: { fields: { includes: ["Local guide"], requirements: ["Wheelchair accessible"], cancellation: null } } }) });
  assert.deepEqual(item.includes, ["Local guide"]);
  assert.deepEqual(item.requirements, ["Wheelchair accessible"]);
  assert.equal(item.policies, undefined);
});

test("a row with no detail at all is still a listing", () => {
  const item = toAffiliateItem({ ...row, raw: null });
  assert.deepEqual(item.includes, []);
  assert.equal(item.requirements, undefined);
  assert.equal(item.policies, undefined);
});
