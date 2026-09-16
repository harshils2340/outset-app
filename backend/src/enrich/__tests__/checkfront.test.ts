import { test } from "node:test";
import assert from "node:assert/strict";
import { checkfrontRef, readCheckfront } from "../vendors/checkfront.ts";
import { withReplay } from "./fixtures/replay.ts";

// fixtures/checkfront: Rocky Fork Boat Rental, Ohio (rocky-fork-boat-rental.checkfront.com), 15 September 2026.
// robots.txt, /reserve/, the dated inventory JSON, then one POST /reserve/api/?call=rate per item: 20 exchanges.

test("checkfrontRef reads the account and any item or category filter from links and embeds", () => {
  assert.deepEqual(checkfrontRef("https://rocky-fork-boat-rental.checkfront.com/reserve"), { account: "rocky-fork-boat-rental", categoryIds: [], itemIds: [] });
  assert.deepEqual(checkfrontRef("https://navarrefamilywatersports.checkfront.com/reserve/?category_id=1,9&item_id=3,106"), { account: "navarrefamilywatersports", categoryIds: [1, 9], itemIds: [3, 106] });
  assert.deepEqual(checkfrontRef("new CHECKFRONT.Widget({host: 'navarrefamilywatersports.checkfront.com', category_id: '10,9', filter_item_id: '16,82'})"), { account: "navarrefamilywatersports", categoryIds: [10, 9], itemIds: [16, 82] });
  assert.deepEqual(checkfrontRef('<script src="//app.checkfront.com/lib/interface--0.js"></script><a href="https://rocky-fork-boat-rental.checkfront.com/reserve/">Book</a><iframe src="https://rocky-fork-boat-rental.checkfront.com/reserve/?inline=1"></iframe>'), { account: "rocky-fork-boat-rental", categoryIds: [], itemIds: [] });
  assert.equal(checkfrontRef("https://www.checkfront.com/pricing"), null);
  assert.equal(checkfrontRef("https://fareharbor.com/embeds/book/x/"), null);
});

test("Checkfront: Rocky Fork reads 14 pontoons and 3 paddle craft with hourly rates from the rate call", async () => {
  const ref = checkfrontRef("https://rocky-fork-boat-rental.checkfront.com/reserve")!;
  const { result: r, requests } = await withReplay("checkfront", () => readCheckfront(ref));
  assert.ok(r, "reader returned null");
  assert.equal(r.vendor, "checkfront");
  assert.equal(r.pages, 19);
  assert.equal(requests.filter((k) => k.startsWith("POST ")).length, 17);
  assert.equal(r.offerings.length, 17);

  const row = (name: string) => {
    const o = r.offerings.find((x) => x.name === name);
    assert.ok(o, `missing ${name}`);
    return o;
  };
  const boat1 = row("BOAT 1 - Sun Tracker Tan (G-Boat) 6 Person Pontoon");
  assert.equal(boat1.price, 60);
  assert.equal(boat1.unit, "/hr");
  assert.equal(boat1.duration, "2 hours");
  assert.equal(boat1.detail, "2 hours");
  assert.equal(boat1.url, "https://rocky-fork-boat-rental.checkfront.com/reserve/?item_id=5");
  assert.equal(boat1.photo, "https://storage.googleapis.com/cf-public-us/rocky-fork-boat-rental-118776/media/L5-1?t=1684600786462294");
  assert.match(boat1.desc || "", /^Seats 6 people, storage for your belongings/);
  assert.equal(row("BOAT 4 - 2023 Barletta (Black) 8 Person Pontoon").price, 80);
  assert.equal(row("BOAT 9 - Blue Double Decker (Baby Blue) 8 Person Pontoon").price, 120);
  assert.equal(row("BOAT 14 - Brown Double Decker (Tito) 18 Person Pontoon").price, 200);
  assert.equal(r.offerings.filter((o) => /Pontoon$/.test(o.name)).length, 14);
  assert.ok(r.offerings.filter((o) => /Pontoon$/.test(o.name)).every((o) => o.unit === "/hr"));
  const kayak = row("Old Town Single Kayak");
  assert.equal(kayak.price, 20);
  assert.equal(kayak.unit, "each");
  assert.equal(row("Old Town Double Kayak").price, 40);
  assert.equal(row("Paddle Board").price, 30);

  assert.equal(r.company.currency, "USD");
  assert.equal(r.company.cover, "https://storage.googleapis.com/cf-public-us/rocky-fork-boat-rental-118776/media/L5-1?t=1684600786462294");
  assert.equal(r.company.videoEmbed, null);
  assert.equal(r.requirements.length, 10);
  assert.ok(r.requirements.some((s) => /Boat operator must be 18 years of age or older and possess a valid Driver’s License or boater’s license\.$/.test(s)), JSON.stringify(r.requirements));
  assert.ok(r.includes.includes("Seats 6 people (this includes babies and children) Gas Included!"), JSON.stringify(r.includes));
  assert.ok(r.includes.includes("Tie down point for cable lock to secure boards included."));
  assert.deepEqual(r.policies, []);
});
