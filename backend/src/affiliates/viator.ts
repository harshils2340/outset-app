import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db, nowIso } from "../db/client.ts";
import { METROS, nearestMetro } from "../taxonomy/catalog.ts";
import { sayLength } from "../../../src/lib/duration.ts";

/**
 * Viator affiliate feed: products the Viator Partner API licenses us to display (photos, descriptions,
 * prices, reviews) in return for sending the booking to viator.com on a partner-attributed link.
 *
 * This is the legal way to put Viator's inventory on our pages, and the only one used here: nothing in this
 * file reads viator.com's HTML. An affiliate key is free and immediate (viator.com partner account, Tools ->
 * Affiliate API), and Basic Access covers every content endpoint used below. Bookings never happen on Outset:
 * the guest is sent to `productUrl`, which the API returns already carrying our partner id, and Viator pays
 * commission on what they book there within its 30 day window.
 *
 * Licence terms this code honours (docs.viator.com/partner-api, "Managing product and availability data"):
 * cached product content must be refreshed inside 24 hours, ideally via /products/modified-since. Every row
 * carries `fetched_at`; the catalog sync publishes only rows fresher than MAX_AGE_HOURS, so a feed nobody
 * has refreshed drops off the site by itself rather than showing a stale price.
 *
 *   VIATOR_API_KEY   the affiliate key. Unset: every command says so and does nothing.
 *   VIATOR_SANDBOX=1 hit api.sandbox.viator.com instead of production (sandbox keys only work there).
 *   VIATOR_PID       partner id, appended to a booking URL that arrives without one (belt and braces; the
 *                    API's productUrl normally carries it already).
 */

export const MAX_AGE_HOURS = 48;

const KEY = () => (process.env.VIATOR_API_KEY || "").trim();
const BASE = () => (process.env.VIATOR_SANDBOX === "1" ? "https://api.sandbox.viator.com/partner" : "https://api.viator.com/partner");

export function viatorConfigured(): boolean {
  return !!KEY();
}

export type ViatorDestination = {
  destinationId: number;
  name: string;
  type?: string;
  parentDestinationId?: number;
  lookupId?: string;
  center?: { latitude?: number; longitude?: number };
};

export type ViatorImage = { variants?: { url?: string; width?: number; height?: number }[] };

export type ViatorProduct = {
  productCode: string;
  title?: string;
  description?: string;
  images?: ViatorImage[];
  reviews?: { combinedAverageRating?: number; totalReviews?: number };
  pricing?: { summary?: { fromPrice?: number; fromPriceBeforeDiscount?: number }; currency?: string };
  productUrl?: string;
  destinations?: { ref?: string | number; primary?: boolean }[];
  duration?: { fixedDurationInMinutes?: number; variableDurationFromMinutes?: number; variableDurationToMinutes?: number };
  flags?: string[];
  tags?: number[];
};

/**
 * Viator meters a Basic Access key tightly: the second call of a run answered 429 on the real key. A 429 is
 * waited out (Retry-After when sent, else 2, 4, 8... seconds, six tries) and every call is at least
 * MIN_GAP_MS after the last, so a pull paces itself instead of failing on the first throttle.
 */
const MIN_GAP_MS = 600;
let lastCallAt = 0;

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = KEY();
  if (!key) throw new Error("VIATOR_API_KEY is not set");
  for (let attempt = 0; ; attempt++) {
    const wait = lastCallAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await pause(wait);
    lastCallAt = Date.now();
    const res = await fetch(BASE() + path, {
      ...init,
      headers: {
        "exp-api-key": key,
        Accept: "application/json;version=2.0",
        "Accept-Language": "en-US",
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
      signal: AbortSignal.timeout(25000),
    });
    if (res.status === 429 && attempt < 6) {
      const after = Number(res.headers.get("retry-after")) || 0;
      const ms = after > 0 ? after * 1000 : 2000 * 2 ** attempt;
      console.log(`  viator ${path}: 429, waiting ${Math.round(ms / 1000)}s`);
      await res.text();
      await pause(ms);
      continue;
    }
    if (!res.ok) throw new Error(`viator ${path} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as T;
  }
}

const DESTINATIONS_CACHE_HOURS = 24 * 7;

/**
 * Every Viator destination (about 3,500 rows). Cities do not move, so the answer is kept on disk for a week
 * (data/viator-destinations.json) and a run spends its rate budget on product searches instead.
 */
export async function destinations(): Promise<ViatorDestination[]> {
  // Beside the database it feeds, so a test's throwaway database gets a throwaway cache, never the real one.
  const dbFile = process.env.OUTSET_DB || process.env.OUTSET_DB_PATH;
  const file = join(dbFile ? dirname(dbFile) : join(dirname(fileURLToPath(import.meta.url)), "../../data"), "viator-destinations.json");
  try {
    if (existsSync(file) && Date.now() - statSync(file).mtimeMs < DESTINATIONS_CACHE_HOURS * 3600_000) {
      const cached = JSON.parse(readFileSync(file, "utf8")) as ViatorDestination[];
      if (Array.isArray(cached) && cached.length) return cached;
    }
  } catch {
    // unreadable cache: ask again
  }
  const r = await call<{ destinations?: ViatorDestination[] }>("/destinations");
  const list = r.destinations || [];
  if (list.length) {
    try {
      writeFileSync(file, JSON.stringify(list));
    } catch {
      // a read-only disk still gets the answer
    }
  }
  return list;
}

/**
 * One Viator destination per Outset metro: the nearest CITY-type destination whose centre is within `maxKm`
 * of the metro's centre, else a name match. Metros with neither are skipped and named in the log, never
 * guessed at, since a wrong destination would fill a metro with another city's tours.
 */
export function metroDestinations(dests: ViatorDestination[], maxKm = 40): Map<string, ViatorDestination> {
  const out = new Map<string, ViatorDestination>();
  const cities = dests.filter((d) => (d.type || "").toUpperCase() === "CITY" || !d.type);
  for (const m of METROS) {
    let best: { d: ViatorDestination; km: number } | null = null;
    for (const d of cities) {
      const lat = d.center?.latitude;
      const lon = d.center?.longitude;
      if (lat == null || lon == null) continue;
      const km = haversineKm(m.lat, m.lon, lat, lon);
      if (km <= maxKm && (!best || km < best.km)) best = { d, km };
    }
    if (!best) {
      const byName = cities.find((d) => (d.name || "").toLowerCase() === m.name.toLowerCase().replace(/ bay$/, ""));
      if (byName) best = { d: byName, km: 0 };
    }
    if (best) out.set(m.id, best.d);
  }
  return out;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Product summaries for one destination, best rated first. */
export async function searchDestination(destinationId: number, opts: { count?: number; start?: number; currency?: string } = {}): Promise<{ products: ViatorProduct[]; totalCount: number }> {
  const body = {
    filtering: { destination: String(destinationId) },
    sorting: { sort: "TRAVELER_RATING", order: "DESCENDING" },
    pagination: { start: opts.start ?? 1, count: Math.min(opts.count ?? 50, 50) },
    currency: opts.currency || "USD",
  };
  const r = await call<{ products?: ViatorProduct[]; totalCount?: number }>("/products/search", { method: "POST", body: JSON.stringify(body) });
  return { products: r.products || [], totalCount: r.totalCount || 0 };
}

export async function product(code: string): Promise<ViatorProduct> {
  return call<ViatorProduct>("/products/" + encodeURIComponent(code));
}

/** Products changed since the cursor. Viator's feed is global, so callers keep only the codes they hold. */
export async function modifiedSince(cursor: string | null, count = 500): Promise<{ products: ViatorProduct[]; nextCursor: string | null }> {
  const q = new URLSearchParams({ count: String(count) });
  if (cursor) q.set("cursor", cursor);
  const r = await call<{ products?: ViatorProduct[]; nextCursor?: string }>("/products/modified-since?" + q.toString());
  return { products: r.products || [], nextCursor: r.nextCursor || null };
}

/** Up to eight photo URLs, each the variant nearest 720px wide (a card and a hero, not a thumbnail, not 4K). */
export function bestImages(p: ViatorProduct, max = 8): string[] {
  const out: string[] = [];
  for (const img of p.images || []) {
    const vs = (img.variants || []).filter((v) => v.url && /^https:\/\//i.test(v.url));
    if (!vs.length) continue;
    const pick = vs.reduce((a, b) => (Math.abs((b.width || 0) - 720) < Math.abs((a.width || 0) - 720) ? b : a));
    if (pick.url && !out.includes(pick.url)) out.push(pick.url);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * How long the product runs, in the words a person would use. The API states every length in minutes, and a
 * partner sells plenty that run for days: a nine day CityPASS came back as 12,960 minutes and was written
 * "216 hours", a two day Niagara Falls tour "48 hours", and an e-bike rental "24 hours to 744 hours", which
 * is a month. GetYourGuide's own reader already says days because its API names the unit; this one has to
 * work the unit out, so a day or more is said in days, as `sayLength` says it on every guest surface.
 */
export function durationText(p: ViatorProduct): string | null {
  const d = p.duration;
  if (!d) return null;
  const say = (m: number) =>
    m >= 1440
      ? sayLength(Math.round((m / 60) * 10) / 10 + " hours")
      : m >= 60 && m % 60 === 0
        ? m / 60 + (m === 60 ? " hour" : " hours")
        : m >= 60
          ? (m / 60).toFixed(1).replace(/\.0$/, "") + " hours"
          : m + " minutes";
  if (d.fixedDurationInMinutes) return say(d.fixedDurationInMinutes);
  if (d.variableDurationFromMinutes && d.variableDurationToMinutes) return say(d.variableDurationFromMinutes) + " to " + say(d.variableDurationToMinutes);
  return null;
}

/** The partner-attributed link. The API's productUrl normally carries our pid; VIATOR_PID covers one that does not. */
export function bookingUrl(p: ViatorProduct): string | null {
  const url = (p.productUrl || "").trim();
  if (!/^https:\/\//i.test(url)) return null;
  const pid = (process.env.VIATOR_PID || "").trim();
  if (!pid || /[?&]pid=/.test(url)) return url;
  const mcid = (process.env.VIATOR_MCID || "42383").trim();
  return url + (url.includes("?") ? "&" : "?") + "pid=" + encodeURIComponent(pid) + "&mcid=" + encodeURIComponent(mcid) + "&medium=api";
}

/** Not an experience a guest books a day around: rides to the airport, SIM cards, parking, hotels. */
const NOT_EXPERIENCE = /\b(transfer|shuttle|airport|sim card|esim|wi-?fi|hotel|parking|luggage|storage|car rental|rental car|pocket wifi)\b/i;

export function upsertProduct(source: string, p: ViatorProduct, dest: ViatorDestination, metroId: string): boolean {
  const url = bookingUrl(p);
  if (!url || !p.title) return false;
  const images = bestImages(p);
  const from = p.pricing?.summary?.fromPrice;
  const lat = dest.center?.latitude ?? null;
  const lon = dest.center?.longitude ?? null;
  db.prepare(
    `INSERT INTO affiliate_products (id, source, product_code, title, description, images, from_cents, currency, rating, review_count, duration,
       destination_id, destination_name, metro_id, lat, lon, tags, booking_url, flags, raw, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source, product_code) DO UPDATE SET
       title = excluded.title, from_cents = excluded.from_cents,
       currency = excluded.currency, rating = excluded.rating, review_count = excluded.review_count, duration = excluded.duration,
       destination_id = excluded.destination_id, destination_name = excluded.destination_name, metro_id = excluded.metro_id,
       lat = excluded.lat, lon = excluded.lon, tags = excluded.tags, booking_url = excluded.booking_url, flags = excluded.flags,
       fetched_at = excluded.fetched_at,
       -- A search summary carries one photo and a cut description; the detail pass (detailViator) holds the
       -- full set. A refresh from the summary keeps whichever is richer, and keeps raw.detail with it.
       images = CASE WHEN json_array_length(excluded.images) >= json_array_length(images) THEN excluded.images ELSE images END,
       description = CASE WHEN length(coalesce(excluded.description, '')) >= length(coalesce(description, '')) THEN excluded.description ELSE description END,
       raw = CASE WHEN json_extract(raw, '$.detail') IS NOT NULL THEN json_set(excluded.raw, '$.detail', json(json_extract(raw, '$.detail'))) ELSE excluded.raw END`,
  ).run(
    "a-" + source + "-" + p.productCode.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    source,
    p.productCode,
    p.title.trim(),
    (p.description || "").trim() || null,
    JSON.stringify(images),
    from != null && Number.isFinite(from) ? Math.round(from * 100) : null,
    p.pricing?.currency || "USD",
    p.reviews?.combinedAverageRating ?? null,
    p.reviews?.totalReviews ?? null,
    durationText(p),
    String(dest.destinationId),
    dest.name,
    metroId,
    lat,
    lon,
    JSON.stringify((p.tags || []).map(String)),
    url,
    JSON.stringify(p.flags || []),
    JSON.stringify(p),
    nowIso(),
  );
  return true;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Pull the best-rated products for each metro. `write` false prints what it would store and stores nothing.
 * About one search call per 50 products per metro: 47 metros at 40 each is under 100 calls.
 */
export async function pullViator(opts: { metros?: string[]; perMetro: number; write: boolean; currency?: string }): Promise<{ metros: number; matched: number; products: number; written: number; skipped: string[] }> {
  const out = { metros: 0, matched: 0, products: 0, written: 0, skipped: [] as string[] };
  if (!viatorConfigured()) {
    console.log("VIATOR_API_KEY is not set, so nothing is pulled. Create an affiliate key at viator.com (Tools -> Affiliate API) and put it in backend/.env.");
    return out;
  }
  const wanted = opts.metros?.length ? METROS.filter((m) => opts.metros!.includes(m.id)) : METROS;
  out.metros = wanted.length;
  const dests = await destinations();
  const byMetro = metroDestinations(dests);
  for (const m of wanted) {
    const dest = byMetro.get(m.id);
    if (!dest) {
      out.skipped.push(m.id);
      console.log(`  ${m.id}: no Viator destination within 40 km, skipped`);
      continue;
    }
    out.matched++;
    let start = 1;
    let kept = 0;
    while (kept < opts.perMetro) {
      const page = await searchDestination(dest.destinationId, { start, count: Math.min(50, opts.perMetro - kept), currency: opts.currency || (m.country === "CA" ? "CAD" : "USD") });
      if (!page.products.length) break;
      for (const p of page.products) {
        if (kept >= opts.perMetro) break;
        if (!p.productCode || NOT_EXPERIENCE.test(p.title || "")) continue;
        out.products++;
        kept++;
        if (opts.write && upsertProduct("viator", p, dest, m.id)) out.written++;
      }
      start += page.products.length;
      if (start > page.totalCount) break;
      await pause(250);
    }
    console.log(`  ${m.id}: ${dest.name} (#${dest.destinationId}), ${kept} products${opts.write ? " stored" : ""}`);
  }
  if (opts.write) db.prepare("INSERT INTO affiliate_sync (source, last_full_at) VALUES ('viator', ?) ON CONFLICT(source) DO UPDATE SET last_full_at = excluded.last_full_at").run(nowIso());
  return out;
}

/** The parts of /products/{code} a listing shows beyond the search summary. */
export type ViatorDetailSections = {
  inclusions?: { typeDescription?: string; otherDescription?: string }[];
  exclusions?: { typeDescription?: string; otherDescription?: string }[];
  additionalInfo?: { type?: string; description?: string }[];
  cancellationPolicy?: { type?: string; description?: string; cancelIfBadWeather?: boolean };
  itinerary?: { privateTour?: boolean; maxTravelersInSharedTour?: number };
};

export type ViatorProductDetail = ViatorProduct & ViatorDetailSections;

export type DetailFields = {
  includes: string[];
  /** What the product says it leaves out, in the partner's own words. */
  excludes: string[];
  requirements: string[];
  /** The rest of the `additionalInfo` bag: true of the booking, not of the guest. */
  notes: string[];
  cancellation: string | null;
  groupSize: number | null;
  privateTour: boolean;
};

/**
 * Which of a partner's `additionalInfo` lines says who may take part.
 *
 * Viator heads this bag "Additional info" and puts everything in it: the accessibility and fitness facts it
 * generates from a fixed list of types, and whatever else the operator typed. Our page has no such column, so
 * every line went under "Who can go", where 2,302 of the 6,492 shipped partner listings head at least one
 * line that is nothing of the kind: how to download a tour app, what to bring, that the tour runs in all
 * weather, and on 6 listings the operator's own marketing ("More ways to save: choose a single tour, a nearby
 * bundle, or access to 200+ tours"). 6,221 lines in all. A line about the booking rather than about the guest
 * belongs under Policies, which is where the page already files the rest of what a shop publishes.
 *
 * A line stays under "Who can go" when it names a person's age, body, health, or how they get about, what
 * party sizes the operator takes, or what a guest has to carry. Everything else moves. The rule reads the
 * line rather than its `type`, because the free-text half of the bag carries real age rules ("Minimum
 * drinking age is 21 years") and one of the enumerated types carries none ("Operates in all weather
 * conditions", 208 listings).
 */
const WHO_CAN_GO = new RegExp(
  [
    // Who it is, and is not, for.
    "not (?:recommended|suitable|appropriate) for", "suitable for", "designed for", "can(?:not)? participate", "may not participate",
    "must be accompanied", "accompanied by an? (?:adult|parent|guardian)",
    // Age, in every way a partner writes it.
    "\\bages?\\b", "\\baged\\b", "\\bminors?\\b", "\\badults?\\b", "\\bchild(?:ren)?\\b", "\\bkids?\\b", "\\binfants?\\b",
    "\\btoddlers?\\b", "\\bseniors?\\b", "\\belderly\\b", "\\byears? (?:old|or older|or younger|and (?:up|older|over)|of age)\\b",
    "\\bunder (?:the age of )?\\d", "\\bover the age of \\d", "\\bmust be \\d", "\\b\\d{1,2}\\s*\\+",
    // Body and health.
    "pregnan", "\\bheart\\b", "cardiovascular", "back problem", "spinal", "\\bsurger", "medical condition",
    "\\bmobility\\b", "disabilit", "physical fitness", "fitness level", "\\bweigh", "\\bheight\\b", "\\btall\\b",
    // Getting there and taking part.
    "wheelchair", "accessib", "service animals?", "guide dogs?", "strollers?", "\\bprams?\\b",
    "must be able", "able to (?:walk|swim|stand|climb)", "\\bswim\\b",
    // How many may come, and what they must carry.
    "per booking", "at least \\d+ (?:people|persons?|travel|guest|particip|player)",
    "(?:minimum|maximum) of \\d+ (?:people|persons?|travel|guest|particip|player)", "(?:minimum|maximum) (?:party|group) size",
    "(?:photo )?id required", "valid (?:government[- ]issued )?(?:photo )?(?:id|identification|licen|passport)",
    "(?:travel(?:l)?ers?|guests?|participants?|riders?|passengers?|players?) (?:must|should|need to|are required)",
  ].join("|"),
  "i",
);

/** Whether an `additionalInfo` line states a rule about the guest rather than about the booking. */
export function isWhoCanGo(line: string): boolean {
  return WHO_CAN_GO.test(line);
}

/** What the detail adds to a listing: a full photo set, the whole description, inclusions, requirements, the policy. */
export function detailFields(d: ViatorDetailSections): DetailFields {
  const line = (x: { typeDescription?: string; otherDescription?: string }) => (x.otherDescription || (x.typeDescription && x.typeDescription !== "Other" ? x.typeDescription : "") || "").trim();
  const includes = (d.inclusions || []).map(line).filter(Boolean).slice(0, 12);
  const excludes = (d.exclusions || []).map(line).filter(Boolean).slice(0, 12);
  const info = (d.additionalInfo || [])
    .map((a) => (a.description || "").trim())
    .filter((s) => s && !/^(confirmation will be received|most travelers can participate|public transportation)/i.test(s));
  const requirements = info.filter(isWhoCanGo).slice(0, 12);
  const notes = info.filter((s) => !isWhoCanGo(s)).slice(0, 12);
  const cancellation = (d.cancellationPolicy?.description || "").trim() || null;
  return { includes, excludes, requirements, notes, cancellation, groupSize: d.itinerary?.maxTravelersInSharedTour ?? null, privateTour: !!d.itinerary?.privateTour };
}

/**
 * One /products/{code} call per stored row (single product data is on Basic Access) for what the search
 * summary lacks: every photo instead of one, the whole description, what is included, who it is not for and
 * the cancellation text. Price, rating and review count stay from the search, which is where Viator states
 * them. The detail lands in `raw.detail`, the columns it improves are updated, and `fetched_at` moves, since
 * this content was fetched now. `onlyMissing` skips rows that already hold a detail, so a daily run is cheap.
 */
export async function detailViator(opts: { write: boolean; max?: number; onlyMissing?: boolean }): Promise<{ rows: number; fetched: number; updated: number; failed: number }> {
  const out = { rows: 0, fetched: 0, updated: 0, failed: 0 };
  if (!viatorConfigured()) {
    console.log("VIATOR_API_KEY is not set, so nothing is fetched.");
    return out;
  }
  const rows = db.prepare("SELECT id, product_code, images, description, raw FROM affiliate_products WHERE source = 'viator' ORDER BY review_count DESC NULLS LAST").all() as { id: string; product_code: string; images: string; description: string | null; raw: string | null }[];
  out.rows = rows.length;
  const update = db.prepare("UPDATE affiliate_products SET images = ?, description = ?, raw = ?, fetched_at = ? WHERE id = ?");
  for (const r of rows) {
    if (opts.max != null && out.fetched >= opts.max) break;
    let raw: Record<string, unknown> = {};
    try {
      raw = r.raw ? (JSON.parse(r.raw) as Record<string, unknown>) : {};
    } catch {
      raw = {};
    }
    if (opts.onlyMissing !== false && raw.detail) continue;
    let d: ViatorProductDetail;
    try {
      d = await product(r.product_code);
      out.fetched++;
    } catch (e) {
      out.failed++;
      console.log(`  ${r.product_code}: ${String((e as Error).message).slice(0, 120)}`);
      continue;
    }
    const held = ((): string[] => {
      try {
        return JSON.parse(r.images) as string[];
      } catch {
        return [];
      }
    })();
    const images = bestImages(d);
    const description = (d.description || "").trim();
    const fields = detailFields(d);
    const next = { ...raw, detail: { inclusions: d.inclusions || [], exclusions: d.exclusions || [], additionalInfo: d.additionalInfo || [], cancellationPolicy: d.cancellationPolicy || null, itinerary: d.itinerary ? { privateTour: d.itinerary.privateTour, maxTravelersInSharedTour: d.itinerary.maxTravelersInSharedTour } : null, fields } };
    if (opts.write) {
      update.run(JSON.stringify(images.length >= held.length ? images : held), description.length >= (r.description || "").length ? description || null : r.description, JSON.stringify(next), nowIso(), r.id);
    }
    out.updated++;
    if (out.fetched % 100 === 0) console.log(`  ${out.fetched} details fetched, ${out.updated} rows ${opts.write ? "updated" : "would update"}`);
  }
  return out;
}

/**
 * Refresh what we hold from /products/modified-since, the way the licence asks (at least daily). Rows we do
 * not hold are ignored; a product Viator retired is left to age out past MAX_AGE_HOURS.
 */
export async function refreshViator(opts: { write: boolean }): Promise<{ seen: number; updated: number }> {
  const out = { seen: 0, updated: 0 };
  if (!viatorConfigured()) {
    console.log("VIATOR_API_KEY is not set, so nothing is refreshed.");
    return out;
  }
  const held = new Map<string, { destination_id: string; destination_name: string; metro_id: string; lat: number | null; lon: number | null }>();
  for (const r of db.prepare("SELECT product_code, destination_id, destination_name, metro_id, lat, lon FROM affiliate_products WHERE source = 'viator'").all() as { product_code: string; destination_id: string; destination_name: string; metro_id: string; lat: number | null; lon: number | null }[]) held.set(r.product_code, r);
  if (!held.size) return out;
  let cursor = (db.prepare("SELECT cursor FROM affiliate_sync WHERE source = 'viator'").get() as { cursor: string | null } | undefined)?.cursor || null;
  for (let i = 0; i < 400; i++) {
    let page: { products: ViatorProduct[]; nextCursor: string | null };
    try {
      page = await modifiedSince(cursor);
    } catch (e) {
      // /products/modified-since is a bulk endpoint, and bulk is Full Access. A Basic Access key (the default
      // every affiliate gets on day one) answers it 403, so the refresh is the pull again: one search per
      // metro, as many rows as we hold there, which is the same content the licence wants kept fresh.
      if (!/-> (401|403|404) /.test(String((e as Error).message))) throw e;
      const perMetro = Math.max(1, ...[...held.values()].reduce((m, h) => m.set(h.metro_id, (m.get(h.metro_id) || 0) + 1), new Map<string, number>()).values());
      console.log(`  modified-since is not on this key (Basic Access); refreshing by search, ${perMetro} per metro.`);
      const pulled = await pullViator({ perMetro, write: opts.write });
      return { seen: pulled.products, updated: opts.write ? pulled.written : pulled.products };
    }
    out.seen += page.products.length;
    for (const p of page.products) {
      const h = held.get(p.productCode);
      if (!h) continue;
      const dest: ViatorDestination = { destinationId: Number(h.destination_id), name: h.destination_name, center: h.lat != null && h.lon != null ? { latitude: h.lat, longitude: h.lon } : undefined };
      if (opts.write && upsertProduct("viator", p, dest, h.metro_id)) out.updated++;
      else if (!opts.write) out.updated++;
    }
    if (!page.nextCursor || !page.products.length) break;
    cursor = page.nextCursor;
    await pause(250);
  }
  if (opts.write) db.prepare("INSERT INTO affiliate_sync (source, cursor, last_refresh_at) VALUES ('viator', ?, ?) ON CONFLICT(source) DO UPDATE SET cursor = excluded.cursor, last_refresh_at = excluded.last_refresh_at").run(cursor, nowIso());
  return out;
}
