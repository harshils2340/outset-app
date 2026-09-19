import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db, nowIso } from "../db/client.ts";
import { normalizePhone } from "../scrape/run.ts";
import { METROS, categoryById, inferCategory, nearestMetro, type CategoryDef } from "../taxonomy/catalog.ts";
import { CITIES, type City } from "./cities.ts";
import { termsForCategories, type SearchTerm } from "./searchterms.ts";

/**
 * Search-based discovery through a Google Maps SERP provider (SerpApi, Serper or SearchApi.io; picked by key shape).
 * One query per city and search term (see searchterms.ts: one to three Google phrasings per taxonomy category),
 * e.g. "cooking classes" around Toronto ON, 20 results a page. Every result is a real listed business with Google's
 * name, address, phone, website, rating and review count. Responses are cached on disk per term, city and page so
 * reruns cost nothing. Keys rotate when one runs out of credits. We never invent facts.
 *
 * Provider pricing, read from the providers' public pages on 16 September 2026 (one Maps page = one request):
 * - Serper (serper.dev): pay-as-you-go credits, valid 6 months. 50k credits $50 ($1.00/1k), 500k $375 ($0.75/1k),
 *   2.5M $1,250 ($0.50/1k), 12.5M $3,750 ($0.30/1k). 2,500 free queries on signup, no card. A query asking for more
 *   than 10 results costs 2 credits; this module sends no `num`, so it budgets 1 credit per page.
 * - SerpApi (serpapi.com/pricing): monthly plans. Free 250 searches; Starter $25 for 1,000 ($25/1k); Developer $75 for
 *   5,000 ($15/1k); Production $150 for 15,000 ($10/1k); Big Data $275 for 30,000 ($9.17/1k); Searcher $725 for
 *   100,000 ($7.25/1k).
 * - SearchApi.io (searchapi.io/pricing): 100 free requests; Developer $40 for 10,000 ($4/1k); Production $100 for
 *   35,000 ($3/1k); BigData $250 for 100,000 ($2.50/1k).
 * `--dry-run` on the `search` command prices a run with these numbers before anything is sent.
 */

/** USD per 1,000 requests at the smallest paid tier that fits a full run, from the header above. */
export const PRICE_PER_1K_USD: Record<ProviderId, number> = { serper: 1.0, serpapi: 7.25, searchapi: 2.5 };
export const PRICING_DATE = "16 September 2026";

const here = dirname(fileURLToPath(import.meta.url));
const cacheDir = join(here, "../../data/searchapi");
/**
 * One line per request we actually paid for, so the money this module spends is visible to the same cap that
 * guards the model calls. Without it a Maps run was free as far as `paidSpendUsd()` could tell, and the
 * pipeline's paid cap could not stop, or even see, a run across every city and term.
 */
const ledgerPath = join(here, "../../data/searchapi-ledger.txt");
const ENDPOINT = "https://www.searchapi.io/api/v1/search";
const SERPAPI = "https://serpapi.com/search.json";

const SERPER = "https://google.serper.dev/maps";

/** Provider by key format: SerpApi 64 hex, Serper 40 hex, SearchApi short base62. All three return Google Maps listings. */
export type ProviderId = "serpapi" | "serper" | "searchapi";
export function providerOf(key: string): ProviderId {
  if (/^[0-9a-f]{64}$/i.test(key)) return "serpapi";
  if (/^[0-9a-f]{40}$/i.test(key)) return "serper";
  return "searchapi";
}

export type SerperPlace = {
  title?: string; address?: string; phoneNumber?: string; website?: string; rating?: number; ratingCount?: number;
  type?: string; types?: string[]; latitude?: number; longitude?: number; placeId?: string; cid?: string;
};

export function fromSerper(p: SerperPlace): Place {
  return {
    title: p.title, address: p.address, phone: p.phoneNumber, website: p.website, rating: p.rating, reviews: p.ratingCount,
    type: p.type || p.types?.[0], types: p.types, place_id: p.placeId || (p.cid ? "cid-" + p.cid : undefined),
    gps_coordinates: { latitude: p.latitude, longitude: p.longitude },
  };
}

export type Place = {
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

function cachePathFor(q: string, city: City, page: number): string {
  return join(cacheDir, slug(q + "-" + city.name + "-" + city.region + "-p" + page) + ".json");
}

/** True when this term, city and page is already on disk, so running it costs nothing. */
export function isCached(q: string, city: City, page = 1): boolean {
  return existsSync(cachePathFor(q, city, page));
}

/**
 * A request that will be billed. Called once the provider has answered with something other than a refusal:
 * "not enough credits", an unauthorised key and a rate limit cost nothing, and counting them would have the cap
 * closing in on a number no card ever saw. A request that times out is not counted either, which undercounts by
 * the rare timeout and is the side to err on for a guard that stops work.
 */
function recordSpend(provider: ProviderId, q: string, city: City): void {
  try {
    appendFileSync(ledgerPath, [new Date().toISOString(), provider, q, city.name + " " + city.region].join("\t") + "\n");
  } catch {
    /* the ledger is accounting, never a reason to stop a run */
  }
}

/** USD billed by this module so far, from the ledger. Cache hits are not in it, because they cost nothing. */
export function searchSpendUsd(): number {
  try {
    let usd = 0;
    for (const line of readFileSync(ledgerPath, "utf8").split("\n")) {
      if (!line) continue;
      const prov = line.split("\t")[1] as ProviderId;
      usd += (PRICE_PER_1K_USD[prov] ?? PRICE_PER_1K_USD.searchapi) / 1000;
    }
    return usd;
  } catch {
    return 0;
  }
}

/**
 * The same ledger, added up per UTC day, for the spend-over-time line on the internal metrics page. Each line
 * starts with the ISO timestamp of the request, so the day is the first ten characters; a line written before
 * the timestamp column existed has no day to file it under and is left out of the series rather than dated
 * today, which would draw a spike on a day nothing was spent. The totals on the page still come from
 * searchSpendUsd(), so nothing is lost, only unplaced.
 */
export function searchSpendByDay(): Map<string, number> {
  const by = new Map<string, number>();
  try {
    for (const line of readFileSync(ledgerPath, "utf8").split("\n")) {
      if (!line) continue;
      const [at, prov] = line.split("\t");
      const day = (at || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      by.set(day, (by.get(day) || 0) + (PRICE_PER_1K_USD[prov as ProviderId] ?? PRICE_PER_1K_USD.searchapi) / 1000);
    }
  } catch {
    /* no ledger yet */
  }
  return by;
}

export async function searchPlaces(q: string, city: City, page: number, ring: KeyRing): Promise<{ places: Place[]; cached: boolean }> {
  mkdirSync(cacheDir, { recursive: true });
  const cachePath = cachePathFor(q, city, page);
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
      if (res.status === 400) {
        const body = await res.text();
        if (/credits/i.test(body)) {
          if (!ring.retire()) throw new CreditsExhausted("Search credits exhausted on every key");
          continue;
        }
        throw new Error("Serper HTTP 400 for " + q + " " + city.name + ": " + body.slice(0, 120));
      }
      if (!res.ok) throw new Error("Serper HTTP " + res.status + " for " + q + " " + city.name);
      recordSpend(prov, q, city);
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
    recordSpend(prov, q, city);
    const json = (await res.json()) as PlacesResponse;
    writeFileSync(cachePath, JSON.stringify(json));
    return { places: json.local_results || [], cached: false };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type SearchStats = { queries: number; results: number; inserted: number; merged: number; skipped: number; stoppedEarly: boolean };

/**
 * Prepared once, not once per result. These four run for every place a run sees, so re-preparing them meant
 * parsing and planning four statements per listing, tens of thousands of times in a pass.
 */
const prepared = new Map<string, ReturnType<typeof db.prepare>>();
const stmt = (sql: string) => {
  let s = prepared.get(sql);
  if (!s) prepared.set(sql, (s = db.prepare(sql)));
  return s;
};
const findByDomain = () => stmt("SELECT id FROM operators WHERE domain = ?");
const findByPhone = () => stmt("SELECT id FROM operators WHERE phone = ? AND phone IS NOT NULL");
const findByNameCity = () => stmt("SELECT id FROM operators WHERE lower(name) = lower(?) AND lower(city) = lower(?)");
const findByNameNear = () => stmt("SELECT id FROM operators WHERE lower(name) = lower(?) AND lat IS NOT NULL AND abs(lat - ?) < 0.02 AND abs(lon - ?) < 0.02");

/**
 * Google's own business type beats the term we searched with. Order matters: a specific type ("climbing gym",
 * "boxing gym", "pool hall", "mini golf") is listed before the generic word it contains ("gym", "pool", "golf").
 */
const TYPE_TO_CATEGORY: [RegExp, string][] = [
  [/escape room/i, "escape"], [/go-?kart|karting/i, "kart"], [/axe throwing/i, "axe"], [/paintball/i, "paintball"],
  [/skydiv|parachut/i, "skydive"], [/helicopter/i, "heli"], [/balloon/i, "balloon"], [/parasail/i, "parasail"],
  [/paraglid|hang glid/i, "paragliding"], [/glider|gliding|soaring/i, "gliding"],
  [/rage room|smash room/i, "rage"], [/laser tag/i, "lasertag"], [/trampoline/i, "trampoline"], [/bowling/i, "bowling"],
  [/miniature golf|mini golf|putt/i, "minigolf"], [/disc golf|driving range/i, "discgolf"], [/golf course|golf club|country club/i, "golf"],
  [/arcade|amusement center|family entertainment/i, "arcade"], [/water park/i, "waterpark"], [/amusement park|theme park/i, "themepark"],
  [/\bzoo\b|wildlife park|safari park|animal park/i, "zoo"], [/aquarium/i, "aquarium"], [/karaoke/i, "karaoke"],
  [/rock climbing|climbing gym|bouldering/i, "climbing"], [/ice skating|ice rink|skating rink/i, "icerink"],
  // Most places a guest can book range time at call themselves a club, and `club$` in NOISE would have thrown
  // every one of them away: Silverdale Gun Club, Ontario, typed "Gun club", is the example that found this.
  [/shooting range|gun range|gun club|shooting club|rifle club|pistol club|trap club|skeet club|rod and gun|sportsman|sportsmen|firearms/i, "range"],
  [/archery/i, "archery"],
  [/zip ?line|aerial adventure|ropes course|adventure park/i, "zipline"], [/ski resort|ski school|ski area|snowboard/i, "ski"],
  [/snowmobile/i, "snowmobile"], [/rafting|tubing/i, "rafting"], [/scuba|dive shop|dive center|diving|snorkel/i, "scuba"],
  [/surf/i, "surf"], [/bicycle rental|bike rental|e-bike/i, "bike"],
  [/brewery|brewpub|beer hall|taproom/i, "brewery"], [/winery|vineyard|wine bar|wine tasting/i, "winery"], [/distillery/i, "distillery"],
  [/cooking school|cooking class|culinary school|culinary/i, "cooking"],
  [/day spa|\bspa\b|massage/i, "spa"], [/sauna|bath ?house/i, "sauna"], [/yoga/i, "yoga"], [/dance/i, "dance"],
  [/pottery|ceramic|art studio|art school|paint and sip|painting class/i, "pottery"],
  [/comedy club|theater|theatre|performing arts|concert hall/i, "theatre"], [/museum|art gallery|gallery|planetarium|science center/i, "museum"],
  [/botanical garden|arboretum|garden/i, "garden"], [/campground|glamping|rv park/i, "camping"],
  [/pickleball|tennis|racquet/i, "tennis"], [/pool hall|billiard|snooker|darts/i, "billiards"], [/swim|\bpool\b|aquatic center/i, "swim"],
  [/martial arts|boxing|karate|jiu|taekwondo|kickbox|\bmma\b|muay/i, "martialarts"], [/gymnastics|cheer|tumbling/i, "gymnastics"],
  [/pilates|fitness|\bgym\b|spin|barre|crossfit|cycling studio|indoor cycling/i, "fitness"],
  [/event venue|banquet|wedding venue|party|\bvenue\b/i, "venue"],
  [/atv|off-?road|motorsport|race track|racing|dirt bike|utv|motocross|speedway/i, "motorsport"],
  [/horse|stable|equestrian|trail rid/i, "horse"], [/fishing charter|fishing guide|charter fishing|fishing/i, "fishing"],
  [/paddleboard|stand up paddle|\bsup\b/i, "paddleboard"], [/kayak|canoe|paddle|rowing/i, "kayak"],
  [/jet ?ski|water sports equipment rental|ski rental/i, "jetski"], [/pontoon|boat rental/i, "pontoon"],
  [/sailing school|sailing club|yacht club/i, "sailing"],
  [/boat tour|cruise|sailing|sightseeing|yacht|catamaran|dolphin|whale/i, "cruise"],
  [/tour operator|walking tour|food tour|tour agency|\btours?\b/i, "tour"],
];

/** The category Google's business type points at, or null when the type says nothing we file under. */
export function categoryOfType(p: Place): string | null {
  const blob = [p.type || "", ...(p.types || [])].join(" | ");
  for (const [re, cat] of TYPE_TO_CATEGORY) if (re.test(blob)) return cat;
  return null;
}

export function refineCategory(queryCategory: string, p: Place): string {
  const name = p.title || "";
  // Name-based hints first: "Jet Ski & Kayak" sites are usually typed as generic boat rental.
  const byName = inferCategory(name);
  const strongName = /jet ?ski|waverunner|kayak|canoe|paddle|pontoon|parasail|skydiv|helicopter|balloon|escape room|kart|axe|paintball|horse|charter|fishing|cruise|sail/i.test(name);
  if (strongName && byName.id !== "jetski") return byName.id;
  if (strongName && /jet ?ski|waverunner/i.test(name)) return "jetski";
  return categoryOfType(p) || queryCategory;
}

/** The columns a Google Maps result becomes on the operators table. Same shape for every provider. */
export type OperatorRow = {
  domain: string; name: string; website: string | null; phone: string | null; street: string | null; postal: string | null;
  metro_id: string | null; city: string | null; region: string | null; country: "US" | "CA"; family: CategoryDef["family"];
  category_id: string; icon_key: string; lat: number | null; lon: number | null; rating: number | null; review_count: number | null;
  google_type: string | null;
};

/**
 * Map a place to an operator row, or null with the reason it is skipped. Pure: no database.
 * A place with no website is kept: its domain becomes `gplace-<place id>` so it can still be claimed and merged later.
 * Google's type is checked against the taxonomy before the noise list, so a "Comedy club" or "Trampoline park" survives
 * the `club$` and `park$` rules that keep yacht clubs and state parks out of the water and air results.
 */
export function placeToOperator(p: Place, categoryId: string, city: City): { row: OperatorRow } | { skip: string } {
  const websiteRaw = p.website ? p.website.replace(/[?#].*$/, "") : undefined;
  const name = (p.title || "").trim();
  if (name.length < 3) return { skip: "no name" };
  if (p.type && !categoryOfType(p) && NOISE.test(p.type)) return { skip: "noise type: " + p.type };
  const cat = categoryById(refineCategory(categoryId, p)) || categoryById(categoryId);
  if (!cat) return { skip: "unknown category " + categoryId };

  const host = hostOf(websiteRaw);
  const website = websiteRaw && host && !SOCIAL.test(host) ? websiteRaw : null;
  const domain = website && host ? host : "gplace-" + (p.place_id || slug(name + "-" + city.name));
  const phone = normalizePhone(p.phone);
  const addr = parseAddress(p.address, city);
  const lat = p.gps_coordinates?.latitude ?? null;
  const lon = p.gps_coordinates?.longitude ?? null;
  // A web-search hit carries no pin, only the city it was searched from; that city center places it in a metro.
  // Without this every websearch row stayed metro-less and never reached a city page (5,300 rows by mid September 2026).
  const metro = lat != null && lon != null ? nearestMetro(lat, lon, 160) : nearestMetro(city.lat, city.lon, 160);
  return {
    row: {
      domain, name, website, phone, street: addr.street, postal: addr.postal, metro_id: metro?.id || null, city: addr.city,
      region: addr.region, country: city.country, family: cat.family, category_id: cat.id, icon_key: cat.iconKey, lat, lon,
      rating: p.rating ?? null, review_count: p.reviews ?? null, google_type: p.type || null,
    },
  };
}

/** Insert a place, or fill blanks on an operator we already know by domain, phone, or name and city. */
export function upsertPlace(p: Place, categoryId: string, city: City, stats: SearchStats): void {
  const mapped = placeToOperator(p, categoryId, city);
  if ("skip" in mapped) return void stats.skipped++;
  const r = mapped.row;
  const now = nowIso();

  const existing =
    (findByDomain().get(r.domain) as { id: string } | undefined) ||
    (r.phone ? (findByPhone().get(r.phone) as { id: string } | undefined) : undefined) ||
    (findByNameCity().get(r.name, r.city || city.name) as { id: string } | undefined) ||
    (r.lat != null && r.lon != null ? (findByNameNear().get(r.name, r.lat, r.lon) as { id: string } | undefined) : undefined);

  if (existing) {
    stmt(
      `UPDATE operators SET
        website = COALESCE(website, ?), phone = COALESCE(phone, ?), street = COALESCE(street, ?), city = COALESCE(city, ?),
        region = COALESCE(region, ?), postal = COALESCE(postal, ?), lat = COALESCE(lat, ?), lon = COALESCE(lon, ?),
        metro_id = COALESCE(metro_id, ?),
        rating = CASE WHEN ? IS NOT NULL AND (review_count IS NULL OR ? >= review_count) THEN ? ELSE rating END,
        review_count = CASE WHEN ? IS NOT NULL AND (review_count IS NULL OR ? >= review_count) THEN ? ELSE review_count END,
        updated_at = ?
       WHERE id = ?`,
    ).run(
      r.website, r.phone, r.street, r.city, r.region, r.postal, r.lat, r.lon, r.metro_id,
      r.review_count, r.review_count, r.rating,
      r.review_count, r.review_count, r.review_count,
      now, existing.id,
    );
    stats.merged++;
    return;
  }

  stmt(
    `INSERT INTO operators (
      id, domain, name, website, phone, street, postal, metro_id, city, region, country, family, category_id, icon_key,
      claim_status, booking_mode, origin, completeness, lat, lon, rating, review_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unclaimed', 'request', 'search', 0, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(), r.domain, r.name, r.website, r.phone, r.street, r.postal, r.metro_id, r.city, r.region, r.country,
    r.family, r.category_id, r.icon_key, r.lat, r.lon, r.rating, r.review_count, now, now,
  );
  if (r.google_type) {
    stmt(
      "INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?, (SELECT id FROM operators WHERE domain = ?), 'google_category', ?, 'searchapi:google_maps', 'listed')",
    ).run(randomUUID(), r.domain, r.google_type);
  }
  stats.inserted++;
}

function distKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const d = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(d(bLat - aLat) / 2) ** 2 + Math.cos(d(aLat)) * Math.cos(d(bLat)) * Math.sin(d(bLon - aLon) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * The city string this source searches from for a metro id ("toronto" -> Toronto ON, "tampa" -> Tampa FL).
 * The nearest entry in CITIES within 30 km is used so the cache keys of the original run still match; a metro with no
 * city that close is searched from its own centre. Unknown ids return null.
 */
export function cityForMetro(metroId: string): City | null {
  const m = METROS.find((x) => x.id === metroId);
  if (!m) return null;
  let best: City | null = null;
  let bestKm = 30;
  for (const c of CITIES) {
    const km = distKm(m.lat, m.lon, c.lat, c.lon);
    if (km < bestKm) { best = c; bestKm = km; }
  }
  return best || { name: m.name, region: m.region, country: m.country, lat: m.lat, lon: m.lon };
}

export type SearchScope = {
  categories?: string[];
  cities?: string[];
  metros?: string[];
  /** One phrasing per category instead of all of them: more of the map for the same number of credits. */
  onePer?: boolean;
};

/** Cities in scope: --metro ids first (all when "all"), else --cities names or region codes, else the whole grid. */
export function citiesInScope(opts: SearchScope): City[] {
  if (opts.metros?.length) {
    const ids = opts.metros.includes("all") ? METROS.map((m) => m.id) : opts.metros;
    const out: City[] = [];
    for (const id of ids) {
      const c = cityForMetro(id);
      if (!c) throw new Error("Unknown metro id: " + id + ". Ids are in src/taxonomy/catalog.ts METROS.");
      if (!out.some((x) => x.name === c.name && x.region === c.region)) out.push(c);
    }
    return out;
  }
  if (opts.cities?.length) return CITIES.filter((c) => opts.cities!.includes(c.name) || opts.cities!.includes(c.region));
  return CITIES;
}

export type SearchJob = { term: SearchTerm; city: City };

export type SearchPlan = {
  jobs: SearchJob[];
  terms: SearchTerm[];
  cities: City[];
  categories: number;
  cached: number;
  paid: number;
  /** USD for the paid page-1 requests at each provider's rate in PRICE_PER_1K_USD. */
  costUsd: Record<ProviderId, number>;
};

/** Every term x city the run would visit, how many are already cached, and what the rest would cost. Sends nothing. */
export function planSearch(opts: SearchScope & { budget?: number }): SearchPlan {
  const terms = termsForCategories(opts.categories, { onePer: opts.onePer });
  const cities = citiesInScope(opts);
  const jobs: SearchJob[] = [];
  for (const city of cities) for (const term of terms) jobs.push({ term, city });
  const cached = jobs.filter((j) => isCached(j.term.q, j.city, 1)).length;
  const paid = Math.min(jobs.length - cached, opts.budget ?? Infinity);
  const costUsd = Object.fromEntries(
    (Object.keys(PRICE_PER_1K_USD) as ProviderId[]).map((p) => [p, Math.round((paid / 1000) * PRICE_PER_1K_USD[p] * 100) / 100]),
  ) as Record<ProviderId, number>;
  return { jobs, terms, cities, categories: new Set(terms.map((t) => t.categoryId)).size, cached, paid, costUsd };
}

export async function discoverSearch(opts: SearchScope & {
  keys: string[];
  concurrency?: number;
  maxPages?: number;
  /** Paid requests allowed for the whole run, every worker and page together. Cache hits are free and do not count. */
  budget?: number;
}): Promise<SearchStats> {
  const stats: SearchStats = { queries: 0, results: 0, inserted: 0, merged: 0, skipped: 0, stoppedEarly: false };
  const ring = new KeyRing(opts.keys);
  const { jobs } = planSearch(opts);
  const maxPages = opts.maxPages ?? 1;
  const budget = opts.budget ?? Infinity;

  let next = 0;
  let stop = false;
  let reserved = 0; // paid requests handed out so far; claimed before the fetch so workers cannot overshoot together
  const worker = async () => {
    while (!stop && next < jobs.length) {
      const job = jobs[next++];
      try {
        for (let page = 1; page <= maxPages; page++) {
          const free = isCached(job.term.q, job.city, page);
          if (!free) {
            if (reserved >= budget) {
              stop = true;
              stats.stoppedEarly = true;
              break;
            }
            reserved++;
          }
          const { places, cached } = await searchPlaces(job.term.q, job.city, page, ring);
          if (!cached) stats.queries++;
          stats.results += places.length;
          for (const p of places) upsertPlace(p, job.term.categoryId, job.city, stats);
          if (places.length < 20) break;
        }
      } catch (e) {
        if (e instanceof CreditsExhausted) {
          stop = true;
          stats.stoppedEarly = true;
          console.error(e.message);
          return;
        }
        console.error(`${job.city.name} ${job.term.q}: ${(e as Error).message}`);
      }
      if (stats.queries % 25 === 0) {
        console.log(`${stats.queries} queries, ${stats.inserted} new, ${stats.merged} merged, ${stats.skipped} skipped`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 4, jobs.length) }, worker));
  return stats;
}
