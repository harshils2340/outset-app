import { db, nowIso } from "../db/client.ts";
import { METROS, nearestMetro } from "../taxonomy/catalog.ts";

/**
 * GetYourGuide affiliate feed: tours, tickets and activities licensed through the GetYourGuide Partner API,
 * booked on getyourguide.com on a partner-attributed link. Same shape and same table as viator.ts; see
 * there for what an affiliate row is and is not. Nothing in this file reads getyourguide.com's pages.
 *
 * Built from the official OpenAPI spec and wiki (github.com/getyourguide/partner-api-spec, spec/api.yaml,
 * spec/paths/tours.yaml, spec/components/*, wiki: Getting-started, Access-levels, Image-Formats). Verified there:
 *   base       https://api.getyourguide.com/1/   (api.gygtest.net is the test server)
 *   auth       X-ACCESS-TOKEN header plus Accept: application/json; every GET carries cnt_language and currency
 *   search     GET /1/tours with coordinates[]=lat&coordinates[]=lon&coordinates[]=radius (mutually exclusive
 *              with q=<place name>), sortfield=popularity, limit (max 500, default 10), offset;
 *              _metadata.totalCount is the match count
 *   tier       BASIC/LIMITED_READ keys reach /tours and /tours/{id} with preformatted=teaser only, which is
 *              every field this file stores; READ adds availability and price-breakdown we do not need
 *   tour       tour_id, title, abstract, description, pictures[].ssl_url with a "[format_id]" placeholder,
 *              price.values.amount ("from" price in the requested currency), overall_rating (0 to 5),
 *              number_of_ratings, durations[] {duration, unit: day|hour|minute}, categories[].name,
 *              coordinates {lat, long}, locations[] {type, name, city}, cancellation_policy.cancellable,
 *              likely_to_sell_out, bestseller, activity_type, partner_business_category, url
 *   images     format 75 is 1440x960 (3:2), format 131 is 240x160
 *   limits     130 calls a minute by default; past that every call is blocked for five minutes
 *   terms      "We encourage to access the API in real-time; please do not scrape the API in an attempt to
 *              cache its output" (wiki, Getting started). Rows here are refreshed by a daily pull and the
 *              catalog sync publishes only rows fresher than MAX_AGE_HOURS, same as Viator, so a feed that
 *              stops being refreshed drops off the site by itself. Whether that reading of the line is what
 *              GetYourGuide means is a question for the Partner Manager who issues the key.
 * Unverified, no public doc:
 *   - the radius unit on coordinates[] (the spec example is 10 with no unit; kilometres is assumed)
 *   - whether `url` always arrives with partner_id (the spec example carries partner_id=...&psrc=partner_api;
 *     bookingUrl appends GYG_PARTNER_ID when the link has none, and drops the link when neither has one)
 *   - a token comes "from your Partner Manager" (wiki Home); no self-service page is documented
 *
 *   GYG_API_KEY      the partner access token. Unset: every command says so and does nothing.
 *   GYG_PARTNER_ID   partner id for the booking link, appended when the API's url arrives without one.
 *   GYG_TEST=1       hit api.gygtest.net instead of production (test tokens only work there).
 */

const KEY = () => (process.env.GYG_API_KEY || "").trim();
const PARTNER_ID = () => (process.env.GYG_PARTNER_ID || "").trim();
const BASE = () => (process.env.GYG_TEST === "1" ? "https://api.gygtest.net/1" : "https://api.getyourguide.com/1");

export function gygConfigured(): boolean {
  return !!KEY();
}

export type GygPicture = { id?: number; url?: string; ssl_url?: string; verified?: boolean; copyright?: string | null };

export type GygTour = {
  tour_id: number | string;
  title?: string;
  abstract?: string;
  description?: string;
  pictures?: GygPicture[];
  coordinates?: { lat?: number; long?: number };
  price?: { values?: { amount?: number }; description?: string };
  overall_rating?: number;
  number_of_ratings?: number;
  durations?: { duration?: number; unit?: "day" | "hour" | "minute" }[];
  categories?: { category_id?: number; name?: string }[];
  activity_type?: string;
  partner_business_category?: string;
  locations?: { location_id?: number; type?: string; name?: string; city?: string | null }[];
  cancellation_policy?: { cancellable?: boolean };
  likely_to_sell_out?: boolean;
  bestseller?: boolean;
  url?: string;
};

/**
 * 130 calls a minute is one every 462 ms, and the penalty for the 131st is a five minute block, so every
 * call is at least MIN_GAP_MS after the last and a 429 is waited out for the documented block (Retry-After
 * when sent) rather than retried into a longer one.
 */
const MIN_GAP_MS = 500;
const BLOCK_MS = 5 * 60_000;
let lastCallAt = 0;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function call<T>(path: string, params: Record<string, string | number | (string | number)[]> = {}): Promise<T> {
  const key = KEY();
  if (!key) throw new Error("GYG_API_KEY is not set");
  const q = new URLSearchParams();
  // Every GET needs these two (wiki, Getting started); a caller may override.
  q.set("cnt_language", "en");
  q.set("currency", "USD");
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) {
      // "URL array": coordinates[]=lat&coordinates[]=lon&coordinates[]=radius (spec: explode, allowReserved).
      q.delete(k);
      for (const x of v) q.append(k, String(x));
    } else q.set(k, String(v));
  }
  for (let attempt = 0; ; attempt++) {
    const wait = lastCallAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await pause(wait);
    lastCallAt = Date.now();
    const res = await fetch(BASE() + path + "?" + q.toString(), {
      headers: { "X-ACCESS-TOKEN": key, Accept: "application/json" },
      signal: AbortSignal.timeout(25000),
    });
    if (res.status === 429 && attempt < 2) {
      const after = Number(res.headers.get("retry-after")) || 0;
      const ms = after > 0 ? after * 1000 : BLOCK_MS;
      console.log(`  getyourguide ${path}: 429, waiting ${Math.round(ms / 1000)}s`);
      await res.text();
      await pause(ms);
      continue;
    }
    if (!res.ok) throw new Error(`getyourguide ${path} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as T;
  }
}

/** Assumed kilometres (unverified: the spec gives no unit). 40 km covers a metro's centre and its beaches. */
export const RADIUS_KM = 40;

type ToursResponse = { _metadata?: { totalCount?: number }; data?: { tours?: GygTour[] } };

/** Tours around a point, most recommended first. `preformatted=teaser` is what a BASIC key may ask for. */
export async function searchNear(lat: number, lon: number, opts: { radiusKm?: number; limit?: number; offset?: number; currency?: string } = {}): Promise<{ tours: GygTour[]; total: number }> {
  const r = await call<ToursResponse>("/tours", {
    "coordinates[]": [lat, lon, opts.radiusKm ?? RADIUS_KM],
    sortfield: "popularity",
    preformatted: "teaser",
    limit: Math.min(Math.max(opts.limit ?? 50, 1), 500),
    offset: opts.offset ?? 0,
    currency: opts.currency || "USD",
  });
  return { tours: r.data?.tours || [], total: r._metadata?.totalCount ?? 0 };
}

/** Format 75 is 1440x960 (wiki, Image Formats): the one verified size big enough for a listing cover. */
export const IMAGE_FORMAT = "75";

/** Each picture at IMAGE_FORMAT, https only, at most eight. */
export function images(p: GygTour, max = 8): string[] {
  const out: string[] = [];
  for (const i of p.pictures || []) {
    const u = (i.ssl_url || i.url || "").replace("[format_id]", IMAGE_FORMAT);
    if (u && /^https:\/\//i.test(u) && !out.includes(u)) out.push(u);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * The API's own tour url, carrying our partner id. The spec's example already has partner_id on it; when a
 * link arrives without one, GYG_PARTNER_ID is added, and with neither there is no attributed link, so the
 * tour is not stored: an unattributed link earns nothing and would look like a plain outbound link.
 */
export function bookingUrl(p: GygTour): string | null {
  const raw = (p.url || "").trim();
  if (!/^https:\/\//i.test(raw)) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (!u.searchParams.get("partner_id")) {
    const pid = PARTNER_ID();
    if (!pid) return null;
    u.searchParams.set("partner_id", pid);
  }
  return u.toString();
}

/** "2 hours", "45 minutes", "3 days", from the first of the tour's durations. */
export function durationText(p: GygTour): string | null {
  const d = p.durations?.find((x) => typeof x.duration === "number" && x.duration > 0 && x.unit);
  if (!d) return null;
  const n = d.duration as number;
  const shown = Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
  return `${shown} ${d.unit}${n === 1 ? "" : "s"}`;
}

/** Where the tour is filed on the partner's side: its city, else the first named location. */
export function placeName(p: GygTour): string | null {
  const locs = p.locations || [];
  const city = locs.find((l) => l.type === "city")?.name || locs.find((l) => l.city)?.city;
  return (city || locs[0]?.name || "").trim() || null;
}

const NOT_EXPERIENCE = /\b(transfer|shuttle|airport|sim card|esim|wi-?fi|hotel|parking|luggage|storage|car rental|rental car)\b/i;

/** Transfers and city cards are not an activity a guest picks a slot for; the API says which is which. */
export function isExperience(p: GygTour): boolean {
  if (p.activity_type === "transfer" || p.activity_type === "cityCard") return false;
  if (p.partner_business_category === "Transfers" || p.partner_business_category === "City Cards") return false;
  return !NOT_EXPERIENCE.test(p.title || "");
}

export function upsertProduct(p: GygTour, metroId: string, currency = "USD"): boolean {
  const url = bookingUrl(p);
  const code = String(p.tour_id ?? "").trim();
  if (!url || !p.title || !code) return false;
  const flags: string[] = [];
  if (p.cancellation_policy?.cancellable) flags.push("FREE_CANCELLATION");
  if (p.likely_to_sell_out) flags.push("LIKELY_TO_SELL_OUT");
  const metro = METROS.find((m) => m.id === metroId);
  const lat = typeof p.coordinates?.lat === "number" ? p.coordinates.lat : null;
  const lon = typeof p.coordinates?.long === "number" ? p.coordinates.long : null;
  const amount = p.price?.values?.amount;
  db.prepare(
    `INSERT INTO affiliate_products (id, source, product_code, title, description, images, from_cents, currency, rating, review_count, duration,
       destination_id, destination_name, metro_id, lat, lon, tags, booking_url, flags, raw, fetched_at)
     VALUES (?, 'getyourguide', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source, product_code) DO UPDATE SET
       title = excluded.title, description = excluded.description, images = excluded.images, from_cents = excluded.from_cents,
       currency = excluded.currency, rating = excluded.rating, review_count = excluded.review_count, duration = excluded.duration,
       destination_id = excluded.destination_id, destination_name = excluded.destination_name, metro_id = excluded.metro_id,
       lat = excluded.lat, lon = excluded.lon, tags = excluded.tags, booking_url = excluded.booking_url, flags = excluded.flags,
       raw = excluded.raw, fetched_at = excluded.fetched_at`,
  ).run(
    "a-getyourguide-" + code.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    code,
    p.title.trim(),
    (p.abstract || p.description || "").trim() || null,
    JSON.stringify(images(p)),
    typeof amount === "number" && Number.isFinite(amount) ? Math.round(amount * 100) : null,
    // The price field is a bare number; its currency is the one the request asked for.
    currency,
    typeof p.overall_rating === "number" ? p.overall_rating : null,
    typeof p.number_of_ratings === "number" ? p.number_of_ratings : null,
    durationText(p),
    p.locations?.[0]?.location_id != null ? String(p.locations[0].location_id) : null,
    placeName(p),
    metroId,
    // A tour with its own coordinates keeps them; one without sits at the metro's centre, which the card
    // shows as "near", never as a distance.
    lat ?? metro?.lat ?? null,
    lon ?? metro?.lon ?? null,
    JSON.stringify((p.categories || []).map((c) => c.name).filter((n): n is string => !!n)),
    url,
    JSON.stringify(flags),
    JSON.stringify(p),
    nowIso(),
  );
  return true;
}

/**
 * One search per metro around its centre, paged until perMetro experiences are kept. A tour whose own
 * coordinates sit nearer another metro on the grid is filed there, so a Clearwater tour found from Tampa
 * and again from St Petersburg lands in one place and is not counted twice.
 */
export async function pullGetYourGuide(opts: { metros?: string[]; perMetro: number; write: boolean }): Promise<{ metros: number; matched: number; products: number; written: number; skipped: string[] }> {
  const out = { metros: 0, matched: 0, products: 0, written: 0, skipped: [] as string[] };
  if (!gygConfigured()) {
    console.log("GYG_API_KEY is not set, so nothing is pulled. The token comes from a GetYourGuide Partner Manager (partner.getyourguide.com); put it in backend/.env with GYG_PARTNER_ID.");
    return out;
  }
  if (!PARTNER_ID()) console.log("GYG_PARTNER_ID is not set: a tour whose url arrives without partner_id will be skipped, since an unattributed link earns nothing.");
  const wanted = opts.metros?.length ? METROS.filter((m) => opts.metros!.includes(m.id)) : METROS;
  out.metros = wanted.length;
  for (const m of wanted) {
    const currency = m.country === "CA" ? "CAD" : "USD";
    let offset = 0;
    let kept = 0;
    let seen = 0;
    let total = 0;
    while (kept < opts.perMetro) {
      const r = await searchNear(m.lat, m.lon, { limit: Math.min(100, opts.perMetro - kept), offset, currency });
      total = r.total;
      if (!r.tours.length) break;
      seen += r.tours.length;
      for (const p of r.tours) {
        if (kept >= opts.perMetro) break;
        if (!isExperience(p)) continue;
        out.products++;
        kept++;
        if (!opts.write) continue;
        const lat = p.coordinates?.lat;
        const lon = p.coordinates?.long;
        const home = typeof lat === "number" && typeof lon === "number" ? nearestMetro(lat, lon, 160) : null;
        if (upsertProduct(p, home?.id || m.id, currency)) out.written++;
      }
      offset += r.tours.length;
      if (offset >= total) break;
    }
    if (seen === 0) {
      out.skipped.push(m.id);
      console.log(`  ${m.id}: no GetYourGuide tours within ${RADIUS_KM} km, skipped`);
      continue;
    }
    out.matched++;
    console.log(`  ${m.id}: ${total} tours near, ${kept} kept${opts.write ? " and stored" : ""}`);
  }
  if (opts.write) db.prepare("INSERT INTO affiliate_sync (source, last_full_at) VALUES ('getyourguide', ?) ON CONFLICT(source) DO UPDATE SET last_full_at = excluded.last_full_at").run(nowIso());
  return out;
}
