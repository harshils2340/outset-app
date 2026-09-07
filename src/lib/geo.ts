/** Earth radius in miles. */
const R_MI = 3958.8;

export type GeoPoint = { lat: number; lng: number };

export function milesBetween(a: GeoPoint, b: GeoPoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_MI * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Guest-facing distance to a metro. CA cities use km. */
export function formatDistance(miles: number, country: "US" | "CA"): string {
  if (country === "CA") {
    const km = miles * 1.60934;
    if (km < 1) return "Under 1 km";
    if (km < 10) return Math.round(km * 10) / 10 + " km";
    return Math.round(km) + " km";
  }
  if (miles < 0.3) return "Nearby";
  if (miles < 10) return Math.round(miles * 10) / 10 + " mi";
  return Math.round(miles) + " mi";
}
