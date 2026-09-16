import { test } from "node:test";
import assert from "node:assert/strict";
import { readVallypro, vallyproRef } from "../vendors/vallypro.ts";
import { withReplay } from "./fixtures/replay.ts";

// fixtures/vallypro: FishWater Outfitters (charleston-flyfishing.com; book.vallypro.com/p/wwwfishwateroutfitterscom,
// trip 66fc93ccfd2e05899e7ec87d), 15 September 2026. Business lookup plus this month's and next month's departures:
// 3 exchanges. The /p/ booking pages are disallowed by robots.txt and never fetched.

const TRIP = "https://book.vallypro.com/p/wwwfishwateroutfitterscom/trips/66fc93ccfd2e05899e7ec87d";

test("vallyproRef reads the slug and trip ids, naming a trip from the operator's own link text", () => {
  assert.deepEqual(vallyproRef(TRIP), { slug: "wwwfishwateroutfitterscom", trips: [{ id: "66fc93ccfd2e05899e7ec87d", name: null }] });
  assert.deepEqual(vallyproRef("https://book.vallypro.com/p/reel-deal-charters-fl-llc"), { slug: "reel-deal-charters-fl-llc", trips: [] });
  assert.deepEqual(vallyproRef("https://vallypro.com/p/reel-deal/folders/66fc93ccfd2e05899e7ec87d"), { slug: "reel-deal", trips: [] });
  assert.deepEqual(vallyproRef(`<a href="${TRIP}" class="btn">Half Day Inshore</a> <a href="https://book.vallypro.com/p/wwwfishwateroutfitterscom/trips/66fc93ccfd2e05899e7ec87e">Book Now</a>`), {
    slug: "wwwfishwateroutfitterscom",
    trips: [{ id: "66fc93ccfd2e05899e7ec87d", name: "Half Day Inshore" }, { id: "66fc93ccfd2e05899e7ec87e", name: null }],
  });
  assert.equal(vallyproRef("https://vallypro.com/pricing"), null);
  assert.equal(vallyproRef("https://fareharbor.com/embeds/book/x/"), null);
});

test("VallyPro: FishWater Outfitters reads three trip lengths with base fares from the departure feed", async () => {
  const { result: r, requests } = await withReplay("vallypro", () => readVallypro(vallyproRef(TRIP)!));
  assert.ok(r, "reader returned null");
  assert.equal(r.vendor, "vallypro");
  assert.equal(r.pages, 3);
  assert.ok(requests.every((k) => /services\.vallypro\.com/.test(k)), requests.join("\n"));
  assert.deepEqual(r.offerings.map((o) => [o.name, o.detail, o.duration, o.price, o.unit]), [
    ["4-hour trip", "4 hours", "4 hours", 550, "/trip"],
    ["6-hour trip", "6 hours", "6 hours", 750, "/trip"],
    ["8-hour trip", "8 hours", "8 hours", 900, "/trip"],
  ]);
  assert.ok(r.offerings.every((o) => o.url === TRIP));
  assert.equal(r.company.currency, "USD");
  assert.equal(r.company.phone, "4065314219");
  assert.equal(r.company.email, "braden@fishwateroutfitters.com");
  assert.equal(r.company.cover, "https://vally.nyc3.digitaloceanspaces.com/business/66fc9195e8505f671dca96fd/image/80982d23-0c5f-44b2-a5a5-588cf389e50e");
  assert.match(r.company.cancellation || "", /^All charters are weather permitting/);
  assert.ok(r.policies.includes("All bookings require a 30% deposit to secure the date."), JSON.stringify(r.policies));
  assert.ok(r.policies.includes("A 30% deposit is charged when you book; the balance is due to the operator."));
  assert.ok(r.policies.includes("Online booking closes 12 hours before departure."));
  assert.deepEqual(r.requirements, []);
  assert.deepEqual(r.includes, []);
});
