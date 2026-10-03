import { strict as assert } from "node:assert";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Where a town is, when some of its pins are wrong.
 *
 * The centre was the average of every pin filed under that town's name, and a catalog crawled off 48,000 other
 * people's websites holds plenty of wrong pins: a chain pins every branch at its head office, and a shop that
 * publishes no address gets whatever its page did name. Measured against the shipped catalog, three of Tampa's
 * 127 rows sit about 3,800 km away, which moved the town's centre 166 km into the Gulf of Mexico; every search
 * after that is measured in kilometres from that point, so the 40 km circle held none of Tampa's own
 * businesses and "jet ski rental in tampa tomorrow" came back empty, with no genres to narrow by either.
 * Vancouver, Washington was 107 km out and lost 31 of its 45 shops the same way.
 *
 * The town below is that shape in miniature: nine shops in one place and two pinned on another continent.
 */
process.env.OUTSET_DB = join(mkdtempSync(join(tmpdir(), "outset-town-centre-")), "catalog.db");
const { db, migrate } = await import("../../db/client.ts");
const { inferCategory } = await import("../../taxonomy/catalog.ts");
const { readIntent, candidates, placeAmbiguity } = await import("../plan.ts");

const JETSKI = inferCategory("jet ski rental");
migrate();
db.prepare("INSERT OR IGNORE INTO categories (id, family, label, icon_key, service_style, search_query) VALUES (?,?,?,?,?,?)")
  .run(JETSKI.id, "water", JETSKI.label, "jetski", "rental", JETSKI.label);

let n = 0;
function shop(name: string, city: string, region: string, lat: number, lon: number): void {
  const id = "op-" + ++n;
  db.prepare(
    `INSERT INTO operators (id, domain, name, lat, lon, city, region, country, category_id, icon_key, origin, review_count, rating, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, id + ".example.com", name, lat, lon, city, region, "US", JETSKI.id, "jetski", "public_site", 10, 4.6, "now", "now");
}

// Nine real jet ski rentals around Tampa Bay.
const bay: [number, number][] = [
  [27.95, -82.46], [27.94, -82.45], [27.96, -82.48], [27.92, -82.44], [27.97, -82.5],
  [27.89, -82.42], [28.02, -82.52], [27.86, -82.39], [27.99, -82.47],
];
bay.forEach(([lat, lon], i) => shop("Bay Jet Ski " + (i + 1), "Tampa", "FL", lat, lon));
// Two chains that pinned their Tampa branch at a head office in Europe, as three shipped rows really do.
shop("Chain Watersports Tampa", "Tampa", "FL", 51.5, -0.12);
shop("Franchise Jet Ski Tampa", "Tampa", "FL", 48.85, 2.35);

test("a town's centre is the middle of its pins, not their average", () => {
  const point = readIntent("jet ski rental in tampa tomorrow").point;
  assert.ok(point, "tampa should resolve to a point");
  // The median lands in Tampa Bay. The average of the same twelve rows is at 31.3, -68.5, in the Atlantic.
  assert.ok(Math.abs(point!.lat - 27.95) < 0.1, `lat was ${point!.lat}`);
  assert.ok(Math.abs(point!.lon - -82.46) < 0.1, `lon was ${point!.lon}`);
});

test("the town's own businesses are inside the circle drawn on that centre", () => {
  const found = candidates(readIntent("jet ski rental in tampa tomorrow"), 12);
  // Every one of the nine real shops, and neither of the two misplaced pins.
  assert.equal(found.length, 9);
  assert.deepEqual([...new Set(found.map((o) => o.city))], ["Tampa"]);
  assert.ok(!found.some((o) => /Chain|Franchise/.test(o.name)));
});

test("the count behind a town is still every row filed under it", () => {
  // The floor of three businesses and the ranking by count are what decide which Waterloo a guest is asked
  // about, and they are counted over the rows, not over the ones near the centre.
  const intent = readIntent("jet ski rental in tampa tomorrow");
  assert.equal(intent.places?.[0].n, 11);
  assert.equal(placeAmbiguity(intent), null);
});
