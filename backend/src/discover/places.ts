import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DROP_HOSTS } from "./braveapi.ts";
import { hostOf, phoneE164, type Candidate } from "./chains.ts";
import { WEB_TERMS } from "./websearch.ts";
import { METROS, nearestMetro, type MetroDef } from "../taxonomy/catalog.ts";

/**
 * Google Places API (New) Text Search as a discovery source: for every "<activity> in <city>" pair, the businesses
 * Google Maps itself lists, with their own website, phone, pin, rating and review count. This is the floor Harshil
 * asked for: a search on Outset shows at least what Maps shows.
 *
 * Endpoint: POST https://places.googleapis.com/v1/places:searchText, headers X-Goog-Api-Key and X-Goog-FieldMask,
 * body { textQuery, pageSize: 20, pageToken, locationBias: 40 km circle on the metro pin }. Up to 3 pages
 * (60 results) per query, which is the API's ceiling. The bias is what makes "karate" in Waterloo return the
 * dojos Maps shows, instead of Toronto schools that match the city name in our metro grid.
 *
 * Price, read from developers.google.com/maps/billing-and-pricing/pricing and the Text Search reference on
 * 16 September 2026 (both pages "Last updated 2026-09-10"):
 *   - Text Search Essentials (IDs only)  free, unlimited: places.id, places.name, nextPageToken. No website.
 *   - Text Search Pro                    $32.00 per 1,000 requests, 5,000 free requests a month. displayName,
 *                                        formattedAddress, addressComponents, location, primaryType, types,
 *                                        businessStatus. Still no website.
 *   - Text Search Enterprise             $35.00 per 1,000 requests, 1,000 free requests a month. Adds websiteUri,
 *                                        nationalPhoneNumber, rating, userRatingCount, regularOpeningHours.
 *   - Text Search Enterprise + Atmosphere $40.00 per 1,000, 1,000 free a month. Reviews, summaries, amenities.
 * A request is billed at the highest tier of any field in its mask. A listing needs a site to read, and
 * websiteUri is an Enterprise field, so Enterprise is the cheapest SKU that does the job: every request below is
 * $0.035 after the first 1,000 in a calendar month. FIELD_MASK asks for nothing from the Atmosphere tier.
 * Each page of a query is one request. Prices above are the 0 to 100,000 requests a month band.
 *
 * Nothing is paid for twice: every raw page is cached under backend/data/places/ keyed by the query text, and
 * candidates are always rebuilt from the cache, so a better filter re-judges old answers for free. Every paid
 * request is appended to backend/data/places-ledger.txt (date, metro, term, page, HTTP status), the same way
 * aisearch-ledger.txt records model calls. Without GOOGLE_PLACES_API_KEY nothing is sent.
 *
 * Candidates go to backend/data/discovered/places-<metro>.json in the Candidate shape braveapi.ts writes
 * (source "web"), plus the Google place id, rating, review count, country and the query that found the place.
 * A place with no websiteUri is skipped: an operator we cannot read is not a listing. So is anything whose
 * businessStatus is not OPERATIONAL, and any site on an aggregator, directory or social host (DROP_HOSTS).
 * No database: this module runs anywhere, and scripts/import-discovered.mts inserts what it finds.
 */

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "../../data");
export const CACHE_DIR = join(dataDir, "places");
export const LEDGER = join(dataDir, "places-ledger.txt");
export const OUT_DIR = join(dataDir, "discovered");

export const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
/** Enterprise SKU, nothing above it. Every field here is read by candidateFromPlace. */
export const FIELD_MASK = [
  "places.id", "places.displayName", "places.formattedAddress", "places.addressComponents", "places.websiteUri",
  "places.nationalPhoneNumber", "places.rating", "places.userRatingCount", "places.location", "places.primaryType",
  "places.types", "places.businessStatus", "places.regularOpeningHours", "nextPageToken",
].join(",");
export const USD_PER_REQUEST = 0.035;
export const FREE_REQUESTS_PER_MONTH = 1000;
export const MAX_PAGES = 3;
export const PAGE_SIZE = 20;
/** Same afternoon radius the guest home uses. Maps ranks inside this circle, not the whole metro name. */
export const BIAS_RADIUS_M = 40_000;

export function locationBias(lat: number, lon: number, radiusM = BIAS_RADIUS_M): { circle: { center: { latitude: number; longitude: number }; radius: number } } {
  return { circle: { center: { latitude: lat, longitude: lon }, radius: radiusM } };
}

/** One search: an activity term (from WEB_TERMS, so the category is known) in one metro. */
export type PlacesQuery = { term: string; category: string; metro: MetroDef; text: string };

/** What the API returns for one place, limited to the mask above. Shape from the Text Search (New) reference. */
export type GooglePlace = {
  id?: string;
  displayName?: { text?: string; languageCode?: string };
  formattedAddress?: string;
  addressComponents?: { longText?: string; shortText?: string; types?: string[] }[];
  websiteUri?: string;
  nationalPhoneNumber?: string;
  rating?: number;
  userRatingCount?: number;
  location?: { latitude?: number; longitude?: number };
  primaryType?: string;
  types?: string[];
  businessStatus?: "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY" | string;
  regularOpeningHours?: { openNow?: boolean; weekdayDescriptions?: string[] };
};
export type PlacesResponse = { places?: GooglePlace[]; nextPageToken?: string; error?: { code?: number; message?: string; status?: string } };

/** One cached query: every page answered so far. `done` once the last page had no nextPageToken or 3 pages are in. */
export type CachedQuery = { text: string; metro: string; term: string; at: string; pages: PlacesResponse[]; done: boolean };

export type PlaceCandidate = Omit<Candidate, "region"> & {
  region: string;
  country: string;
  rating: number | null;
  reviewCount: number | null;
  placeId: string;
  query: string;
  hours: string[] | null;
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Metro ids and term filters to the query grid. A term filter matches a WEB_TERMS term or its category id. */
export function placesQueries(opts: { metros?: string[]; terms?: string[] }): PlacesQuery[] {
  const metroIds = (opts.metros || []).map((m) => m.trim().toLowerCase()).filter(Boolean);
  const metros = metroIds.length ? metroIds.map((id) => METROS.find((m) => m.id === id) || null) : METROS;
  const unknown = metroIds.filter((id) => !METROS.some((m) => m.id === id));
  if (unknown.length) throw new Error("unknown metro: " + unknown.join(", ") + ". Known: " + METROS.map((m) => m.id).join(", "));
  const filters = (opts.terms || []).map((t) => t.trim().toLowerCase()).filter(Boolean);
  const terms = filters.length ? WEB_TERMS.filter((t) => filters.some((f) => t.term.includes(f) || t.category === f)) : WEB_TERMS;
  if (filters.length && !terms.length) throw new Error("no term matches " + filters.join(", ") + ". Terms: " + WEB_TERMS.map((t) => t.term).join("; "));
  const out: PlacesQuery[] = [];
  for (const metro of metros) {
    if (!metro) continue;
    for (const t of terms) out.push({ term: t.term, category: t.category, metro, text: `${t.term} in ${metro.name}, ${metro.region}` });
  }
  return out;
}

export function cachePath(text: string): string {
  return join(CACHE_DIR, slug(text) + ".json");
}

export function readCached(text: string): CachedQuery | null {
  const p = cachePath(text);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as CachedQuery;
  } catch {
    return null;
  }
}

/** Requests a query still needs: 0 when done, else up to MAX_PAGES minus the pages already cached. */
export function pagesOwed(q: PlacesQuery): number {
  const c = readCached(q.text);
  if (!c) return MAX_PAGES;
  if (c.done) return 0;
  return Math.max(0, MAX_PAGES - c.pages.length);
}

export type PlacesRunStats = { queries: number; requests: number; failed: number; skippedCached: number; stopped?: string };

/**
 * Spend at most `budget` requests on the queries that are not fully cached, oldest in the list first. Each page is
 * written to disk and to the ledger the moment it lands, so a crash pays for nothing twice. Stops on 401/403
 * (bad key or the API not enabled), on 429 five times in a row, and when the budget is gone.
 */
export async function searchPlaces(queries: PlacesQuery[], opts: { key: string; budget: number; log?: (m: string) => void }): Promise<PlacesRunStats> {
  const log = opts.log || console.log;
  mkdirSync(CACHE_DIR, { recursive: true });
  const stats: PlacesRunStats = { queries: 0, requests: 0, failed: 0, skippedCached: 0 };
  let limited = 0;
  for (const q of queries) {
    if (stats.requests >= opts.budget) { stats.stopped = `budget of ${opts.budget} requests used`; break; }
    const cached = readCached(q.text) || { text: q.text, metro: q.metro.name, term: q.term, at: "", pages: [], done: false };
    if (cached.done) { stats.skippedCached += 1; continue; }
    stats.queries += 1;
    let pageToken: string | undefined = (cached.pages.at(-1) || {}).nextPageToken;
    if (cached.pages.length && !pageToken) { cached.done = true; writeFileSync(cachePath(q.text), JSON.stringify(cached, null, 1) + "\n"); continue; }
    while (cached.pages.length < MAX_PAGES) {
      if (stats.requests >= opts.budget) { stats.stopped = `budget of ${opts.budget} requests used`; break; }
      const body: Record<string, unknown> = {
        textQuery: q.text,
        pageSize: PAGE_SIZE,
        locationBias: locationBias(q.metro.lat, q.metro.lon),
      };
      if (pageToken) body.pageToken = pageToken;
      let res: Response;
      try {
        res = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json", "X-Goog-Api-Key": opts.key, "X-Goog-FieldMask": FIELD_MASK },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(20_000),
        });
      } catch (e) {
        stats.failed += 1;
        log(`  ${q.text}: ${(e as Error).message.slice(0, 80)}`);
        await sleep(3000);
        break;
      }
      // Google bills a successful request; a failure with these fields is not charged, but we count it so the
      // budget is a ceiling on attempts, not just on successes.
      stats.requests += 1;
      appendFileSync(LEDGER, `${new Date().toISOString()}\t${q.metro.name}\t${q.term}\tpage ${cached.pages.length + 1}\t${res.status}\n`);
      if (res.status === 429) {
        limited += 1;
        if (limited >= 5) { stats.stopped = "rate limited five times in a row"; break; }
        await sleep(5000 * limited);
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        stats.stopped = `Google answered ${res.status}: the key is wrong, restricted to another API, or Places API (New) is not enabled`;
        break;
      }
      if (!res.ok) {
        stats.failed += 1;
        log(`  ${q.text}: HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
        await sleep(1500);
        break;
      }
      limited = 0;
      const json = (await res.json()) as PlacesResponse;
      cached.pages.push(json);
      cached.at = new Date().toISOString();
      pageToken = json.nextPageToken;
      cached.done = !pageToken || cached.pages.length >= MAX_PAGES;
      writeFileSync(cachePath(q.text), JSON.stringify(cached, null, 1) + "\n");
      if (cached.done) break;
      await sleep(250);
    }
    if (stats.stopped && !/budget/.test(stats.stopped)) break;
  }
  return stats;
}

function component(p: GooglePlace, type: string, form: "longText" | "shortText" = "longText"): string | null {
  const c = (p.addressComponents || []).find((a) => (a.types || []).includes(type));
  return (c && c[form]) || null;
}

/**
 * One place to one candidate, or a reason it was dropped. Pure: no network, no disk. The website is required and
 * must be the operator's own host; the business must be open; the name must be real.
 */
export function candidateFromPlace(p: GooglePlace, q: Pick<PlacesQuery, "term" | "category" | "text" | "metro">): { candidate: PlaceCandidate } | { drop: string } {
  if (!p.id) return { drop: "no place id" };
  if (p.businessStatus && p.businessStatus !== "OPERATIONAL") return { drop: "not operational" };
  if (!p.websiteUri) return { drop: "no website" };
  const host = hostOf(p.websiteUri);
  if (!host) return { drop: "bad website url" };
  // DROP_HOSTS ends in a US-centric TLD list; tripadvisor.ca and yelp.ca are the same directories, so judge the
  // host with its public suffix swapped for .com as well.
  const asCom = host.replace(/\.(co\.)?[a-z]{2,3}$/i, ".com");
  if (DROP_HOSTS.test(host) || DROP_HOSTS.test(asCom)) return { drop: "aggregator, directory or social host" };
  const name = (p.displayName?.text || "").replace(/\s+/g, " ").trim();
  if (name.length < 3) return { drop: "no usable name" };
  const streetNo = component(p, "street_number");
  const route = component(p, "route");
  const street = route ? [streetNo, route].filter(Boolean).join(" ") : null;
  const city = component(p, "locality") || component(p, "postal_town") || component(p, "sublocality") || q.metro.name;
  const region = component(p, "administrative_area_level_1", "shortText") || q.metro.region;
  const country = component(p, "country", "shortText") || q.metro.country;
  const lat = typeof p.location?.latitude === "number" ? p.location.latitude : null;
  const lon = typeof p.location?.longitude === "number" ? p.location.longitude : null;
  return {
    candidate: {
      name: name.slice(0, 120),
      website: p.websiteUri,
      domain: host,
      street,
      city,
      region,
      country,
      postal: component(p, "postal_code"),
      lat,
      lon,
      phone: phoneE164(p.nationalPhoneNumber) || p.nationalPhoneNumber || null,
      kind: q.category,
      source: "web",
      sourceUrl: `https://www.google.com/maps/place/?q=place_id:${p.id}`,
      activity: q.term,
      rating: typeof p.rating === "number" ? p.rating : null,
      reviewCount: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
      placeId: p.id,
      query: q.text,
      hours: p.regularOpeningHours?.weekdayDescriptions?.length ? p.regularOpeningHours.weekdayDescriptions : null,
    },
  };
}

/** Candidates from every cached page of the given queries, one per place id then one per host. Pure apart from reading the cache. */
export function candidatesFromCache(queries: PlacesQuery[]): { candidates: PlaceCandidate[]; considered: number; dropped: Record<string, number> } {
  const dropped: Record<string, number> = {};
  const byPlace = new Map<string, PlaceCandidate>();
  let considered = 0;
  for (const q of queries) {
    const c = readCached(q.text);
    if (!c) continue;
    for (const page of c.pages) {
      for (const p of page.places || []) {
        considered += 1;
        const r = candidateFromPlace(p, q);
        if ("drop" in r) { dropped[r.drop] = (dropped[r.drop] || 0) + 1; continue; }
        if (!byPlace.has(r.candidate.placeId)) byPlace.set(r.candidate.placeId, r.candidate);
      }
    }
  }
  // Two Google places on one host are two locations of one operator; the importer keys rows by domain, keep the first.
  const byHost = new Map<string, PlaceCandidate>();
  for (const c of byPlace.values()) if (!byHost.has(c.domain)) byHost.set(c.domain, c);
  return { candidates: [...byHost.values()], considered, dropped };
}

/** Rebuild data/discovered/places-<metro>.json for every metro in the queries from the cache. */
export function writeCandidateFiles(queries: PlacesQuery[]): { file: string; count: number }[] {
  mkdirSync(OUT_DIR, { recursive: true });
  const out: { file: string; count: number }[] = [];
  const metroIds = [...new Set(queries.map((q) => q.metro.id))];
  for (const id of metroIds) {
    const { candidates } = candidatesFromCache(queries.filter((q) => q.metro.id === id));
    if (!candidates.length) continue;
    const file = join(OUT_DIR, `places-${id}.json`);
    writeFileSync(file, JSON.stringify(candidates, null, 1) + "\n");
    out.push({ file, count: candidates.length });
  }
  return out;
}

/** One Maps listing, after the same website / operational filters the batch job uses. */
export type NearbyHit = {
  placeId: string;
  name: string;
  website: string;
  host: string;
  lat: number;
  lon: number;
  rating: number | null;
  reviews: number | null;
  city: string;
  region: string;
  phone: string | null;
};

export function nearbyHitFromPlace(p: GooglePlace, metro: MetroDef): NearbyHit | null {
  if (!p.id) return null;
  if (p.businessStatus && p.businessStatus !== "OPERATIONAL") return null;
  const name = (p.displayName?.text || "").replace(/\s+/g, " ").trim();
  if (name.length < 3) return null;
  const lat = typeof p.location?.latitude === "number" ? p.location.latitude : null;
  const lon = typeof p.location?.longitude === "number" ? p.location.longitude : null;
  if (lat == null || lon == null) return null;
  const host = (p.websiteUri && hostOf(p.websiteUri)) || "";
  if (host) {
    const asCom = host.replace(/\.(co\.)?[a-z]{2,3}$/i, ".com");
    if (DROP_HOSTS.test(host) || DROP_HOSTS.test(asCom)) return null;
  }
  return {
    placeId: p.id,
    name: name.slice(0, 120),
    website: p.websiteUri || "",
    host,
    lat,
    lon,
    rating: typeof p.rating === "number" ? p.rating : null,
    reviews: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
    city: component(p, "locality") || component(p, "postal_town") || component(p, "sublocality") || metro.name,
    region: component(p, "administrative_area_level_1", "shortText") || metro.region,
    phone: phoneE164(p.nationalPhoneNumber) || p.nationalPhoneNumber || null,
  };
}

/**
 * One page of Text Search around a pin, the way Maps ranks "karate" near you. Cached on disk so a repeat
 * of the same words in the same ~1 km cell is free. Does not crawl the shop's site.
 */
export async function nearbyTextSearch(opts: { key: string; q: string; lat: number; lon: number }): Promise<NearbyHit[]> {
  const text = opts.q.trim().slice(0, 80);
  if (text.length < 2) return [];
  mkdirSync(CACHE_DIR, { recursive: true });
  const cacheFile = join(CACHE_DIR, "near-" + slug(text) + "-" + opts.lat.toFixed(2) + "-" + opts.lon.toFixed(2) + ".json");
  if (existsSync(cacheFile)) {
    try {
      return JSON.parse(readFileSync(cacheFile, "utf8")) as NearbyHit[];
    } catch {
      /* refetch */
    }
  }
  const metro = nearestMetro(opts.lat, opts.lon, 400) || METROS[0];
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Goog-Api-Key": opts.key, "X-Goog-FieldMask": FIELD_MASK },
    body: JSON.stringify({ textQuery: text, pageSize: PAGE_SIZE, locationBias: locationBias(opts.lat, opts.lon) }),
    signal: AbortSignal.timeout(12_000),
  });
  appendFileSync(LEDGER, `${new Date().toISOString()}\tnearby\t${text}\tpage 1\t${res.status}\n`);
  if (!res.ok) return [];
  const json = (await res.json()) as PlacesResponse;
  const hits = (json.places || []).map((p) => nearbyHitFromPlace(p, metro)).filter((h): h is NearbyHit => !!h);
  writeFileSync(cacheFile, JSON.stringify(hits, null, 1) + "\n");
  return hits;
}

/** Paid requests recorded in the ledger this calendar month (UTC), to say how much of the free 1,000 is left. */
export function requestsThisMonth(now = new Date()): number {
  if (!existsSync(LEDGER)) return 0;
  const prefix = now.toISOString().slice(0, 7);
  return readFileSync(LEDGER, "utf8").split("\n").filter((l) => l.startsWith(prefix)).length;
}

export const KEY_HELP = [
  "GOOGLE_PLACES_API_KEY is not set, so nothing was sent and nothing was spent.",
  "To get one: Google Cloud console -> APIs & Services -> Library -> enable \"Places API (New)\" (not the legacy Places API)",
  "-> Credentials -> Create credentials -> API key -> Edit key -> API restrictions -> Restrict key -> Places API (New) only.",
  "Billing must be on for the project. Put the key in backend/.env as GOOGLE_PLACES_API_KEY=... and rerun.",
  `Cost: Text Search Enterprise SKU, $${(USD_PER_REQUEST * 1000).toFixed(2)} per 1,000 requests after ${FREE_REQUESTS_PER_MONTH} free a month (pricing read 16 September 2026).`,
].join("\n");

/**
 * The `places` command. Parses --metro=, --terms=, --budget=N, --dry-run from argv, prints what it would do, and
 * only sends anything when a key is present and --dry-run is absent. Returns the exit code.
 */
export async function placesCommand(argv: string[], env: NodeJS.ProcessEnv = process.env, log: (m: string) => void = console.log): Promise<number> {
  const arg = (k: string) => argv.find((a) => a.startsWith("--" + k + "="))?.split("=").slice(1).join("=");
  const dry = argv.includes("--dry-run") || argv.includes("--dry");
  const budget = Number(arg("budget") || 200);
  let queries: PlacesQuery[];
  try {
    queries = placesQueries({ metros: arg("metro")?.split(","), terms: arg("terms")?.split(",") });
  } catch (e) {
    log((e as Error).message);
    return 1;
  }
  const owed = queries.map((q) => ({ q, pages: pagesOwed(q) }));
  const maxRequests = Math.min(budget, owed.reduce((n, o) => n + o.pages, 0));
  const minRequests = Math.min(budget, owed.filter((o) => o.pages > 0).length);
  const used = requestsThisMonth();
  const freeLeft = Math.max(0, FREE_REQUESTS_PER_MONTH - used);
  const paid = Math.max(0, maxRequests - freeLeft);
  log(`places: ${queries.length} queries (${[...new Set(queries.map((q) => q.metro.name))].join(", ")} x ${[...new Set(queries.map((q) => q.term))].length} terms), ${owed.filter((o) => o.pages === 0).length} already cached`);
  for (const o of owed) log(`  ${o.pages ? `${o.pages} page(s) to fetch` : "cached"}  ${o.q.text}`);
  log(`estimate: ${minRequests} to ${maxRequests} requests this run (budget ${budget}); ${used} requests already this month, ${freeLeft} of ${FREE_REQUESTS_PER_MONTH} free left; worst case $${(paid * USD_PER_REQUEST).toFixed(2)} (${paid} paid at $${USD_PER_REQUEST} each, Text Search Enterprise SKU)`);
  if (dry) {
    log("dry run: nothing sent.");
    return 0;
  }
  const key = env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    log(KEY_HELP);
    return 0;
  }
  const stats = await searchPlaces(queries, { key, budget, log });
  log(`places: ${stats.requests} requests, ${stats.queries} queries touched, ${stats.skippedCached} cached, ${stats.failed} failed${stats.stopped ? "; stopped: " + stats.stopped : ""}`);
  const files = writeCandidateFiles(queries);
  const { considered, dropped } = candidatesFromCache(queries);
  log(`candidates: ${files.map((f) => `${f.count} -> ${f.file}`).join("; ") || "none"} (from ${considered} places; dropped ${JSON.stringify(dropped)})`);
  log("next: npx tsx scripts/import-discovered.mts --dry");
  return 0;
}

/** Every cached query on disk, for reporting. */
export function cachedQueries(): CachedQuery[] {
  if (!existsSync(CACHE_DIR)) return [];
  return readdirSync(CACHE_DIR).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(CACHE_DIR, f), "utf8")) as CachedQuery);
}
