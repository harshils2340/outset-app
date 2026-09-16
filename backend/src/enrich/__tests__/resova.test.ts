import { test } from "node:test";
import assert from "node:assert/strict";
import { readResova, resovaRef } from "../vendors/resova.ts";
import { withReplay } from "./fixtures/replay.ts";

// fixtures/resova: Twisted Limits, McHenry IL (twistedlimits.resova.us), 15 September 2026. The HTML shell (token and
// cookie), misc/init and the week's calendar: 3 exchanges.

test("resovaRef reads the shop host from links, iframes and scripts, most-mentioned host first", () => {
  assert.deepEqual(resovaRef("https://twistedlimits.resova.us/"), { host: "twistedlimits.resova.us" });
  assert.deepEqual(resovaRef("https://twistedlimits.resova.us/items/view/7"), { host: "twistedlimits.resova.us" });
  assert.deepEqual(resovaRef("https://escape.resova.com/booking"), { host: "escape.resova.com" });
  assert.deepEqual(resovaRef("//puzzled.resova.eu/"), { host: "puzzled.resova.eu" });
  assert.deepEqual(resovaRef('<script src="https://get.resova.us/widget.js"></script><a href="https://a.resova.us/">a</a><iframe src="https://b.resova.us/items"></iframe><a href="https://b.resova.us/items/view/1">b</a>'), { host: "b.resova.us" });
  assert.equal(resovaRef("https://get.resova.com/pricing"), null);
  assert.equal(resovaRef("https://www.resova.com/"), null);
  assert.equal(resovaRef("https://fareharbor.com/embeds/book/x/"), null);
});

test("Resova: Twisted Limits reads 7 rooms priced from this week's calendar with party-size details", async () => {
  const { result: r } = await withReplay("resova", () => readResova({ host: "twistedlimits.resova.us" }));
  assert.ok(r, "reader returned null");
  assert.equal(r.vendor, "resova");
  assert.equal(r.pages, 3);
  assert.equal(r.offerings.length, 7);
  assert.deepEqual(r.offerings.map((o) => o.name), ["Behind The Curtain", "The Passage", "Executive Disorder", "Eureka Escape Games", "Laser Tag Session", "Omega Hour", "Party Room Rental"]);

  const row = (name: string) => r.offerings.find((x) => x.name === name)!;
  const curtain = row("Behind The Curtain");
  assert.equal(curtain.detail, "1 to 8 players · from $17 each · private room");
  assert.equal(curtain.duration, "1 hour");
  assert.equal(curtain.price, 30);
  assert.equal(curtain.unit, "each");
  assert.equal(curtain.url, "https://twistedlimits.resova.us/items/view/7");
  assert.equal(curtain.photo, "https://d1p8ky4d0rkzp4.cloudfront.net/780x610/2HS5mSTnWt8mLO3yVGQh160917.png");
  assert.equal(curtain.desc, 'Book "Behind the Curtain" (8 player capacity)');
  const passage = row("The Passage");
  assert.equal(passage.detail, "4 to 8 players · from $24 each · private room");
  assert.equal(passage.duration, "90 min");
  assert.equal(passage.price, 30);
  assert.equal(row("Executive Disorder").detail, "4 to 8 players · from $15 each · private room");
  assert.equal(row("Eureka Escape Games").price, 25);
  assert.equal(row("Laser Tag Session").detail, "6 to 20 players · private room");
  assert.equal(row("Omega Hour").detail, "up to 6 players · private room");
  assert.equal(row("Party Room Rental").price, 30);

  assert.equal(r.company.currency, "USD");
  assert.equal(r.company.phone, "+18153318857");
  assert.equal(r.company.street, "3735 W Elm Street");
  assert.equal(r.company.city, "McHenry");
  assert.equal(r.company.region, "IL");
  assert.equal(r.company.postal, "60050");
  assert.equal(r.company.waiverUrl, null);
  assert.ok(r.requirements.includes("The Passage: minimum 4 players per booking."), JSON.stringify(r.requirements));
  assert.ok(r.requirements.includes("Laser Tag Session: minimum 6 players per booking."));
  assert.ok(r.requirements.includes("Ages 10 and up recommended."));
  assert.deepEqual(r.policies, ["Eureka Escape Games: groups larger than 8 book by phone."]);
  assert.equal(r.includes.length, 1);
  assert.match(r.includes[0], /^Features include: Ample space for 20\+ people/);
});
