import { strict as assert } from "node:assert";
import test from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * What the concierge said to a guest the first time it was driven against a filled catalog and a real API.
 *
 * Everything in this folder before tonight read the planner against hand-shaped payloads. `demo-server.mts`
 * runs the concierge without Postgres, Stripe or a mail key, and `OUTSET_DB` points the catalog at a scratch
 * file, so on 6 October 2026 it was booted against a seeded Waterloo region and asked the things a guest
 * types. It answered "Where are you?" about a town it holds businesses in, named one of our own internal
 * reader ids on the card, said "1 businesses matched" on the screen, and put Canadian and American dollars in
 * one price range. Each of those was visible to a guest and none of them was visible to a test.
 *
 * No network: every booking link is left off, so nothing is asked for a feed and what is asserted is the
 * planner's own arithmetic and words.
 */

process.env.OUTSET_DB = join(mkdtempSync(join(tmpdir(), "outset-cglive-")), "catalog.db");
const { db, migrate } = await import("../../db/client.ts");
const { inferCategory } = await import("../../taxonomy/catalog.ts");
const { readIntent, plan, viaPhrase, vendorName } = await import("../plan.ts");
const { Trace } = await import("../session.ts");

const ESCAPE = inferCategory("escape room");
const BOWLING = inferCategory("bowling alley");

migrate();
for (const c of [ESCAPE, BOWLING]) {
  db.prepare("INSERT OR IGNORE INTO categories (id, family, label, icon_key, service_style, search_query) VALUES (?,?,?,?,?,?)")
    .run(c.id, "land", c.label, "escape", "slots", c.label);
}

let n = 0;
function shop(o: { name: string; city: string; region: string; country: "CA" | "US"; lat: number; lon: number; category: string; price?: number | null }): void {
  const id = "op-" + ++n;
  db.prepare(
    `INSERT INTO operators (id, domain, name, phone, lat, lon, city, region, country, category_id, icon_key, origin, review_count, rating, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, id + ".example.com", o.name, "+1 519 555 0100", o.lat, o.lon, o.city, o.region, o.country, o.category, "escape", "public_site", 50, 4.5, "now", "now");
  if (o.price != null) {
    db.prepare("INSERT INTO offerings (id, operator_id, name, price_cents, price_unit, confidence) VALUES (?,?,?,?,?,?)")
      .run(id + "-s", id, "The Room", o.price, "person", "site");
  }
}

// Waterloo, Ontario clears the floor of three. Kitchener, next door, holds two, and Guelph one.
shop({ name: "Escapology Waterloo", city: "Waterloo", region: "ON", country: "CA", lat: 43.4643, lon: -80.5204, category: ESCAPE.id, price: 3700 });
shop({ name: "Waterloo Axe", city: "Waterloo", region: "ON", country: "CA", lat: 43.4702, lon: -80.5261, category: BOWLING.id, price: 2499 });
shop({ name: "Waterloo Bowl", city: "Waterloo", region: "ON", country: "CA", lat: 43.4759, lon: -80.5401, category: BOWLING.id, price: 3000 });
shop({ name: "Adventure Rooms Kitchener", city: "Kitchener", region: "ON", country: "CA", lat: 43.4516, lon: -80.4925, category: ESCAPE.id, price: 4400 });
shop({ name: "Kitchener Locks", city: "Kitchener", region: "ON", country: "CA", lat: 43.4201, lon: -80.4612, category: ESCAPE.id, price: 3200 });
shop({ name: "Puzzle House Guelph", city: "Guelph", region: "ON", country: "CA", lat: 43.5448, lon: -80.2482, category: ESCAPE.id, price: null });
// Waterloo, Iowa: two businesses, so the Ontario one wins the floor and used to take the state with it.
shop({ name: "Cedar Valley Escapes", city: "Waterloo", region: "IA", country: "US", lat: 42.4928, lon: -92.3426, category: ESCAPE.id, price: 2800 });
shop({ name: "Blackhawk Escape", city: "Waterloo", region: "IA", country: "US", lat: 42.4999, lon: -92.3301, category: ESCAPE.id, price: 3100 });
// Windsor, Ontario and Detroit, Michigan: ten kilometres apart, one radius, two currencies.
shop({ name: "Windsor Escape Co", city: "Windsor", region: "ON", country: "CA", lat: 42.3149, lon: -83.0364, category: ESCAPE.id, price: 3500 });
shop({ name: "Riverside Puzzles", city: "Windsor", region: "ON", country: "CA", lat: 42.32, lon: -83.04, category: ESCAPE.id, price: 3900 });
shop({ name: "Ouellette Rooms", city: "Windsor", region: "ON", country: "CA", lat: 42.31, lon: -83.03, category: ESCAPE.id, price: 4200 });
// One bowling alley on its own, four hundred kilometres from everything else here, so a search reaches
// exactly one business and the count has to agree with its noun.
shop({ name: "Nickel City Lanes", city: "Sudbury", region: "ON", country: "CA", lat: 46.4917, lon: -80.993, category: BOWLING.id, price: 2600 });
shop({ name: "Detroit Lockworks", city: "Detroit", region: "MI", country: "US", lat: 42.3314, lon: -83.0458, category: ESCAPE.id, price: 6500 });

test("every vendor a reader can report is a phrase a guest can read, never one of our own ids", () => {
  /**
   * `LiveRead["vendor"]` is wider than the vendors `readerFor` routes to: `replay`, `agent` and `none` are
   * our own words. They went through `vendorName`, whose fallback hands back what it was given, so a card
   * read "Read from their replay calendar just now".
   */
  const src = readFileSync(new URL("../live.ts", import.meta.url), "utf8");
  const union = /vendor:\s*((?:\s*\|?\s*"[a-z]+")+)\s*;/.exec(src);
  assert.ok(union, "could not find the vendor union in live.ts");
  const members = [...union![1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
  assert.ok(members.length >= 15, "read only " + members.length + " vendors out of live.ts");
  for (const v of members) {
    const phrase = viaPhrase(v);
    if (phrase === null) {
      assert.equal(v, "none", v + " attributes the times to nothing");
      continue;
    }
    assert.ok(phrase.startsWith("their "), v + ": " + phrase);
    assert.ok(!new RegExp("\\b" + v + "\\b").test(phrase), v + " is printed as typed in the code: " + phrase);
  }
  assert.equal(viaPhrase("replay"), "their own booking page");
  assert.equal(viaPhrase("agent"), "their own booking page");
  assert.equal(viaPhrase("none"), null);
  assert.equal(viaPhrase("fareharbor"), "their FareHarbor calendar");
  assert.equal(vendorName("checkfront"), "Checkfront");
});

test("the Checkfront driver says Checkfront, which is what routed the shop to it", () => {
  // It reported `replay`, the word for an endpoint we sniffed off a shop's own page, although `readerFor`
  // had already identified the link as Checkfront and its own refusal says "That Checkfront account".
  const src = readFileSync(new URL("../drivers/checkfront.ts", import.meta.url), "utf8");
  assert.ok(!/vendor:\s*"replay"/.test(src), "the Checkfront reader still reports itself as a replay");
  assert.ok(/vendor:\s*"checkfront"/.test(src), "the Checkfront reader names no vendor at all");
});
test("a town we hold one or two businesses in is a place, not a reason to ask where they are", () => {
  // Measured in a live run: both of these came back "Where are you? A town or city is enough." and a list of
  // other towns, for towns we hold the coordinates of.
  for (const [sentence, town] of [["escape room in kitchener", "Kitchener"], ["escape room in guelph", "Guelph"]] as const) {
    const i = readIntent(sentence);
    assert.equal(i.city, town, sentence);
    assert.equal(i.region, "ON", sentence);
    assert.ok(i.point, sentence + " resolved a town with no point to search around");
  }
});

test("the floor on a town's size comes off after the region is read, not before it", () => {
  /**
   * Waterloo, Ontario clears three and Waterloo, Iowa does not, so the Iowa one was thrown away for being
   * the wrong state after the Ontario one had already won, leaving a state-wide search by review count.
   */
  const i = readIntent("escape room in waterloo iowa");
  assert.equal(i.city, "Waterloo");
  assert.equal(i.region, "IA");
  assert.ok(i.point && i.point.lat > 42 && i.point.lat < 43, "the Iowa Waterloo, not the Ontario one");
});

test("a sentence that names nowhere is still asked where, and a province is still not a town", () => {
  assert.equal(readIntent("escape room tonight").city, null);
  // The town that is the region word is still discarded, which is what keeps Ontario, California out.
  const i = readIntent("escape room in ontario");
  assert.equal(i.region, "ON");
  assert.notEqual(i.city, "Ontario");
});

test("a count in a line the guest reads agrees with its noun", async () => {
  const tr = new Trace();
  // Bowling near Sudbury reaches exactly one business, which is what used to print "1 businesses".
  await plan("bowling in sudbury", { trace: tr });
  const matched = tr.steps.filter((s) => s.kind === "catalog").map((s) => s.text);
  assert.ok(matched.some((t) => /^1 business matched$/.test(t)), matched.join(" | "));
  assert.ok(!matched.some((t) => /\b1 businesses\b/.test(t)), matched.join(" | "));

  const many = new Trace();
  await plan("escape room in kitchener", { trace: many });
  assert.ok(many.steps.some((s) => s.kind === "catalog" && /^[2-9] businesses matched$/.test(s.text)),
    many.steps.filter((s) => s.kind === "catalog").map((s) => s.text).join(" | "));
});

