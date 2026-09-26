import type { Unclaimed } from "../data/types";
import { regionOfArea } from "../data/regions";

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
 */
export function pickSimilar(item: Unclaimed, catalog: Unclaimed[], max = 10): { similar: Unclaimed[]; similarNear: boolean } {
  const all = catalog.filter((u) => u.id !== item.id && u.art === item.art);
  const near = all.filter((u) => u.metroId && u.metroId === item.metroId);
  const region = regionOfArea(item.area);
  const sameRegion = region ? all.filter((u) => regionOfArea(u.area) === region) : [];
  // Only this branch can repeat anything, and it is reached with fewer than four in each pool.
  const bothPools = () => [...near, ...sameRegion].filter((u, i, list) => list.findIndex((x) => x.id === u.id) === i);
  const thin = near.length + sameRegion.length > 0;
  const pool = near.length >= 4 ? near : sameRegion.length >= 4 ? sameRegion : thin ? bothPools() : all;
  const picks = pool.slice().sort((a, b) => (b.cover ? 1 : 0) - (a.cover ? 1 : 0) || (b.reviews || 0) - (a.reviews || 0)).slice(0, max);
  // "Near Tampa Bay" is only true when the picks are there, not when the fallback reached across the country.
  // A shop in no metro has no metro to be near, and its neighbours have no metro either, so the plain equality
  // read that as true for all 1,260 of them; only the caller's own lookup of a metro that is not there kept
  // the heading honest.
  const inMetro = !!item.metroId && picks.length > 0 && picks.every((u) => u.metroId === item.metroId);
  return { similar: picks, similarNear: inMetro };
}
