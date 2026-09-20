import { ALL_METRO_ID, METROS, metroById, metroCoords } from "../data/metros";
import type { Place } from "./places";
import { API_URL } from "./api";

/**
 * Roughly where the guest is, worked out without asking them anything.
 *
 * A permission prompt on the first paint, before anyone knows what the site is, is mostly answered with No, and
 * No is sticky: the guest who refuses once never sees what is near them again. So the home opens on a place it
 * guessed, and the guest retypes it in a second if it is wrong.
 *
 * Three answers, best first, and the first two cost nothing: the place the guest chose on an earlier visit, the
 * answer the API gave on an earlier visit, and the browser's own time zone, which names a region
 * ("America/Toronto") and so a metro. All three are reads of this device, so `opening()` below can be called
 * during the first render and the home's first paint is already the right city. Only when none of them answers,
 * or the stored answer has aged, does `guessPlace()` go and ask the API, which sits behind Cloudflare and is
 * tagged with the city it resolved the caller's address to. An explicit choice always wins over every guess.
 *
 * None of this used to happen until the whole 22 MB catalog had landed, because the call sat inside that
 * download's `.then()` and needed none of it. The home therefore opened on Anywhere, painted a full set of
 * rails for the whole of the US and Canada, and only then jumped to the guest's own city. That is the flicker
 * this file exists to remove, so keep every path here synchronous or optional.
 */

/** The point the guest picked themselves. */
const KEY = "outset.place.v1";
/** The city the guest picked themselves. Anywhere is not stored: it is this visit, not the next. */
const METRO_KEY = "outset.metro.v1";
/** The last answer the API gave, so a repeat visit opens on it without waiting for a round trip. */
const GUESS_KEY = "outset.guess.v1";

/**
 * How long a stored guess is trusted, and how long before it is checked again.
 *
 * A guess is read off an IP address, so it is stale the moment the guest travels, but it is also right for
 * months on end for everybody else. Six hours is a working day: a guest who flies somewhere sees the new city
 * on their next visit, and everyone else never pays for the call. Past a month the guess is not shown at all,
 * because opening a returning guest on a city they were in last summer is worse than opening on their time zone.
 */
const RECHECK_MS = 6 * 60 * 60 * 1000;
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

/** The place the guest last chose themselves. Kept so a guess never overrules a decision. */
function savedPlace(): Place | null {
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

/**
 * The city, or Anywhere, the guest last chose themselves.
 *
 * Picking a city was a decision the site forgot the moment the tab closed: `setMetro` cleared the remembered
 * point and stored nothing, so the next visit guessed again and could drop a guest who had deliberately chosen
 * Denver back into wherever their address resolves. Anywhere counts as a choice too, and is stored as itself.
 */
function savedMetro(): string | null {
  try {
    const id = localStorage.getItem(METRO_KEY);
    return id && id !== ALL_METRO_ID && metroById(id) ? id : null;
  } catch {
    return null;
  }
}

export function rememberMetro(id: string | null): void {
  try {
    // Anywhere is this visit, not a lock. Storing it meant the next load painted the whole US and Canada
    // instead of the guest's own town, which is the flicker this file exists to stop.
    if (!id || id === ALL_METRO_ID) localStorage.removeItem(METRO_KEY);
    else localStorage.setItem(METRO_KEY, id);
  } catch {
    /* private mode */
  }
}

/** The metro whose centre is nearest a point, within `maxKm`. */
export function nearestMetro(lat: number, lon: number, maxKm = 240): { id: string; km: number } | null {
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
 * around them. So a coarse guess names the metro, and the home waits for GPS rather than painting that metro as
 * if it were here. GPS, once it answers, is the pin the cards measure from.
 */
export type Guess = { kind: "point"; place: Place } | { kind: "metro"; metroId: string } | null;

/**
 * Are these the same answer? A recheck that agrees must change nothing, or every visit past the first would
 * re-dispatch the place it is already showing, and the home would rebuild all of its rails to draw the same
 * cards in the same order. Points are compared loosely: Cloudflare moves a city's centroid by a few hundred
 * metres between reads, which is not the guest moving.
 */
export function sameGuess(a: Guess, b: Guess): boolean {
  if (!a || !b) return !a && !b;
  if (a.kind !== b.kind) return false;
  if (a.kind === "metro" && b.kind === "metro") return a.metroId === b.metroId;
  if (a.kind === "point" && b.kind === "point") return Math.abs(a.place.lat - b.place.lat) < 0.02 && Math.abs(a.place.lon - b.place.lon) < 0.02;
  return false;
}

type StoredGuess = { at: number; guess: Guess };

/** The last answer the API gave, if it is recent enough to open on. `age` drives whether it is checked again. */
function storedGuess(): { guess: Guess; age: number } | null {
  try {
    const raw = localStorage.getItem(GUESS_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<StoredGuess>;
    const age = Date.now() - Number(v?.at || 0);
    if (!Number.isFinite(age) || age < 0 || age > KEEP_MS) return null;
    const g = v.guess;
    if (g && g.kind === "metro" && metroById(g.metroId)) return { guess: g, age };
    if (g && g.kind === "point" && typeof g.place?.lat === "number" && typeof g.place?.lon === "number" && typeof g.place?.label === "string") return { guess: g, age };
    return null;
  } catch {
    return null;
  }
}

function rememberGuess(g: Guess): void {
  try {
    if (g) localStorage.setItem(GUESS_KEY, JSON.stringify({ at: Date.now(), guess: g } satisfies StoredGuess));
  } catch {
    /* private mode */
  }
}

/**
 * A GPS fix, stored so the next visit opens on it without waiting for another prompt. It is always a point,
 * so it says so: typed as the nullable `Guess` it made every caller re-check a `null` that cannot happen.
 */
export function rememberCoords(lat: number, lon: number): NonNullable<Guess> {
  const g: NonNullable<Guess> = { kind: "point", place: { label: "Near me", sub: "Current location", lat, lon } };
  rememberGuess(g);
  return g;
}

/**
 * An IP city that is not the clock's city is a datacenter, not the guest. Keep the clock rather than
 * jumping Toronto to Virginia between the first paint and the /where round trip.
 */
export function ipGuessFitsClock(g: Guess, zoneMetro: string | null): boolean {
  if (!g || !zoneMetro) return true;
  if (g.kind === "metro") return g.metroId === zoneMetro;
  const near = nearestMetro(g.place.lat, g.place.lon, 400);
  return !near || near.id === zoneMetro;
}

/**
 * Where the home opens, decided before the first render and without touching the network.
 *
 * `chosen` is the guest's own decision and nothing later may overrule it. `recheck` says the API is worth
 * asking: either there is no stored answer or the stored one has aged past `RECHECK_MS`. A guest who was here
 * this morning gets neither a fetch nor a second render.
 */
export type Opening = { guess: Guess; chosen: boolean; recheck: boolean };

/**
 * What the home is allowed to show before GPS answers.
 *
 * A stored or typed point is already a pin, so the rails can draw. A city the guest picked themselves is their
 * decision. A clock or IP metro is not: America/Toronto is Waterloo as much as it is Toronto, and filtering the
 * catalog on `metroId === "toronto"` dumps KW shops and downtown Toronto into one bucket with no distance.
 * Wait, then use the GPS pin. The clock city is only the fallback when the browser will not give a fix.
 */
export function openingFeed(open: Opening): NonNullable<Guess> | { kind: "wait" } {
  const g = open.guess;
  if (g?.kind === "point") {
    // A GPS pin or a town they typed. An IP city centroid is not a pin: wait for GPS.
    if (open.chosen || g.place.label === "Near me") return g;
    return { kind: "wait" };
  }
  if (g?.kind === "metro" && open.chosen) return g;
  return { kind: "wait" };
}

/**
 * Should the app be asking the browser where the guest is?
 *
 * Only once they are looking at the home. A listing link (`#o=`, `#remove=`) opens that one business and a
 * claim link opens the dashboard, and neither is a reason to put a location prompt in front of a stranger.
 *
 * It is a question about the screen, not about the URL the visit started on. Asked of the opening URL alone,
 * a guest whose first ever visit was a shared listing link never asked and never stopped waiting either: the
 * feed opens in `locating`, so "Back to results" left the home as two skeleton rails that stayed there.
 */
export function shouldLocate(view: { screen: string; sheet: string | null }, alreadyPlaced: boolean): boolean {
  if (alreadyPlaced) return false;
  return view.screen !== "operator" && view.sheet !== "request";
}

export function opening(): Opening {
  const mine = savedPlace();
  if (mine) return { guess: { kind: "point", place: mine }, chosen: true, recheck: false };
  const metroId = savedMetro();
  if (metroId) return { guess: { kind: "metro", metroId }, chosen: true, recheck: false };
  const zone = metroFromTimeZone();
  const zoneGuess: Guess = zone ? { kind: "metro", metroId: zone } : null;
  const stored = storedGuess();
  if (stored) {
    const stale = stored.age > RECHECK_MS;
    // An IP city that is not the clock's city is last week's trip or a datacenter. Show the clock until GPS
    // confirms they are still there, rather than painting Florida and then jumping.
    if (zone && !ipGuessFitsClock(stored.guess, zone)) {
      return { guess: zoneGuess, chosen: false, recheck: true };
    }
    return { guess: stored.guess, chosen: false, recheck: stale };
  }
  return { guess: zoneGuess, chosen: false, recheck: true };
}

/**
 * Ask the API where the caller is. Only called when `opening()` said a stored answer is missing or old, so
 * this is off the first paint's path entirely: whatever it returns refines a home that is already drawn.
 *
 * The time zone is still the fallback when the API cannot be reached, and it is not stored when it is: a
 * fallback is not an answer, and caching it would stop the next visit from asking again.
 */
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
        const g: Guess = w.city
          ? { kind: "point", place: { label: w.city, sub: w.region || "", lat: w.lat, lon: w.lon, region: w.region } }
          : (() => {
              const m = nearestMetro(w.lat, w.lon);
              return m ? { kind: "metro" as const, metroId: m.id } : null;
            })();
        if (g) {
          rememberGuess(g);
          return g;
        }
      }
    }
  } catch {
    /* the guess is optional; the time zone still has a say */
  }
  return coarse();
}
