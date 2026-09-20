import { strict as assert } from "node:assert";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The sentence reader and the shortlist, against a catalog small enough to read.
 *
 * The real catalog is a 400,000 row SQLite file that is not in a checkout, so this builds a handful of shops
 * in a scratch database instead: two towns of the same name in different places, a town whose province the
 * guest also typed, and a shop with a feed sitting beside one without. That is enough to hold the rules that
 * decide where a guest is taken, which is where a wrong answer costs a booking.
 */

process.env.OUTSET_DB = join(mkdtempSync(join(tmpdir(), "outset-concierge-")), "catalog.db");
const { db, migrate } = await import("../../db/client.ts");
const { inferCategory } = await import("../../taxonomy/catalog.ts");
const { readIntent, candidates, windowFor, priceOf } = await import("../plan.ts");

const ESCAPE = inferCategory("escape room");
const BOAT = inferCategory("boat tour");

migrate();
for (const c of [ESCAPE, BOAT]) {
  db.prepare("INSERT OR IGNORE INTO categories (id, family, label, icon_key, service_style, search_query) VALUES (?,?,?,?,?,?)")
    .run(c.id, "land", c.label, "escape", "slots", c.label);
}

let n = 0;
function shop(o: {
  name: string; city: string; region: string; lat: number; lon: number; category: string;
  reviews?: number; booking?: string; phone?: string; services?: [string, number | null][];
}): string {
  const id = "op-" + ++n;
  db.prepare(
    `INSERT INTO operators (id, domain, name, phone, lat, lon, city, region, country, category_id, icon_key, origin, review_count, rating, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, id + ".example.com", o.name, o.phone ?? null, o.lat, o.lon, o.city, o.region,
    o.region.length === 2 && "ON QC BC AB".includes(o.region) ? "CA" : "US",
    o.category, "escape", "public_site", o.reviews ?? 10, 4.7, "now", "now");
  if (o.booking) {
    db.prepare("INSERT INTO facts (id, operator_id, fact_key, fact_value, confidence) VALUES (?,?,?,?,?)")
      .run("f-" + n, id, "booking_url", o.booking, "site");
  }
  (o.services || []).forEach(([name, cents], i) => {
    db.prepare("INSERT INTO offerings (id, operator_id, name, price_cents, price_unit, confidence) VALUES (?,?,?,?,?,?)")
      .run(`${id}-s${i}`, id, name, cents, "person", "site");
  });
  return id;
}

// Kitchener and Waterloo are one place to anyone living there; Toronto is a hundred kilometres away.
shop({ name: "Adventure Rooms", city: "Kitchener", region: "ON", lat: 43.45, lon: -80.49, category: ESCAPE.id, reviews: 120,
  services: [["Escape room, per person", 2800], ["School Trip 24-50 students", 2500], ["Private hire, whole room", 45000]] });
shop({ name: "Locked Kitchener", city: "Kitchener", region: "ON", lat: 43.44, lon: -80.5, category: ESCAPE.id, reviews: 60 });
shop({ name: "Escape Waterloo", city: "Kitchener", region: "ON", lat: 43.47, lon: -80.52, category: ESCAPE.id, reviews: 40 });
// Toronto has far more reviews, which is exactly how it used to win a search for Kitchener.
for (const name of ["Casa Loma Escape", "Escape Games Toronto", "Riddle Room"]) {
  shop({ name, city: "Toronto", region: "ON", lat: 43.65, lon: -79.38, category: ESCAPE.id, reviews: 4000 });
}
// Ontario, California: the town a search for the province used to land on.
for (const name of ["Ontario Escape", "Inland Empire Rooms", "Ontario Mills Escape"]) {
  shop({ name, city: "Ontario", region: "CA", lat: 34.06, lon: -117.6, category: ESCAPE.id, reviews: 900 });
}
// Two Vancouvers, one in each country.
for (const name of ["Burrard Boat Tours", "Coal Harbour Cruises", "Stanley Park Sail"]) {
  shop({ name, city: "Vancouver", region: "BC", lat: 49.28, lon: -123.12, category: BOAT.id, reviews: 800 });
}
for (const name of ["Columbia River Tours", "Fort Vancouver Cruises", "Ruby Junction Boats"]) {
  shop({ name, city: "Vancouver", region: "WA", lat: 45.63, lon: -122.67, category: BOAT.id, reviews: 30 });
}
// Vail: a town whose name is also the last four letters of an ordinary English word.
for (const name of ["Vail Escape Room", "Mountain Time Escape", "Frisco Escape"]) {
  shop({ name, city: "Vail", region: "CO", lat: 39.64, lon: -106.37, category: ESCAPE.id, reviews: 50 });
}

test("naming the province as well as the town keeps the town", () => {
  /**
   * People write a place the way they write an address. Reading the province and then dropping the town
   * searched the whole of Ontario by review count, so an escape room in Kitchener was answered with Toronto.
   */
  const i = readIntent("escape room in kitchener ontario tonight, 4 of us");
  assert.equal(i.city, "Kitchener");
  assert.equal(i.region, "ON");
  assert.ok(i.point && Math.abs(i.point.lat - 43.45) < 0.1, "the point is Kitchener's, not the province's");
  assert.equal(i.party, 4);
  assert.equal(i.when, "tonight");
  assert.equal(i.categoryId, ESCAPE.id);

  const names = candidates(i).map((o) => o.name);
  assert.ok(names.slice(0, 3).every((x) => /Adventure Rooms|Locked Kitchener|Escape Waterloo/.test(x)),
    "expected the Kitchener shops first, got " + names.join(", "));
});

test("a province is still not a town of the same name", () => {
  const i = readIntent("escape room in ontario");
  assert.equal(i.region, "ON");
  assert.equal(i.city, null, "Ontario, California, is not what somebody asking about Ontario meant");
  assert.equal(i.point, null);
  const regions = new Set(candidates(i).map((o) => o.region));
  assert.deepEqual([...regions], ["ON"]);
});

test("a word that merely contains a town's name is not that town", () => {
  /**
   * "any**avail**able at 3pm?" is a real follow-up a guest typed after asking about escape rooms in Waterloo,
   * and it silently teleported the whole conversation to Vail, Colorado, because the town lookup was a bare
   * `instr()` substring test with no word boundary. A prior turn's place has to survive a sentence that merely
   * contains the town's letters, and a sentence that actually names the town still has to find it.
   */
  const i = readIntent("escape room, anything available at 3pm?");
  assert.equal(i.city, null, "'available' is not Vail");
  assert.equal(i.region, null);

  const named = readIntent("escape room in vail");
  assert.equal(named.city, "Vail");
  assert.equal(named.region, "CO");
});

test("the state a guest typed says which town of that name they meant", () => {
  const wa = readIntent("boat tour in vancouver washington");
  assert.equal(wa.region, "WA");
  assert.ok(wa.point && Math.abs(wa.point.lat - 45.63) < 0.1, "expected Vancouver, Washington");
  assert.ok(candidates(wa).every((o) => o.region === "WA"));

  const bc = readIntent("boat tour in vancouver");
  assert.ok(bc.point && Math.abs(bc.point.lat - 49.28) < 0.1, "with nothing else said, the bigger Vancouver");
});

test("the menu we quote is the one a guest can turn up and buy", () => {
  const i = readIntent("escape room in kitchener ontario");
  const shop = candidates(i).find((o) => o.name === "Adventure Rooms");
  assert.ok(shop);
  assert.deepEqual(shop.services.map((s) => s.name), ["Escape room, per person"]);
  assert.equal(priceOf(shop), 28);
});

test("a shop whose calendar we can read is offered before one we cannot", () => {
  shop({ name: "Cambridge Escape", city: "Kitchener", region: "ON", lat: 43.46, lon: -80.5, category: ESCAPE.id,
    reviews: 1, booking: "https://fareharbor.com/embeds/book/cambridgeescape/" });
  const list = candidates(readIntent("escape room in kitchener ontario"));
  assert.equal(list[0].name, "Cambridge Escape");
  assert.equal(list[0].route, "feed");
  assert.equal(list[1].route, "agent");
});

test("the weekend a guest is standing in is this one", () => {
  const sunday = new Date("2026-09-20T09:00:00");
  while (sunday.getDay() !== 0) sunday.setDate(sunday.getDate() + 1);
  const w = windowFor("weekend", sunday);
  assert.equal(w.from.getTime(), sunday.getTime(), "on a Sunday the weekend is today, not in six days");
  assert.equal(w.days, 1);

  const saturday = new Date(sunday.getTime() - 86400_000);
  const s = windowFor("weekend", saturday);
  assert.equal(s.from.getDay(), 6);
  assert.equal(s.days, 2);

  const friday = new Date(sunday.getTime() - 2 * 86400_000);
  assert.equal(windowFor("weekend", friday).from.getDay(), 6);

  assert.equal(windowFor("tonight", sunday).days, 1);
  assert.equal(windowFor("tomorrow", sunday).from.getDate(), new Date(sunday.getTime() + 86400_000).getDate());
  assert.equal(windowFor("any", sunday).days, 14);
});
