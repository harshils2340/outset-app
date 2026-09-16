import { test } from "node:test";
import assert from "node:assert/strict";
import { peekRef, peekTilePrice, readPeek } from "../widgets.ts";
import { withReplay } from "./fixtures/replay.ts";

// fixtures/peek: Dogpatch Paddle, San Francisco (key 2530f333-35eb-43fc-b661-6c7d3c95dfea, program LR2Jm), 15 September
// 2026. The hub, its child hubs and leaf programs (20 program pages), plus availability-dates and availability-times for
// the rental tickets with no catalog price: 34 exchanges.

test("peekRef reads the widget key and program code", () => {
  assert.deepEqual(peekRef("https://book.peek.com/s/2530f333-35eb-43fc-b661-6c7d3c95dfea/LR2Jm"), { key: "2530f333-35eb-43fc-b661-6c7d3c95dfea", code: "LR2Jm" });
  assert.deepEqual(peekRef("https://book.peek.com/s/2530f333-35eb-43fc-b661-6c7d3c95dfea/p_dqrrvx--7dbf6185-d61a-4423-be0e-c8d3b5f47177"), { key: "2530f333-35eb-43fc-b661-6c7d3c95dfea", code: "p_dqrrvx--7dbf6185-d61a-4423-be0e-c8d3b5f47177" });
  assert.deepEqual(peekRef("https://www.peek.com/s/2530f333-35eb-43fc-b661-6c7d3c95dfea/LR2Jm?ref=site"), { key: "2530f333-35eb-43fc-b661-6c7d3c95dfea", code: "LR2Jm" });
  assert.equal(peekRef("https://www.peek.com/san-francisco-ca/kayaking"), null);
  assert.equal(peekRef("https://book.peek.com/s/not-a-key/LR2Jm"), null);
});

test("peekTilePrice reads the price an operator typed on a tile", () => {
  assert.deepEqual(peekTilePrice("Paddle board rentals · from $40/hr"), { price: 40, unit: "/hr" });
  assert.deepEqual(peekTilePrice("Lessons · $124 per person"), { price: 124, unit: "each" });
  assert.deepEqual(peekTilePrice("Kayaks · $45"), { price: 45, unit: null });
  assert.equal(peekTilePrice("Kayak rentals"), null);
});

test("Peek: Dogpatch Paddle reads hourly rentals from the availability feed and per-ticket tours from the catalog", async () => {
  const { result: r } = await withReplay("peek", () => readPeek("2530f333-35eb-43fc-b661-6c7d3c95dfea", "LR2Jm"));
  assert.ok(r, "reader returned null");
  assert.equal(r.vendor, "peek");
  assert.equal(r.pages, 20);
  assert.equal(r.offerings.length, 39);

  const row = (name: string, detail: string | null) => {
    const o = r.offerings.find((x) => x.name === name && x.detail === detail);
    assert.ok(o, `missing ${name} / ${detail}`);
    return o;
  };
  // Rentals: blank catalog price, priced from the shortest bookable block per hour.
  const sup = row("SUP Rentals", "Adult SUP");
  assert.equal(sup.price, 40);
  assert.equal(sup.unit, "/hr");
  assert.equal(sup.duration, "2 hours to 5 hours");
  assert.equal(sup.url, "https://book.peek.com/s/2530f333-35eb-43fc-b661-6c7d3c95dfea/LR2Jm");
  assert.equal(sup.desc, "Beginner, Youth, Performance, and Dog Friendly");
  assert.equal(sup.photo, "https://www.filepicker.io/api/file/iPEHu6waTyKlv1X8r9rv");
  assert.equal(row("SUP Rentals", "Small Adult/Youth SUP").price, 32.5);
  assert.equal(row("SUP Rentals", "Child SUP (7+)").price, 20);
  assert.equal(row("Kayak Rentals", "11’6” Perception Tribe Single Kayak").price, 45);
  assert.equal(row("Kayak Rentals", "13’6” Perception Tribe Tandem Kayak").duration, "2 hours to 24 hours");
  // Tours: one row per ticket type with its catalog price, per person.
  const lesson = row("Learn to Paddle Board on the San Francisco Bay!", "Per Person, Including Paddle Board");
  assert.equal(lesson.price, 124);
  assert.equal(lesson.unit, "each");
  assert.equal(row("Tour the San Francisco Bay", "Per Person, Bring Your Own Tandem Kayak").price, 69);
  assert.equal(r.offerings.filter((o) => o.name === "Tour the San Francisco Bay").length, 5);
  assert.equal(row("Giants Game - Tandem Kayak Rental (Mission Creek)", "2 Hours - Tandem Kayak (For Two People)").price, 120);
  assert.equal(row("Private Lesson or Tour • SUP, Kayak or Surfski", "2 people · $185 each").price, 185);
  assert.equal(row("Sauna + Plunge | Public", "Guest").price, 35);
  // Retail tiles (gift cards, merchandise) never become services.
  assert.ok(!r.offerings.some((o) => /gift ?card/i.test(o.name)));

  assert.equal(r.company.aggregate, null);
  assert.ok(r.requirements.includes("10’6” Red Ride Inflatable SUP suitable for most adults over 5’3” and 110lbs."), JSON.stringify(r.requirements));
  assert.ok(r.requirements.includes("90 minutes · 5 people max · Ages 13+ · No experience needed."));
  assert.ok(r.includes.includes("2 Chairs Minimum Included with Table."));
  assert.deepEqual(r.policies, []);
});
