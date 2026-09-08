import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db, nowIso } from "../db/client.ts";
import { normalizePhone } from "../scrape/run.ts";
import { CATEGORIES, categoryById, inferCategory, nearestMetro } from "../taxonomy/catalog.ts";
import { CITIES, type City } from "./cities.ts";

/**
 * Search-based discovery through SearchApi.io (Google Maps results as JSON).
 * One query per city and category, e.g. "jet ski rental" around Clearwater FL, 20 results a page.
 * Every result is a real listed business with Google's name, address, phone, website, rating and position.
 * Responses are cached on disk per query so reruns cost nothing. Keys rotate when one runs out of credits.
 * We never invent facts.
 */

const here = dirname(fileURLToPath(import.meta.url));
const cacheDir = join(here, "../../data/searchapi");
const ENDPOINT = "https://www.searchapi.io/api/v1/search";
const SERPAPI = "https://serpapi.com/search.json";

const SERPER = "https://google.serper.dev/maps";

/** Provider by key format: SerpApi 64 hex, Serper 40 hex, SearchApi short base62. All three return Google Maps listings. */
type ProviderId = "serpapi" | "serper" | "searchapi";
function providerOf(key: string): ProviderId {
  if (/^[0-9a-f]{64}$/i.test(key)) return "serpapi";
  if (/^[0-9a-f]{40}$/i.test(key)) return "serper";
  return "searchapi";
}

type SerperPlace = {
  title?: string; address?: string; phoneNumber?: string; website?: string; rating?: number; ratingCount?: number;
  type?: string; types?: string[]; latitude?: number; longitude?: number; placeId?: string; cid?: string;
};

function fromSerper(p: SerperPlace): Place {
  return {
    title: p.title, address: p.address, phone: p.phoneNumber, website: p.website, rating: p.rating, reviews: p.ratingCount,
    type: p.type || p.types?.[0], types: p.types, place_id: p.placeId || (p.cid ? "cid-" + p.cid : undefined),
    gps_coordinates: { latitude: p.latitude, longitude: p.longitude },
  };
}

type Place = {
  title?: string;
  address?: string;
  gps_coordinates?: { latitude?: number; longitude?: number };
  rating?: number;
  reviews?: number;
  type?: string;
  types?: string[];
  phone?: string;
  website?: string;
  place_id?: string;
};

type PlacesResponse = { local_results?: Place[]; error?: string };

/** Comma-separated keys in SEARCHAPI_KEYS, or a single SEARCHAPI_KEY. A key that returns 402 or 403 is retired for the run. */
export class KeyRing {
  private keys: string[];
  private idx = 0;
  constructor(keys: string[]) {
    this.keys = keys.filter(Boolean);
    if (!this.keys.length) throw new Error("No SearchApi key. Put SEARCHAPI_KEY or SEARCHAPI_KEYS in backend/.env.");
  }
  current(): string {
    return this.keys[this.idx];
  }
  retire(): boolean {
    this.idx += 1;
    return this.idx < this.keys.length;
  }
  get remaining(): number {
    return this.keys.length - this.idx;
  }
}

export class CreditsExhausted extends Error {}

const SOCIAL = /facebook\.com|instagram\.com|twitter\.com|x\.com|yelp\.com|tripadvisor\.|linktr\.ee|google\.com|bit\.ly|booking\.com|viator\.com|getyourguide|airbnb\./i;
/** Google categories that are not bookable experiences even though they match the query words. */
const NOISE = /tackle|bait|supply|supplies|store$|shop$|dealer|manufacturer|repair|marine service|boat dealer|apparel|school district|association|club$|park$|preserve|state park|national park|campground|hotel|motel|resort$|real estate|insurance|storage|lawyer|veterinar|feed|farm supply|pier$|beach$|lake$|river$|restaurant|bar$|gas station|car wash|towing|salvage|boat yard|dry dock|welding/i;

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url.startsWith("http") ? url : "https://" + url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function parseAddress(addr: string | undefined, city: City): { street: string | null; city: string | null; region: string | null; postal: string | null } {
  if (!addr) return { street: null, city: city.name, region: city.region, postal: null };
  const parts = addr.split(",").map((p) => p.trim()).filter(Boolean);
  // Typical: "123 Main St, Clearwater, FL 33755, United States"
  const withoutCountry = parts.filter((p) => !/^(united states|usa|canada)$/i.test(p));
  const last = withoutCountry[withoutCountry.length - 1] || "";
  const m = last.match(/^([A-Z]{2})\s*([A-Z0-9 -]{3,10})?$/i);
  const region = m ? m[1].toUpperCase() : city.region;
  const postal = m && m[2] ? m[2].trim() : null;
  const cityName = withoutCountry.length >= 3 ? withoutCountry[withoutCountry.length - 2] : withoutCountry.length === 2 ? withoutCountry[0] : city.name;
  const street = withoutCountry.length >= 3 ? withoutCountry.slice(0, -2).join(", ") : null;
  return { street, city: cityName || city.name, region, postal };
}

export async function searchPlaces(q: string, city: City, page: number, ring: KeyRing): Promise<{ places: Place[]; cached: boolean }> {
  mkdirSync(cacheDir, { recursive: true });
  const key = slug(q + "-" + city.name + "-" + city.region + "-p" + page);
  const cachePath = join(cacheDir, key + ".json");
  if (existsSync(cachePath)) return { places: (JSON.parse(readFileSync(cachePath, "utf8")) as PlacesResponse).local_results || [], cached: true };

  let limited = 0;
  for (;;) {
    const apiKey = ring.current();
    const prov = providerOf(apiKey);
    if (prov === "serper") {
      const res = await fetch(SERPER, {
        method: "POST",
        headers: { "X-API-KEY": apiKey, "content-type": "application/json" },
        body: JSON.stringify({ q, ll: `@${city.lat},${city.lon},11z`, page }),
        signal: AbortSignal.timeout(60000),
      });
      if (res.status === 429) {
        limited += 1;
        if (limited >= 3) {
          limited = 0;
          if (!ring.retire()) throw new CreditsExhausted("Search credits exhausted on every key");
          continue;
        }
        await sleep(3000);
        continue;
      }
      if (res.status === 402 || res.status === 403 || res.status === 401) {
        if (!ring.retire()) throw new CreditsExhausted("Search credits exhausted on every key");
        continue;
      }
      if (!res.ok) throw new Error("Serper HTTP " + res.status + " for " + q + " " + city.name);
      const json = (await res.json()) as { places?: SerperPlace[] };
      const places = (json.places || []).map(fromSerper);
      writeFileSync(cachePath, JSON.stringify({ local_results: places, provider: "serper" }));
      return { places, cached: false };
    }
    const serp = prov === "serpapi";
    const params = new URLSearchParams({
      engine: "google_maps",
      q,
      ll: `@${city.lat},${city.lon},11z`,
      hl: "en",
      api_key: apiKey,
    });
    if (serp) {
      params.set("type", "search");
      if (page > 1) params.set("start", String((page - 1) * 20));
    } else {
      params.set("page", String(page));
    }
    const res = await fetch((serp ? SERPAPI : ENDPOINT) + "?" + params.toString(), { signal: AbortSignal.timeout(90000) });
    if (res.status === 429) {
      limited += 1;
      if (limited >= 3) {
        // Three rate limits in a row on one key means credits are gone, not a burst.
        limited = 0;
        if (!ring.retire()) throw new CreditsExhausted("Search credits exhausted on every key");
        continue;
      }
      await sleep(3000);
      continue;
    }
    if (res.status === 402 || res.status === 403 || res.status === 401) {
      if (!ring.retire()) throw new CreditsExhausted("Search credits exhausted on every key");
      continue;
    }
    if (!res.ok) throw new Error("SearchApi HTTP " + res.status + " for " + q + " " + city.name);
    const json = (await res.json()) as PlacesResponse;
    writeFileSync(cachePath, JSON.stringify(json));
    return { places: json.local_results || [], cached: false };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type SearchStats = { queries: number; results: number; inserted: number; merged: number; skipped: number; stoppedEarly: boolean };

const findByDomain = () => db.prepare("SELECT id FROM operators WHERE domain = ?");
const findByPhone = () => db.prepare("SELECT id FROM operators WHERE phone = ? AND phone IS NOT NULL");
const findByNameCity = () => db.prepare("SELECT id FROM operators WHERE lower(name) = lower(?) AND lower(city) = lower(?)");
const findByNameNear = () => db.prepare("SELECT id FROM operators WHERE lower(name) = lower(?) AND lat IS NOT NULL AND abs(lat - ?) < 0.02 AND abs(lon - ?) < 0.02");

/** Google's own business type beats the query we searched with. */
const TYPE_TO_CATEGORY: [RegExp, string][] = [
  [/escape room/i, "escape"], [/go-?kart|karting/i, "kart"], [/axe throwing/i, "axe"], [/paintball/i, "paintball"],
  [/skydiv|parachut/i, "skydive"], [/helicopter/i, "heli"], [/balloon/i, "balloon"], [/parasail/i, "parasail"],
  [/horse|stable|equestrian|trail rid/i, "horse"], [/fishing charter|fishing guide|charter fishing/i, "fishing"],
  [/kayak|canoe|paddle|rowing/i, "kayak"], [/jet ?ski|water sports equipment rental|ski rental/i, "jetski"],
  [/pontoon|boat rental/i, "pontoon"], [/boat tour|cruise|sailing|sightseeing|yacht|catamaran|dolphin|whale/i, "cruise"],
];

export function refineCategory(queryCategory: string, p: Place): string {
  const blob = [p.type || "", ...(p.types || [])].join(" | ");
  const name = p.title || "";
  // Name-based hints first: "Jet Ski & Kayak" sites are usually typed as generic boat rental.
  const byName = inferCategory(name);
  const strongName = /jet ?ski|waverunner|kayak|canoe|paddle|pontoon|parasail|skydiv|helicopter|balloon|escape room|kart|axe|paintball|horse|charter|fishing|cruise|sail/i.test(name);
  if (strongName && byName.id !== "jetski") return byName.id;
  if (strongName && /jet ?ski|waverunner/i.test(name)) return "jetski";
  for (const [re, cat] of TYPE_TO_CATEGORY) if (re.test(blob)) return cat;
  return queryCategory;
}

/** Insert a place, or fill blanks on an operator we already know by domain, phone, or name and city. */
export function upsertPlace(p: Place, categoryId: string, city: City, stats: SearchStats): void {
  if (p.website) p.website = p.website.replace(/[?#].*$/, "");
  const name = (p.title || "").trim();
  if (name.length < 3) return void stats.skipped++;
  if (p.type && NOISE.test(p.type)) return void stats.skipped++;
  const cat = categoryById(refineCategory(categoryId, p)) || categoryById(categoryId);
  if (!cat) return void stats.skipped++;

  const host = hostOf(p.website);
  const website = p.website && host && !SOCIAL.test(host) ? p.website : null;
  const domain = website && host ? host : "gplace-" + (p.place_id || slug(name + "-" + city.name));
  const phone = normalizePhone(p.phone);
  const addr = parseAddress(p.address, city);
  const lat = p.gps_coordinates?.latitude ?? null;
  const lon = p.gps_coordinates?.longitude ?? null;
  const metro = lat != null && lon != null ? nearestMetro(lat, lon, 160) : null;
  const now = nowIso();

  const existing =
    (findByDomain().get(domain) as { id: string } | undefined) ||
    (phone ? (findByPhone().get(phone) as { id: string } | undefined) : undefined) ||
    (findByNameCity().get(name, addr.city || city.name) as { id: string } | undefined) ||
    (lat != null && lon != null ? (findByNameNear().get(name, lat, lon) as { id: string } | undefined) : undefined);

  if (existing) {
    db.prepare(
      `UPDATE operators SET
        website = COALESCE(website, ?), phone = COALESCE(phone, ?), street = COALESCE(street, ?), city = COALESCE(city, ?),
        region = COALESCE(region, ?), postal = COALESCE(postal, ?), lat = COALESCE(lat, ?), lon = COALESCE(lon, ?),
        metro_id = COALESCE(metro_id, ?),
        rating = CASE WHEN ? IS NOT NULL AND (review_count IS NULL OR ? >= review_count) THEN ? ELSE rating END,
        review_count = CASE WHEN ? IS NOT NULL AND (review_count IS NULL OR ? >= review_count) THEN ? ELSE review_count END,
        updated_at = ?
       WHERE id = ?`,
    ).run(
      website, phone, addr.street, addr.city, addr.region, addr.postal, lat, lon, metro?.id || null,
      p.reviews ?? null, p.reviews ?? null, p.rating ?? null,
      p.reviews ?? null, p.reviews ?? null, p.reviews ?? null,
      now, existing.id,
    );
    stats.merged++;
    return;
  }

  db.prepare(
    `INSERT INTO operators (
      id, domain, name, website, phone, street, postal, metro_id, city, region, country, family, category_id, icon_key,
      claim_status, booking_mode, origin, completeness, lat, lon, rating, review_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unclaimed', 'request', 'search', 0, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(), domain, name, website, phone, addr.street, addr.postal, metro?.id || null, addr.city, addr.region, city.country,
    cat.family, cat.id, cat.iconKey, lat, lon, p.rating ?? null, p.reviews ?? null, now, now,
  );
  if (p.type) {
    db.prepare(
      "INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?, (SELECT id FROM operators WHERE domain = ?), 'google_category', ?, 'searchapi:google_maps', 'listed')",
    ).run(randomUUID(), domain, p.type);
  }
  stats.inserted++;
}

export async function discoverSearch(opts: {
  keys: string[];
  categories?: string[];
  cities?: string[];
  concurrency?: number;
  maxPages?: number;
  budget?: number;
}): Promise<SearchStats> {
  const stats: SearchStats = { queries: 0, results: 0, inserted: 0, merged: 0, skipped: 0, stoppedEarly: false };
  const ring = new KeyRing(opts.keys);
  const cats = opts.categories?.length ? CATEGORIES.filter((c) => opts.categories!.includes(c.id)) : CATEGORIES;
  const cities = opts.cities?.length ? CITIES.filter((c) => opts.cities!.includes(c.name) || opts.cities!.includes(c.region)) : CITIES;
  const maxPages = opts.maxPages ?? 1;
  const budget = opts.budget ?? Infinity;
  const jobs: { city: City; cat: (typeof CATEGORIES)[number] }[] = [];
  for (const city of cities) for (const cat of cats) jobs.push({ city, cat });

  let next = 0;
  let stop = false;
  const worker = async () => {
    while (!stop && next < jobs.length) {
      const job = jobs[next++];
      try {
        for (let page = 1; page <= maxPages; page++) {
          if (stats.queries >= budget) {
            stop = true;
            stats.stoppedEarly = true;
            break;
          }
          const { places, cached } = await searchPlaces(job.cat.searchQuery, job.city, page, ring);
          if (!cached) stats.queries++;
          stats.results += places.length;
          for (const p of places) upsertPlace(p, job.cat.id, job.city, stats);
          if (places.length < 20) break;
        }
      } catch (e) {
        if (e instanceof CreditsExhausted) {
          stop = true;
          stats.stoppedEarly = true;
          console.error(e.message);
          return;
        }
        console.error(`${job.city.name} ${job.cat.id}: ${(e as Error).message}`);
      }
      if (stats.queries % 25 === 0) {
        console.log(`${stats.queries} queries, ${stats.inserted} new, ${stats.merged} merged, ${stats.skipped} skipped`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 4, jobs.length) }, worker));
  return stats;
}
