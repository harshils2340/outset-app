import type { Unclaimed } from "../data/types";
import { regionOfArea } from "../data/regions";
import { kmBetween } from "./places";

/**
 * The "More like this" rail under a listing: other shops doing the same activity, nearest first.
 *
 * Same metro when there are enough of them, else the same state or province, else, for a shop with only one
 * or two neighbours either way, both of those pools together. Nobody in Washington DC wants San Jose, so the
 * whole catalog is the last resort and only for a shop with no neighbour at all, in its metro or its state.
 *
 * Reaching the both-pools branch used to need a neighbour in this metro, so a shop whose town is in no metro
 * at all, and 1,260 of them are, skipped its own state and drew the country: Countdown Games in Lexington,
 * Kentucky, offered escape rooms in Texas and Florida while Emerge, an hour up the road in La Grange, sat in
 * the pool unread. A state with one shop in it is still a better answer than a state two thousand miles off.
 *
 * The two pools overlap: a shop in this metro is nearly always in this region too. Merged without deduping,
 * the rail drew that shop as two cards in a row (and React warned on the repeated key), which on a thin metro
 * was most of the rail: 483 listings shipped one, 253 of them a rail at least half made of repeats, and one
 * paintball place in Dacono, Colorado, was offered under "More like this" as both of its two suggestions.
 *
 * "Nearest first" is what this file has always said and what its sort never did: it read a photo and then a
 * review count, so the widened pool sent a Lexington guest to Louisville ahead of La Grange. Over the shipped
 * catalog the lead card of a rail sat a median 62 km from the listing it was offered under, and 42.7% of
 * rails carried a shop more than 100 km nearer further down. Distance is now the sort, under the photo rule
 * and over the review count, which takes that median to 4 km and draws the same number of photographs.
 *
 * A shop with no pin, and 1,741 have none, cannot be placed, so it sorts behind the ones that can rather than
 * jumping the queue at zero. A cover already known not to load is not a photo: `deadCovers` has been
 * collecting those since the day one card in twelve drew a cartoon, and the rail is the one grid that never
 * asked. It ranks such a shop with the shops that have no cover at all, which is what a guest sees, instead of
 * putting a scene illustration at the head of the rail on the strength of a URL that 404s.
 */
export function pickSimilar(
  item: Unclaimed,
  catalog: Unclaimed[],
  max = 10,
  dead?: Set<string>,
): { similar: Unclaimed[]; similarNear: boolean } {
  const all = catalog.filter((u) => u.id !== item.id && u.art === item.art);
  const near = all.filter((u) => u.metroId && u.metroId === item.metroId);
  const region = regionOfArea(item.area);
  const sameRegion = region ? all.filter((u) => regionOfArea(u.area) === region) : [];
  // Only this branch can repeat anything, and it is reached with fewer than four in each pool.
  const bothPools = () => [...near, ...sameRegion].filter((u, i, list) => list.findIndex((x) => x.id === u.id) === i);
  const thin = near.length + sameRegion.length > 0;
  const pool = near.length >= 4 ? near : sameRegion.length >= 4 ? sameRegion : thin ? bothPools() : all;
  const here = typeof item.lat === "number" && typeof item.lon === "number" ? { lat: item.lat, lon: item.lon } : null;
  // Measured once per candidate, not once per comparison: a state pool is 1,260 shops on the widest listings.
  // Unplaceable is Infinity rather than zero, and two of those fall through to the review count rather than
  // subtracting to NaN, which is a comparator the sort is entitled to make nonsense of.
  const ranked = pool.map((u) => ({
    u,
    shows: u.cover && !dead?.has(u.id) ? 1 : 0,
    km: here && typeof u.lat === "number" && typeof u.lon === "number" ? kmBetween(here, { lat: u.lat, lon: u.lon }) : Infinity,
    reviews: u.reviews || 0,
  }));
  const picks = ranked
    .sort((a, b) => b.shows - a.shows || (a.km === b.km ? 0 : a.km - b.km) || b.reviews - a.reviews)
    .slice(0, max)
    .map((r) => r.u);
  // "Near Tampa Bay" is only true when the picks are there, not when the fallback reached across the country.
  // A shop in no metro has no metro to be near, and its neighbours have no metro either, so the plain equality
  // read that as true for all 1,260 of them; only the caller's own lookup of a metro that is not there kept
  // the heading honest.
  const inMetro = !!item.metroId && picks.length > 0 && picks.every((u) => u.metroId === item.metroId);
  return { similar: picks, similarNear: inMetro };
}
