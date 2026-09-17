/**
 * Place search for the Where box. Uses Photon (photon.komoot.io), a free OpenStreetMap geocoder with CORS,
 * limited to the US and Canada. No key. Results are cities, neighbourhoods, beaches, lakes and landmarks.
 */

/** `region` set means a whole state or province was picked: listings inside it, not within a radius of a point. */
export type Place = { label: string; sub: string; lat: number; lon: number; region?: string };

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: { name?: string; city?: string; state?: string; country?: string; countrycode?: string; osm_value?: string; type?: string };
};

const cache = new Map<string, Place[]>();

export async function searchPlaces(q: string, bias?: { lat: number; lon: number } | null): Promise<Place[]> {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  // The bias reorders Photon's own results, so the same typed text cached from a call with no bias, or a
  // different one, must not stand in for a fresh call: the cache key carries it too, rounded to about 11 km
  // so a few metres of drift in a repeat fix does not fragment the cache for nothing.
  const key = needle + (bias ? "|" + bias.lat.toFixed(1) + "," + bias.lon.toFixed(1) : "");
  if (cache.has(key)) return cache.get(key)!;
  const params = new URLSearchParams({ q: needle, limit: "8", lang: "en" });
  if (bias) {
    params.set("lat", String(bias.lat));
    params.set("lon", String(bias.lon));
  }
  try {
    const res = await fetch("https://photon.komoot.io/api/?" + params.toString(), { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return [];
    const json = (await res.json()) as { features: PhotonFeature[] };
    const out: Place[] = [];
    const seen = new Set<string>();
    for (const f of json.features || []) {
      const p = f.properties;
      if (p.countrycode && !/^(US|CA)$/i.test(p.countrycode)) continue;
      const name = p.name || p.city;
      if (!name) continue;
      const sub = [p.city && p.city !== name ? p.city : null, p.state, p.countrycode === "CA" ? "Canada" : null].filter(Boolean).join(", ");
      const id = (name + "|" + sub).toLowerCase();
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ label: name, sub, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] });
    }
    cache.set(key, out.slice(0, 6));
    return cache.get(key)!;
  } catch {
    return [];
  }
}

export function kmBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(x));
}

/** How long we wait for a fix before giving up on our own clock. */
export const LOCATE_TIMEOUT_MS = 10000;

/**
 * The guest's own position, or null if we cannot have it.
 *
 * The Geolocation timeout below does not cover the permission prompt: the spec stops its clock while the
 * browser asks, so a guest who leaves the bar unanswered gets neither callback, ever. The promise then never
 * settles and whichever control asked sits on "Finding you…", disabled, for the rest of the visit. So this
 * settles on a clock of its own as well, and every path resolves.
 */
export function currentLocation(): Promise<{ lat: number; lon: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let done = false;
    const settle = (pt: { lat: number; lon: number } | null) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve(pt);
    };
    timer = setTimeout(() => settle(null), LOCATE_TIMEOUT_MS);
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => settle({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        () => settle(null),
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
      );
    } catch {
      settle(null);
    }
  });
}

/**
 * The name to show one of a chain's venues by: its town, else its street. A venue the crawl found as a bare
 * pin has neither, and gets no name here rather than a made-up one. Callers show the distance alone.
 *
 * `npm run sync` used to write "Nearby" as the town of every venue whose own town was never found, which made
 * it the commonest town in the catalog by three to one: 64 venues on 24 listings. The app read it as a place
 * name, so a card said "Nearby · 3,337 km away" and the listing page's map link went looking for a town
 * called Nearby. The sync no longer writes it; this refuses to believe the ones already in `catalog.json`,
 * which keep it until a sync runs on Render.
 */
export function venueLabel(l: { city?: string; region?: string; street?: string }): string {
  const city = (l.city || "").trim();
  if (city && city !== "Nearby") return city + (l.region ? ", " + l.region : "");
  return (l.street || "").trim();
}

/**
 * The operator's closest location to the guest: the primary pin or one of a chain's other venues.
 * Returns null when the operator has no pin at all. `label` is empty when the venue cannot be named.
 */
export function nearestLocation(
  u: { lat?: number; lon?: number; area: string; locations?: { city?: string; region?: string; street?: string; lat: number; lon: number }[] },
  near: { lat: number; lon: number },
): { lat: number; lon: number; km: number; label: string; alt: boolean } | null {
  let best: { lat: number; lon: number; km: number; label: string; alt: boolean } | null = null;
  if (u.lat != null && u.lon != null) best = { lat: u.lat, lon: u.lon, km: kmBetween(near, { lat: u.lat, lon: u.lon }), label: u.area, alt: false };
  for (const l of u.locations || []) {
    const km = kmBetween(near, l);
    if (!best || km < best.km) best = { lat: l.lat, lon: l.lon, km, label: venueLabel(l), alt: true };
  }
  return best;
}
