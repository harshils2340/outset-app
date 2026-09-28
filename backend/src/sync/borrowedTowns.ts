import { METROS, haversineKm } from "../taxonomy/catalog.ts";

/**
 * A town the shop never stated, borrowed from the nearest metro, printed next to a state that metro is not in.
 *
 * Discovery fills a listing's town from `addr:city` when OpenStreetMap carries one, and when it does not it
 * borrows the name of the nearest metro within 160 km (`loadArea` in discover/osm.ts). The state beside it
 * comes from somewhere else entirely: `addr:state`, or failing that the state whose Overpass query returned
 * the row. The two are never checked against each other, so a shop in Maryland near enough to the capital
 * ships as "Washington DC, MD", one in Sussex County ships as "New York, NJ", and a paintball field in
 * Ontario ships as "Detroit, ON". 1,260 listings in the shipped catalog print a pair like that, the largest
 * groups being 255 around Washington DC, 158 around New York and 134 around Boston.
 *
 * It is the town that is invented here and not the state: the state is a fact from the address or from the
 * query that found the business, and the town is our own guess at one. So the guess goes and the fact stays.
 * A listing whose town was never read publishes its state code on its own, which `regionOfArea` has always
 * read and every surface already draws for the 1,210 rows that ship that way today.
 *
 * The rule is the one thing that separates a borrowed name from a real town that shares it: the pin has to be
 * inside the reach the borrow could have happened in. Portland, Maine is 4,000 km from the Portland metro, so
 * its 60 listings keep their town; Charleston, West Virginia, Waterloo, Iowa, Vancouver, Washington and 195
 * more are left alone for the same reason. Only a shop close enough to the metro whose name it carries, and
 * in a state that metro is not in, can have had that name put there by the fallback.
 *
 * A listing an operator has claimed is never touched: the area on a claimed row can be one they typed
 * themselves, and their own facts beat our inference.
 */
const BORROW_KM = 160;

export function dropBorrowedTowns(items: Record<string, unknown>[]): number {
  const byName = new Map<string, typeof METROS>();
  for (const m of METROS) {
    const held = byName.get(m.name);
    if (held) held.push(m);
    else byName.set(m.name, [m]);
  }
  const counts = new Map<string, number>();
  let cleared = 0;
  for (const item of items) {
    if (item.claimed) continue;
    const area = String(item.area || "");
    const parts = area.match(/^(.+),\s*([A-Za-z]{2})$/);
    if (!parts) continue;
    const town = parts[1].trim();
    const region = parts[2].toUpperCase();
    const named = byName.get(town);
    // No metro of that name, or one of them sits in this very state: nothing was borrowed across a border.
    if (!named || named.some((m) => m.region === region)) continue;
    const lat = item.lat;
    const lon = item.lon;
    if (typeof lat !== "number" || typeof lon !== "number") continue;
    if (!named.some((m) => haversineKm(lat, lon, m.lat, m.lon) <= BORROW_KM)) continue;
    item.area = region;
    cleared++;
    counts.set(area, (counts.get(area) || 0) + 1);
  }
  if (cleared) {
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([a, n]) => `${a} (${n})`).join(", ");
    console.log(`  Dropped a metro's name from ${cleared} area lines that paired it with a state it is not in: ${top}.`);
  }
  return cleared;
}
