import { inCat } from "../../data/categories";
import { ALL_METRO_ID } from "../../data/metros";
import type { CategoryId, Unclaimed } from "../../data/types";
import { fromPrice } from "../../lib/catalog";
import { dealToday } from "../../lib/companyAgent";
import { WHAT_INTENTS, describeQuery, searchSuggest } from "../../lib/search";
import { kmBetween, type Place } from "../../lib/places";
import { passesFilters, type FeedFilters } from "./prefs";

/** An hour of driving. Wide enough that a small town still has something, tight enough to feel local. */
export const NEAR_RADIUS_KM = 80;

/**
 * The catalog arrives grouped by category, so the All tab would open on a wall of one kind of thing. Deal the
 * categories out in turn instead, keeping each category's own order.
 */
function interleave(list: Unclaimed[]): Unclaimed[] {
  const groups = new Map<string, Unclaimed[]>();
  for (const u of list) {
    const g = groups.get(u.cat);
    if (g) g.push(u);
    else groups.set(u.cat, [u]);
  }
  const lanes = [...groups.values()];
  const out: Unclaimed[] = [];
  for (let i = 0; out.length < list.length; i++) {
    for (const lane of lanes) if (i < lane.length) out.push(lane[i]);
  }
  return out;
}

/**
 * What browse shows for a category and a place. A card is mostly its photo, so browse asks for a real cover.
 * Search is deliberately not filtered this way: someone looking for a business by name should still find it.
 */
export function browseList(catalog: Unclaimed[], cat: CategoryId, metroId: string, near: Place | null): Unclaimed[] {
  const inThisCat = (u: Unclaimed) => inCat(u, cat) && !!u.cover;
  if (near) {
    return catalog
      .filter((u) => u.lat != null && u.lon != null && inThisCat(u) && kmBetween(near, { lat: u.lat, lon: u.lon }) <= NEAR_RADIUS_KM)
      .sort((a, b) => kmBetween(near, { lat: a.lat!, lon: a.lon! }) - kmBetween(near, { lat: b.lat!, lon: b.lon! }));
  }
  const rows = catalog.filter((u) => (metroId === ALL_METRO_ID || u.metroId === metroId) && inThisCat(u));
  return cat === "all" ? interleave(rows) : rows;
}

/**
 * Search ranks the whole catalog. With a place picked in Where, keep the matches within an hour's drive, nearest
 * first, so "kayak" near Tampa is not led by Hawaii. When nothing matches nearby the ranked list stands.
 */
export function nearFirst(list: Unclaimed[], near: Place | null): Unclaimed[] {
  if (!near) return list;
  const close = list
    .filter((u) => u.lat != null && u.lon != null && kmBetween(near, { lat: u.lat, lon: u.lon }) <= NEAR_RADIUS_KM)
    .sort((a, b) => kmBetween(near, { lat: a.lat!, lon: a.lon! }) - kmBetween(near, { lat: b.lat!, lon: b.lon! }));
  return close.length ? close : list;
}

export function applyFilters(list: Unclaimed[], f: FeedFilters): Unclaimed[] {
  if (!Object.values(f).some(Boolean)) return list;
  return list.filter((u) => passesFilters(u, f, { priced: () => fromPrice(u) != null, deal: () => dealToday(u) }));
}

/**
 * Exactly what the Explore feed shows for a What and a place: the search inside the place (nearest first when a
 * point is picked), or browse when What is empty, then the filters. The search sheet counts with this too, so a
 * suggestion's number is the length of the feed it opens.
 */
export function feedFor(catalog: Unclaimed[], q: string, cat: CategoryId, metroId: string, near: Place | null, f: FeedFilters): Unclaimed[] {
  const t = q.trim();
  const list = t ? nearFirst(searchSuggest(catalog, t, { metroId: near ? ALL_METRO_ID : metroId, cat }).results, near) : browseList(catalog, cat, metroId, near);
  return applyFilters(list, f);
}

/** The name a What query goes by on the phone: the occasion ("Date night"), or the words as typed ("Parasailing"). */
export function whatLabel(q: string): string {
  const t = q.trim();
  if (!t) return "";
  const chip = WHAT_INTENTS.find((c) => c.query === t.toLowerCase());
  if (chip) return chip.label;
  const d = describeQuery(t);
  if (d.onlyIntent && !d.arts.length) return d.intent.label!;
  return t.charAt(0).toUpperCase() + t.slice(1);
}
