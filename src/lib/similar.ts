import type { Unclaimed } from "../data/types";
import { regionOfArea } from "../data/regions";

/**
 * The "More like this" rail under a listing: other shops doing the same activity, nearest first.
 *
 * Same metro when there are enough of them, else the same state or province, else, for a shop that has only
 * one or two neighbours in a thin metro, both of those together. Nobody in Washington DC wants San Jose, so
 * the whole catalog is the last resort and only for a shop with no neighbour at all.
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
  const pool = near.length >= 4 ? near : sameRegion.length >= 4 ? sameRegion : near.length ? bothPools() : all;
  const picks = pool.slice().sort((a, b) => (b.cover ? 1 : 0) - (a.cover ? 1 : 0) || (b.reviews || 0) - (a.reviews || 0)).slice(0, max);
  // "Near Tampa Bay" is only true when the picks are there, not when the fallback reached across the country.
  return { similar: picks, similarNear: picks.length > 0 && picks.every((u) => u.metroId === item.metroId) };
}
