import { METROS, metroById, metroCoords } from "../data/metros";
import type { Place } from "./places";
import { API_URL } from "./api";

/**
 * Roughly where the guest is, worked out without asking them anything.
 *
 * A permission prompt on the first paint, before anyone knows what the site is, is mostly answered with No, and
 * No is sticky: the guest who refuses once never sees what is near them again. So the home opens on a place it
 * guessed, and the guest retypes it in a second if it is wrong.
 *
 * Two guesses, best first. The API sits behind Cloudflare, which tags each request with the city it resolved, so
 * `/where` usually answers with a point good to the city. Failing that, the browser's own time zone names a
 * region ("America/Toronto"), which is enough to pick the nearest metro we list. Neither asks permission,
 * neither costs a round trip the page waits on, and an explicit choice always wins over both.
 */

const KEY = "outset.place.v1";

/** The place the guest last chose themselves. Kept so a guess never overrules a decision. */
export function savedPlace(): Place | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Place>;
    return typeof p?.lat === "number" && typeof p?.lon === "number" && typeof p.label === "string" ? { label: p.label, sub: String(p.sub || ""), lat: p.lat, lon: p.lon, region: p.region } : null;
  } catch {
    return null;
  }
}

export function rememberPlace(p: Place | null): void {
  try {
    if (p) localStorage.setItem(KEY, JSON.stringify(p));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
}

/** The metro whose centre is nearest a point, within `maxKm`. */
function nearestMetro(lat: number, lon: number, maxKm = 240): { id: string; km: number } | null {
  let best: { id: string; km: number } | null = null;
  for (const m of METROS) {
    const c = metroCoords(m.id);
    if (!c) continue;
    const dLat = ((c.lat - lat) * Math.PI) / 180;
    const dLon = ((c.lng - lon) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat * Math.PI) / 180) * Math.cos((c.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    const km = 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
    if (!best || km < best.km) best = { id: m.id, km };
  }
  return best && best.km <= maxKm ? best : null;
}

/**
 * The metro a time zone points at. One entry per zone we list a metro in; a zone that covers several metros
 * names the biggest, because a coarse right answer beats no answer and the guest can retype it.
 *
 * A zone we list no metro in belongs nowhere here. America/Winnipeg was mapped to a "winnipeg" that is not one
 * of the 47 metros, and the nearest that is, Minneapolis, is 700 km away, well past the 240 km a guessed point
 * is allowed to reach. So Manitoba falls through to Anywhere, which is the whole catalog and is honest, rather
 * than to a metro with nothing in it.
 */
export const ZONE_METRO: Record<string, string> = {
  "America/Toronto": "toronto",
  "America/Montreal": "montreal",
  "America/Vancouver": "vancouver",
  "America/Edmonton": "calgary",
  "America/Halifax": "halifax",
  "America/St_Johns": "halifax",
  "America/New_York": "nyc",
  "America/Detroit": "detroit",
  "America/Chicago": "chicago",
  "America/Denver": "denver",
  "America/Phoenix": "phoenix",
  "America/Los_Angeles": "los-angeles",
  "America/Anchorage": "anchorage",
  "Pacific/Honolulu": "honolulu",
};

/**
 * The metro the browser's own clock implies, with no network call and no permission.
 *
 * The answer is checked against the metro list before it is returned. Nothing downstream checks: the home
 * filters every rail on `u.metroId === state.metroId` and the pill prints the id as typed, so an id that is
 * not a metro opens an empty home headed "in winnipeg" rather than falling back to Anywhere.
 */
export function metroFromTimeZone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const id = ZONE_METRO[zone];
    return id && metroById(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * Where to open the home on a first visit.
 *
 * The two guesses are not equally sharp, and pretending otherwise would hurt. A point good to the city can carry
 * "near you", which means within 40 km. A time zone only names a region: America/Toronto covers Waterloo and
 * Barrie as well, and drawing a 40 km circle on Toronto's centre would hide a guest in Waterloo from everything
 * around them. So a coarse guess picks the metro instead, which is the whole area and honestly labelled.
 */
export type Guess = { kind: "point"; place: Place } | { kind: "metro"; metroId: string } | null;

export async function guessPlace(): Promise<Guess> {
  const coarse = (): Guess => {
    const id = metroFromTimeZone();
    return id ? { kind: "metro", metroId: id } : null;
  };
  if (!API_URL) return coarse();
  try {
    const res = await fetch(`${API_URL}/where`, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const w = (await res.json()) as { lat?: number; lon?: number; city?: string; region?: string };
      if (typeof w.lat === "number" && typeof w.lon === "number") {
        // A named city is a point worth standing on; coordinates without one only place a metro.
        if (w.city) return { kind: "point", place: { label: w.city, sub: w.region || "", lat: w.lat, lon: w.lon, region: w.region } };
        const m = nearestMetro(w.lat, w.lon);
        if (m) return { kind: "metro", metroId: m.id };
      }
    }
  } catch {
    /* the guess is optional; the time zone still has a say */
  }
  return coarse();
}
