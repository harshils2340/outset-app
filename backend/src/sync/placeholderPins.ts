import { regionOfArea } from "../lib/zone.ts";

/**
 * A pin several unrelated businesses share, to the last decimal place, is a website template's placeholder
 * rather than an address, and the catalog carried one.
 *
 * 33 shipped listings sat at 46.423669, -129.942709, which is open Pacific about 500 km west of Vancouver
 * Island. Among them Boston Charter Boat in Boston, Italiana Tours in Dallas, Playin Hooky Water Taxi at the
 * Lake of the Ozarks and Na Pali Coast Hanalei Tours on Kauai: most of them travel agencies and charter
 * operators on the same site builder, whose theme ships a geo block nobody filled in. The crawl read it as the
 * business's own coordinates because that is what the markup says it is.
 *
 * What a pin in the ocean costs a real shop is everything distance decides: a guest in Boston who allows their
 * location is told the Boston charter boat is four thousand kilometres away, so it falls out of "near me", out
 * of the distance sort, out of the "more like this" rail and out of the concierge's shortlist, while its own
 * page cheerfully prints the town it is in.
 *
 * The rule is the one thing about a placeholder that is never true of a real address: cm precision in two
 * states at once. 274 pins in the shipped catalog are shared by more than one listing, 7,033 rows in all, and
 * every one of them but this is two businesses at one marina or one chain at one address. So sharing alone is
 * not the test, and a placeholder used only inside one state is left alone rather than guessed at: there is
 * nothing to tell it from a genuine shared address.
 *
 * The pin is cleared, not the listing. The shop keeps its page, its town and its area line; what it loses is a
 * coordinate that was never its own. The metro it was filed under was decided from the same pin at discovery
 * time and is not recovered here.
 */
export function dropPlaceholderPins(items: Record<string, unknown>[]): number {
  const at = new Map<string, Record<string, unknown>[]>();
  for (const item of items) {
    const lat = item.lat;
    const lon = item.lon;
    if (typeof lat !== "number" || typeof lon !== "number") continue;
    const key = lat + "," + lon;
    const held = at.get(key);
    if (held) held.push(item);
    else at.set(key, [item]);
  }
  let cleared = 0;
  for (const [key, held] of at) {
    if (held.length < 2) continue;
    const regions = new Set(held.map((i) => regionOfArea(String(i.area || ""))).filter(Boolean));
    if (regions.size < 2) continue;
    console.log(`  ${held.length} listings across ${regions.size} regions share the pin ${key}: a template's placeholder, not an address.`);
    for (const i of held) {
      delete i.lat;
      delete i.lon;
      cleared++;
    }
  }
  return cleared;
}
