import { CITIES } from "../src/discover/cities.ts";

/**
 * Gives a metro to operators that discovery left without one because the result had no pin: web-search rows
 * (`src/discover/websearch.ts`) carry only the city they were searched from. The city center is the pin the
 * row never had, and the nearest metro within 160 km (the same rule `upsertPlace` uses) is its metro. Rows whose
 * city is not a discovery city, or is farther than 160 km from every metro (Destin, Naples), stay as they are.
 * No network.
 *
 *   npx tsx scripts/metro-backfill.mts --dry   # counts only
 *   npx tsx scripts/metro-backfill.mts         # write
 */

const dry = process.argv.includes("--dry");
const { db, nowIso } = await import("../src/db/client.ts");
const { nearestMetro } = await import("../src/taxonomy/catalog.ts");

const rows = db.prepare("SELECT id, city, region FROM operators WHERE metro_id IS NULL AND lat IS NULL AND city IS NOT NULL").all() as { id: string; city: string; region: string | null }[];
const byMetro = new Map<string, number>();
let unmatched = 0;
let outOfRange = 0;
const update = db.prepare("UPDATE operators SET metro_id = ?, updated_at = ? WHERE id = ?");
const now = nowIso();
const apply = (list: { id: string; metro: string }[]) => {
  db.exec("BEGIN");
  try { for (const t of list) update.run(t.metro, now, t.id); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; }
};
const todo: { id: string; metro: string }[] = [];
for (const r of rows) {
  const city = CITIES.find((c) => c.name.toLowerCase() === r.city.trim().toLowerCase() && (!r.region || c.region === r.region.trim().toUpperCase()));
  if (!city) { unmatched++; continue; }
  const metro = nearestMetro(city.lat, city.lon, 160);
  if (!metro) { outOfRange++; continue; }
  todo.push({ id: r.id, metro: metro.id });
  byMetro.set(metro.id, (byMetro.get(metro.id) || 0) + 1);
}
if (!dry) apply(todo);
console.log(`${rows.length} operators with no metro and no pin: ${todo.length} ${dry ? "would get" : "got"} a metro, ${outOfRange} are in a city farther than 160 km from any metro, ${unmatched} have a city discovery never searched from.`);
for (const [m, n] of Array.from(byMetro.entries()).sort((a, b) => b[1] - a[1])) console.log(`  ${m.padEnd(16)} ${n}`);
