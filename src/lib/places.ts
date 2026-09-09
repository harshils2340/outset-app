/**
 * Place search for the Where box. Uses Photon (photon.komoot.io), a free OpenStreetMap geocoder with CORS,
 * limited to the US and Canada. No key. Results are cities, neighbourhoods, beaches, lakes and landmarks.
 */

export type Place = { label: string; sub: string; lat: number; lon: number };

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: { name?: string; city?: string; state?: string; country?: string; countrycode?: string; osm_value?: string; type?: string };
};

const cache = new Map<string, Place[]>();

export async function searchPlaces(q: string, bias?: { lat: number; lon: number } | null): Promise<Place[]> {
  const key = q.trim().toLowerCase();
  if (key.length < 2) return [];
  if (cache.has(key)) return cache.get(key)!;
  const params = new URLSearchParams({ q: key, limit: "8", lang: "en" });
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

/** "450 m", "2.1 km", "12 km". Metric everywhere, metres under a kilometre. */
export function fmtDistance(km: number): string {
  if (km < 1) return Math.max(10, Math.round(km * 1000 / 10) * 10) + " m";
  if (km < 10) return km.toFixed(1) + " km";
  return Math.round(km) + " km";
}

export function currentLocation(): Promise<{ lat: number; lon: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    );
  });
}

/**
 * The operator's closest location to the guest: the primary pin or one of a chain's other venues.
 * Returns null when the operator has no pin at all.
 */
export function nearestLocation(
  u: { lat?: number; lon?: number; area: string; locations?: { city: string; region?: string; lat: number; lon: number }[] },
  near: { lat: number; lon: number },
): { lat: number; lon: number; km: number; label: string; alt: boolean } | null {
  let best: { lat: number; lon: number; km: number; label: string; alt: boolean } | null = null;
  if (u.lat != null && u.lon != null) best = { lat: u.lat, lon: u.lon, km: kmBetween(near, { lat: u.lat, lon: u.lon }), label: u.area, alt: false };
  for (const l of u.locations || []) {
    const km = kmBetween(near, l);
    if (!best || km < best.km) best = { lat: l.lat, lon: l.lon, km, label: l.city + (l.region ? ", " + l.region : ""), alt: true };
  }
  return best;
}
