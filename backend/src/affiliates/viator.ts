import { db, nowIso } from "../db/client.ts";
import { METROS, nearestMetro } from "../taxonomy/catalog.ts";

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

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = KEY();
  if (!key) throw new Error("VIATOR_API_KEY is not set");
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
  if (!res.ok) throw new Error(`viator ${path} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

/** Every Viator destination (about 3,500 rows, one call). */
export async function destinations(): Promise<ViatorDestination[]> {
  const r = await call<{ destinations?: ViatorDestination[] }>("/destinations");
  return r.destinations || [];
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

export function durationText(p: ViatorProduct): string | null {
  const d = p.duration;
  if (!d) return null;
  const say = (m: number) => (m >= 60 && m % 60 === 0 ? m / 60 + (m === 60 ? " hour" : " hours") : m >= 60 ? (m / 60).toFixed(1).replace(/\.0$/, "") + " hours" : m + " minutes");
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
       title = excluded.title, description = excluded.description, images = excluded.images, from_cents = excluded.from_cents,
       currency = excluded.currency, rating = excluded.rating, review_count = excluded.review_count, duration = excluded.duration,
       destination_id = excluded.destination_id, destination_name = excluded.destination_name, metro_id = excluded.metro_id,
       lat = excluded.lat, lon = excluded.lon, tags = excluded.tags, booking_url = excluded.booking_url, flags = excluded.flags,
       raw = excluded.raw, fetched_at = excluded.fetched_at`,
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
