import { inCat } from "../../data/categories";
import { ALL_METRO_ID, metroCoords } from "../../data/metros";
import { countryOfArea, regionOfArea } from "../../data/regions";
import type { CategoryId, Unclaimed } from "../../data/types";
import { fromPrice } from "../../lib/catalog";
import { dealToday } from "../../lib/companyAgent";
import { fmtDistance } from "../../lib/geo";
import { WHAT_INTENTS, describeQuery, searchSuggest } from "../../lib/search";
import { nearestLocation, type Place } from "../../lib/places";
import { passesFilters, type FeedFilters } from "./prefs";

/** An hour of driving. Wide enough that a small town still has something, tight enough to feel local. */
/**
 * "Near" is a distance a guest would actually go for an afternoon: 40 km is under an hour's drive in the places
 * we list. A 78 km fishing charter is a day trip, and it used to sit in the "near you" row as if it were around
 * the corner. Up to 100 km still counts as reachable and is shown, but as "worth the drive", and search results
 * keep that wider circle so a guest who types the thing they want can still find it.
 */
export const NEAR_RADIUS_KM = 40;
export const DRIVE_RADIUS_KM = 100;

/**
 * Is this listing at the place the guest picked? A picked state or province holds every listing in it; a
 * picked point holds whatever is within the radius, measured to the nearest of a chain's venues rather than
 * to whichever one the catalog happens to lead with.
 *
 * The desktop home had this and the phone feed had a plain radius from the primary pin, so the two disagreed
 * for the same guest in the same session: a picked province gave the desktop all 224 of Saskatchewan and the
 * phone the 8 within an hour of the middle of it, each card reading "SK, 16 km away".
 */
export function atPlace(u: Unclaimed, near: Place, radiusKm = NEAR_RADIUS_KM): boolean {
  if (near.region) return regionOfArea(u.area) === near.region;
  return kmToPlace(u, near) <= radiusKm;
}

/**
 * A city picked by name. Catalog rows still carry the metro they were filed under, often the nearest of the
 * old 47, so a Waterloo dojo can be tagged Toronto. The guest named the town, so the pin wins: anything
 * within an afternoon of the city centre counts, plus anything already filed as that metro.
 */
export function atMetro(u: Unclaimed, metroId: string, radiusKm = NEAR_RADIUS_KM): boolean {
  if (!metroId || metroId === ALL_METRO_ID) return true;
  if (u.metroId === metroId) return true;
  const c = metroCoords(metroId);
  if (!c) return false;
  return kmToPlace(u, { label: metroId, sub: "", lat: c.lat, lon: c.lng }) <= radiusKm;
}

/** Reachable for a day out: within DRIVE_RADIUS_KM of a picked point, or anywhere in a picked region. */
export function withinDrive(u: Unclaimed, near: Place): boolean {
  return atPlace(u, near, DRIVE_RADIUS_KM);
}

/** How far the guest is from this listing's nearest venue. Infinity when it has no pin at all. */
export function kmToPlace(u: Unclaimed, near: Place): number {
  return nearestLocation(u, near)?.km ?? Infinity;
}

/**
 * The place line on a card when the guest has a pin: how far it is, not the metro the catalog filed it under.
 *
 * Listings in Waterloo ship as "Toronto, ON" because the grid has no KW metro. Printing that city next to a
 * GPS distance is how "Near me" looked like downtown Toronto. A chain's other venue can still name its town.
 */
export function awayLine(u: Unclaimed, near: Place | null): string | null {
  if (!near || near.region) return null;
  const n = nearestLocation(u, near);
  if (!n) return null;
  const town = n.alt && n.label ? n.label : "";
  return (town ? town + " · " : "") + fmtDistance(n.km, countryOfArea(u.area)) + " away";
}

/** Nearest first, but only for a picked point: a distance from the middle of a whole state is not an order. */
const byDistance = (list: Unclaimed[], near: Place): Unclaimed[] =>
  near.region ? list : list.sort((a, b) => kmToPlace(a, near) - kmToPlace(b, near));

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
  if (near) return byDistance(catalog.filter((u) => inThisCat(u) && atPlace(u, near)), near);
  const rows = catalog.filter((u) => inThisCat(u) && atMetro(u, metroId));
  return cat === "all" ? interleave(rows) : rows;
}

/**
 * Search ranks the whole catalog. With a place picked in Where, keep the matches within an hour's drive, nearest
 * first, so "kayak" near Tampa is not led by Hawaii. When nothing matches nearby the ranked list stands.
 */
export function nearFirst(list: Unclaimed[], near: Place | null): Unclaimed[] {
  if (!near) return list;
  const close = byDistance(list.filter((u) => atPlace(u, near)), near);
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
  const list = t
    ? nearFirst(
      searchSuggest(catalog, t, {
        cat,
        keep: near || metroId === ALL_METRO_ID ? undefined : (u) => atMetro(u, metroId),
      }).results,
      near,
    )
    : browseList(catalog, cat, metroId, near);
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
