import { test } from "node:test";
import assert from "node:assert/strict";
import { readXola, xolaSeller } from "../widgets.ts";
import { withReplay } from "./fixtures/replay.ts";

// fixtures/xola: seller 5ff8c239f5657f0aa32ee4e5 (a cycle-boat operator in Beach Haven, NJ), 15 September 2026.
// One exchange: GET https://xola.com/api/experiences?seller=<id>&limit=100.

test("xolaSeller reads the seller id, or the button id to resolve, from every Xola link shape", () => {
  assert.equal(xolaSeller("https://checkout.xola.com/index.html#seller/5ff8c239f5657f0aa32ee4e5/experiences/620ef13fe915bb46f91dfc6c"), "5ff8c239f5657f0aa32ee4e5");
  assert.equal(xolaSeller("https://checkout.xola.app/index.html#seller/5ff8c239f5657f0aa32ee4e5"), "5ff8c239f5657f0aa32ee4e5");
  assert.equal(xolaSeller("https://waivers-ui.xola.com/?sellerId=5ff8c239f5657f0aa32ee4e5"), "5ff8c239f5657f0aa32ee4e5");
  assert.equal(xolaSeller("https://x2-checkout.xola.app/?button=64a1b2c3d4e5f60718293a4b"), "button:64a1b2c3d4e5f60718293a4b");
  assert.equal(xolaSeller("https://gift-ui.xola.com/index.html#buttons/64a1b2c3d4e5f60718293a4b"), "button:64a1b2c3d4e5f60718293a4b");
  assert.equal(xolaSeller("https://checkout.xola.com/index.html#seller/not-an-id"), null);
  assert.equal(xolaSeller("https://fareharbor.com/embeds/book/x/"), null);
});

test("Xola: one row per price scheme, private tiers by party size, per-person public seats", async () => {
  const { result: r } = await withReplay("xola", () => readXola("5ff8c239f5657f0aa32ee4e5"));
  assert.ok(r, "reader returned null");
  assert.equal(r.vendor, "xola");
  assert.equal(r.pages, 1);
  assert.equal(r.offerings.length, 21);

  const row = (name: string, detail: string | null) => {
    const o = r.offerings.find((x) => x.name === name && x.detail === detail);
    assert.ok(o, `missing ${name} / ${detail}`);
    return o;
  };
  const july = row("4th of July Fireworks Cruise", "Private · 2.8 hours");
  assert.equal(july.price, 1299);
  assert.equal(july.unit, "/group");
  assert.equal(july.duration, "165 min");
  assert.equal(july.url, "https://checkout.xola.com/index.html#seller/5ff8c239f5657f0aa32ee4e5/experiences/620ef13fe915bb46f91dfc6c");
  assert.equal(july.photo, "https://xola.com/uploads/images/experiences/620ef13fe915bb46f91dfc6c/6398b13b7121124c80278d8e.jpg");
  // Tiered private prices: one row per party-size band, labelled the way the band reads.
  assert.equal(row("Private Cycle Boat Charter", "Private, up to 16 guests · 2 hours").price, 599);
  assert.equal(row("Private Cycle Boat Charter", "Private, 17 guests · 2 hours").price, 634);
  assert.equal(row("Private Cycle Boat Charter", "Private, 24+ guests · 2 hours").price, 879);
  assert.equal(r.offerings.filter((o) => o.name === "Private Cycle Boat Charter").length, 9);
  assert.equal(row("Private Sunset Charter", "Private, 20 guests · 2 hours").price, 885);
  // Public seats are per person; a lone scheme keeps only the duration as its label.
  const pub = row("Public Cycle Boat Charter", "2 hours");
  assert.equal(pub.price, 59);
  assert.equal(pub.unit, "each");
  assert.equal(row("Public Sunset Charter", "2 hours").price, 65);
  // Only the first row of an experience carries its description and photos.
  assert.equal(row("Private Cycle Boat Charter", "Private, 17 guests · 2 hours").desc, null);
  assert.equal(row("Private Cycle Boat Charter", "Private, 17 guests · 2 hours").photos.length, 0);

  assert.equal(r.company.currency, "USD");
  assert.match(r.company.cancellation || "", /^Trips must be canceled at least 7 days prior to the event date for a full refund/);
  assert.ok(r.requirements.includes("Public Cycle Boat Charter: minimum 2 guests per booking."), JSON.stringify(r.requirements));
  assert.ok(r.requirements.includes("Private Cycle Boat Charter: up to 24 guests."));
  assert.ok(r.requirements.includes("4th of July Fireworks Cruise: guests must show identification."));
  assert.ok(r.policies.length >= 1);
  assert.ok(r.includes.includes("Private Cycle Boat Charter includes coolers."), JSON.stringify(r.includes));
  assert.ok(r.includes.includes("Private Cycle Boat Charter does not include snacks, drinks, sweatshirt."));
});
