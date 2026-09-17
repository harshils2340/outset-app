/** Earth radius in miles. */
const R_MI = 3958.8;

/** Kilometres in a mile, and the only conversion either unit goes through. */
const KM_PER_MI = 1.60934;

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

/**
 * How far a shop is, in the units the country it sits in uses: "Nearby", "1.4 mi", "12 mi" in the United
 * States, "450 m", "2.1 km", "12 km" in Canada.
 *
 * The country is a required argument because it used to be assumed. The cards and the listing page asked
 * `places.ts` for this and got kilometres whoever was reading, so all 51,940 American listings in the catalog
 * told a guest in Tampa their jet skis were "19 km away", and then the booking sheet, which asked the copy of
 * the rule that lived here, said "12 mi away" on the very next screen. There is one rule now and it lives
 * here, because `places.ts` reaches for `navigator` and the backend's own tests typecheck their way into this
 * file.
 *
 * Each band is picked from the rounded number, not the raw one, or the rounding pushes the answer out of the
 * band that chose it: 999.6 m was shown as "1000 m" rather than "1.0 km", and 9.96 km as "10.0 km".
 */
export function fmtDistance(km: number, country: "US" | "CA"): string {
  if (country === "US") {
    const miles = km / KM_PER_MI;
    const tenths = Math.round(miles * 10) / 10;
    // Feet are not how a guest thinks about a shop they are practically standing at, so under a third of a
    // mile says so in words. That is the bar this file has always used on the booking sheet.
    if (tenths < 0.3) return "Nearby";
    return (tenths < 10 ? tenths.toFixed(1) : String(Math.round(miles))) + " mi";
  }
  const metres = Math.round(km * 100) * 10;
  if (metres < 1000) return Math.max(10, metres) + " m";
  const tenths = Math.round(km * 10) / 10;
  return (tenths < 10 ? tenths.toFixed(1) : String(Math.round(km))) + " km";
}

/** The same answer for a caller that already has miles: the booking sheet measures with `milesBetween`. */
export function formatDistance(miles: number, country: "US" | "CA"): string {
  return fmtDistance(miles * KM_PER_MI, country);
}
