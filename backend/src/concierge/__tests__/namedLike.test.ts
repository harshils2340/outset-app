import { strict as assert } from "node:assert";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The shops found by their own name, when the category column has almost nothing.
 *
 * The rule matches a business name against the category's label and search phrase and against the first word
 * of each, which is right for "Axe Throwing" and wrong for every label whose first word is an ordinary English
 * word. Counted over the shipped catalog, seven of those stubs pulled in 1,226 businesses of another kind for
 * 186 of their own: "water" offered 714 jet ski hires, Clearwater charters and watersports shops as water
 * parks, and "pool" offered 179 swimming pools and a whirlpool jet boat tour as a billiards hall. Those
 * surface whenever a town has fewer than three of the thing a guest asked for, which is most towns.
 */
process.env.OUTSET_DB = join(mkdtempSync(join(tmpdir(), "outset-named-like-")), "catalog.db");
const { db, migrate } = await import("../../db/client.ts");
const { inferCategory } = await import("../../taxonomy/catalog.ts");
const { readIntent, namedLike } = await import("../plan.ts");

const AXE = inferCategory("axe throwing");
migrate();
const { CATEGORIES } = await import("../../taxonomy/catalog.ts");
for (const c of CATEGORIES) {
  db.prepare("INSERT OR IGNORE INTO categories (id, family, label, icon_key, service_style, search_query) VALUES (?,?,?,?,?,?)")
    .run(c.id, c.family, c.label, c.iconKey, c.serviceStyle, c.searchQuery);
}

let n = 0;
function shop(name: string, category: string, reviews = 50): void {
  const id = "op-" + ++n;
  db.prepare(
    `INSERT INTO operators (id, domain, name, lat, lon, city, region, country, category_id, icon_key, origin, review_count, rating, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, id + ".example.com", name, 27.95 + n / 1000, -82.46, "Tampa", "FL", "US", category, "jetski", "public_site", reviews, 4.5, "now", "now");
}

// A town of water businesses that are not water parks, a swimming pool, and one real axe range.
shop("Clearwater Jet Ski Rentals", "jetski", 400);
shop("Avi's Watersports", "jetski", 300);
shop("Blue Water Pontoon Boat Rental", "pontoon", 200);
shop("Antietam Pool", "swim", 150);
shop("Whirlpool Jet Boat Tours", "cruise", 140);
shop("Tampa Bay Axe Throwing", AXE.id, 10);
// Filed under fitness, named for what it does: this is the shape the whole rule exists for, and "martial" is
// one of the first-word stubs that earns its keep (315 right of 318 over the shipped catalog).
shop("AKF Family Martial Arts", "fitness", 30);

test("a watersports shop is not offered as a water park", () => {
  const found = namedLike(readIntent("water park in tampa"), 8);
  assert.deepEqual(found.map((o) => o.name), []);
});

test("a swimming pool is not offered as a billiards hall", () => {
  const found = namedLike(readIntent("billiards in tampa"), 8);
  assert.deepEqual(found.map((o) => o.name), []);
});

test("a shop that really does name the activity is still found", () => {
  assert.deepEqual(namedLike(readIntent("axe throwing in tampa"), 8).map((o) => o.name), ["Tampa Bay Axe Throwing"]);
  // Found by the first word alone, from a row the catalog files under fitness.
  assert.deepEqual(namedLike(readIntent("martial arts in tampa"), 8).map((o) => o.name), ["AKF Family Martial Arts"]);
});
