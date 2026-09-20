import { test } from "node:test";
import assert from "node:assert/strict";
import { fareharborShortname, readFareharbor } from "../widgets.ts";
import { withReplay } from "./fixtures/replay.ts";

// fixtures/fareharbor: Jetski Miami Rentals (jetskimiamirentals), 15 September 2026. Company, items, two calendar
// months, then one availability, one effective-sheets and one price-sheet call per item: 37 exchanges.

test("fareharborShortname reads the company from every FareHarbor link shape", () => {
  assert.equal(fareharborShortname("https://fareharbor.com/embeds/book/jetskimiamirentals/items/583877/?full-items=yes"), "jetskimiamirentals");
  assert.equal(fareharborShortname("https://fareharbor.com/jetskimiamirentals/"), "jetskimiamirentals");
  assert.equal(fareharborShortname("https://fareharbor.com/embeds/book/rocky-fork/"), "rocky-fork");
  assert.equal(fareharborShortname("https://fareharbor.com/api/v1/companies/x/"), null);
  assert.equal(fareharborShortname("https://fareharbor.com/embeds/"), null);
  assert.equal(fareharborShortname("https://xola.com/"), null);
  // A waiver link names the company in its query; the first path segment is the word "waivers".
  assert.equal(
    fareharborShortname("https://fareharbor.com/waivers?shortname=enrgkayaking&bookingUuid=ecf456fa-6872-445b-b601-9a7337b1e48e"),
    "enrgkayaking",
  );
  // A link to FareHarbor's own pages is not a shop at all.
  assert.equal(fareharborShortname("https://fareharbor.com/legal/privacy/"), null);
  assert.equal(fareharborShortname("https://fareharbor.com/"), null);
});

test("FareHarbor: Jetski Miami Rentals reads 33 priced rows from the price sheet, fees included", async () => {
  const { result: r, requests } = await withReplay("fareharbor", () => readFareharbor("jetskimiamirentals"));
  assert.ok(r, "reader returned null");
  assert.equal(r.vendor, "fareharbor");
  assert.equal(r.pages, 2);
  assert.equal(requests.length, 37);
  assert.equal(r.offerings.length, 33);

  const row = (name: string, detail: string | null) => {
    const o = r.offerings.find((x) => x.name === name && x.detail === detail);
    assert.ok(o, `missing ${name} / ${detail}`);
    return o;
  };
  // Customer types from the price sheet: label, online total to the cent, per person.
  const single = row("Jet Ski Rentals", "One Hour Jet Ski Rental • Single Rider");
  assert.equal(single.price, 135);
  assert.equal(single.unit, "person");
  assert.equal(single.duration, "1 - 3 hours");
  assert.equal(single.url, "https://fareharbor.com/embeds/book/jetskimiamirentals/items/583877/");
  assert.equal(single.desc, "Ages 14+ • 1 - 3 Hours • Get out on the water!");
  assert.equal(single.photos.length, 5);
  assert.equal(row("Jet Ski Rentals", "One hour pics and videos").price, 178.2);
  assert.equal(row("Jet Ski Rentals", "Two Hour Rental • One Jet Ski").price, 280.8);
  assert.equal(r.offerings.filter((o) => o.name === "Jet Ski Rentals").length, 5);
  // "Private" in the label sells the whole boat.
  const yacht = row("Yacht Rental bella vita 50 ft", "Two Hour Private Yacht Rental");
  assert.equal(yacht.price, 540);
  assert.equal(yacht.unit, "each");
  assert.equal(yacht.duration, "2 - 8 hours");
  assert.equal(row("Yacht Rental Navigator 55'", "Six Hour Private Yacht Rental").price, 1728);
  assert.equal(row("Package Deal: Boat ride , Jetski and ATV", "Single rider: Boat, Jetski and ATV").price, 194.4);
  assert.equal(row("Package Deal: Boat ride , Jetski and ATV", "Single rider: Boat, Jetski and ATV").duration, "2.5 hours");
  // A rate whose label is the item name is "Per person".
  assert.equal(row("Parasailing", "Per person").price, 129.6);
  assert.equal(row("Sling Shot Rentals", "Full Day Slingshot Rental").price, 324);
  // An unlisted item never appears; a gift card with no departure keeps a blank price.
  const gift = row("Gift Card", null);
  assert.equal(gift.price, null);

  assert.equal(r.company.currency, "USD");
  assert.equal(r.company.phone, "7862222039");
  assert.equal(r.company.email, "miamirentalsjetski@gmail.com");
  assert.equal(r.company.waiverUrl, "https://waiver.smartwaiver.com/w/");
  assert.match(r.company.cancellation || "", /^Customers will receive a full refund or credit with 48 hours notice/);
  assert.match(r.company.checkin || "", /All renters must be at 18 years of age/);

  assert.ok(r.requirements.includes("All renters must be at 18 years of age and provide proof of age."), JSON.stringify(r.requirements));
  assert.ok(r.policies.includes("Gift card sales are final and non-refundable."), JSON.stringify(r.policies));
  assert.ok(r.policies.includes("Customers will receive a full refund or credit with 48 hours notice of cancellation."));
  assert.ok(r.includes.length >= 1, "includes empty");
});
