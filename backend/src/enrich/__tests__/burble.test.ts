import { test } from "node:test";
import assert from "node:assert/strict";
import { burbleRef, readBurble } from "../vendors/burble.ts";
import { withReplay } from "./fixtures/replay.ts";

// fixtures/burble: dropzone 2943 (store.burblesoft.com/?dz_id=2943), 15 September 2026. store robots.txt (404), the
// store front, then one detail page per jump product: 6 exchanges.

test("burbleRef reads the dropzone id from booking, manifest and store links", () => {
  assert.deepEqual(burbleRef("https://bookings.burblesoft.com/index/2943/18"), { dz: 2943 });
  assert.deepEqual(burbleRef("https://bookings.burblesoft.com/2943/18"), { dz: 2943 });
  assert.deepEqual(burbleRef("https://dzm.burblesoft.com/jmp?dz_id=2943"), { dz: 2943 });
  assert.deepEqual(burbleRef("https://store.burblesoft.com/?dz_id=2943"), { dz: 2943 });
  assert.deepEqual(burbleRef('<a href="https://bookings.burblesoft.com/index/2943/18?ref=site">Book</a>'), { dz: 2943 });
  assert.deepEqual(burbleRef('<iframe src="https://dzm.burblesoft.com/jmp?amp;dz_id=2943"></iframe>'), { dz: 2943 });
  assert.equal(burbleRef("https://bookings.burblesoft.com/"), null);
  assert.equal(burbleRef("https://bookings.burblesoft.com/index/0/1"), null);
  assert.equal(burbleRef("https://fareharbor.com/embeds/book/x/"), null);
});

test("Burble: dropzone 2943 reads three tandem altitudes and a first-jump course from the gift store, money cards skipped", async () => {
  const { result: r, requests } = await withReplay("burble", () => readBurble({ dz: 2943 }));
  assert.ok(r, "reader returned null");
  assert.equal(r.vendor, "burblesoft");
  assert.equal(r.pages, 5);
  // The booking flow is disallowed by robots.txt and never fetched.
  assert.ok(requests.every((k) => !/bookings\.burblesoft\.com/.test(k)), requests.join("\n"));
  assert.equal(r.offerings.length, 4);
  assert.deepEqual(r.offerings.map((o) => [o.name, o.price, o.unit, o.detail]), [
    ["9,000' Tandem Skydive", 205, "each", null],
    ["13,000' Tandem Skydive", 265, "each", null],
    ["18,000' Tandem Skydive", 375, "each", null],
    ["Learn to Skydive - Ground School & 1st AFF Skydive", 385, "each", null],
  ]);
  assert.equal(r.offerings[0].url, "https://store.burblesoft.com/detail/gift_card/3");
  assert.equal(r.offerings[0].photo, "https://store.burblesoft.com/uploads/2943/Tandem_skydive2.png");
  assert.match(r.offerings[0].desc || "", /^An introductory tandem skydive from 9,000'/);
  assert.equal(r.company.currency, "USD");
  assert.ok(r.requirements.includes("Skydiver must be at least 18 years of age on the day of their skydive."), JSON.stringify(r.requirements));
  assert.ok(r.requirements.includes("Skydiver must be under 250lbs."));
  assert.ok(r.policies.includes("Gift certificates are transferable."), JSON.stringify(r.policies));
  assert.ok(r.policies.some((s) => /expire 12 months from date of purchase/.test(s)));
  assert.ok(r.includes.includes("Includes: A handwritten & signed jump certificate."), JSON.stringify(r.includes));
});
