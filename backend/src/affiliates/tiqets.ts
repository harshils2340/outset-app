import { db, nowIso } from "../db/client.ts";
import { METROS } from "../taxonomy/catalog.ts";

/**
 * Tiqets affiliate feed: museums, attractions and tickets, licensed through the Tiqets Distributor API's
 * Content tier (developers.tiqets.dev), booked on tiqets.com on the partner-attributed `product_url` the API
 * returns. Same shape and same table as viator.ts; see there for what an affiliate row is and is not.
 *
 * A key is free from the partner portal (Tools -> API tokens) and grants the catalogue and availability
 * endpoints at once; booking access is a separate review we do not need for this model.
 *
 *   TIQETS_API_KEY   the key. Unset: every command says so and does nothing.
 *
 * Cities are matched to our metros by name and country, since the cities endpoint carries no coordinates.
 */

const BASE = "https://api.tiqets.com/v2";
const KEY = () => (process.env.TIQETS_API_KEY || "").trim();

export function tiqetsConfigured(): boolean {
  return !!KEY();
}

export type TiqetsCity = { id: string; name: string; country_id?: string; country_name?: string };

export type TiqetsProduct = {
  id: string;
  title?: string;
  summary?: string;
  city_name?: string;
  city_id?: string;
  price?: number;
  prediscount_price?: number;
  currency?: string;
  images?: { small?: string; medium?: string; large?: string; extra_large?: string }[];
  venue?: { id?: string; name?: string; address?: string };
  ratings?: { average?: number; total?: number };
  duration?: string;
  cancellation?: { policy?: string; window?: number };
  product_url?: string;
  product_checkout_url?: string;
};

async function call<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const key = KEY();
  if (!key) throw new Error("TIQETS_API_KEY is not set");
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));
  const res = await fetch(BASE + path + (q.size ? "?" + q.toString() : ""), {
    headers: { Authorization: "Token " + key, Accept: "application/json" },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`tiqets ${path} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

/** Every Tiqets city, all pages. */
export async function cities(): Promise<TiqetsCity[]> {
  const out: TiqetsCity[] = [];
  for (let page = 1; page < 100; page++) {
    const r = await call<{ cities?: TiqetsCity[]; pagination?: { total?: number; page_size?: number } }>("/cities", { page, page_size: 100 });
    out.push(...(r.cities || []));
    const total = r.pagination?.total ?? 0;
    if (!r.cities?.length || out.length >= total) break;
  }
  return out;
}

const COUNTRY: Record<string, RegExp> = { US: /^united states/i, CA: /^canada$/i };

/** The Tiqets city for each metro: same name, same country. A metro with none is skipped, never guessed. */
export function metroCities(list: TiqetsCity[]): Map<string, TiqetsCity> {
  const out = new Map<string, TiqetsCity>();
  for (const m of METROS) {
    const want = m.name.toLowerCase().replace(/ bay$/, "");
    const hit = list.find((c) => (c.name || "").toLowerCase() === want && COUNTRY[m.country].test(c.country_name || ""));
    if (hit) out.set(m.id, hit);
  }
  return out;
}

export async function searchCity(cityId: string, opts: { page?: number; pageSize?: number; currency?: string } = {}): Promise<{ products: TiqetsProduct[]; total: number }> {
  const r = await call<{ products?: TiqetsProduct[]; pagination?: { total?: number } }>("/products", {
    city_id: cityId,
    page: opts.page ?? 1,
    page_size: Math.min(opts.pageSize ?? 100, 100),
    sort: "popularity",
    currency: opts.currency || "USD",
    lang: "en",
  });
  return { products: r.products || [], total: r.pagination?.total ?? 0 };
}

/** The large variant of each image, https only, at most eight. */
export function images(p: TiqetsProduct, max = 8): string[] {
  const out: string[] = [];
  for (const i of p.images || []) {
    const u = i.large || i.extra_large || i.medium;
    if (u && /^https:\/\//i.test(u) && !out.includes(u)) out.push(u);
    if (out.length >= max) break;
  }
  return out;
}

export function bookingUrl(p: TiqetsProduct): string | null {
  const u = (p.product_url || "").trim();
  return /^https:\/\//i.test(u) ? u : null;
}

const NOT_EXPERIENCE = /\b(transfer|shuttle|airport|sim card|esim|wi-?fi|hotel|parking|luggage|storage|car rental|rental car)\b/i;

export function upsertProduct(p: TiqetsProduct, metroId: string): boolean {
  const url = bookingUrl(p);
  if (!url || !p.title || !p.id) return false;
  const flags: string[] = [];
  if (p.cancellation?.policy && p.cancellation.policy !== "never") flags.push("FREE_CANCELLATION");
  const metro = METROS.find((m) => m.id === metroId);
  db.prepare(
    `INSERT INTO affiliate_products (id, source, product_code, title, description, images, from_cents, currency, rating, review_count, duration,
       destination_id, destination_name, metro_id, lat, lon, tags, booking_url, flags, raw, fetched_at)
     VALUES (?, 'tiqets', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?)
     ON CONFLICT(source, product_code) DO UPDATE SET
       title = excluded.title, description = excluded.description, images = excluded.images, from_cents = excluded.from_cents,
       currency = excluded.currency, rating = excluded.rating, review_count = excluded.review_count, duration = excluded.duration,
       destination_id = excluded.destination_id, destination_name = excluded.destination_name, metro_id = excluded.metro_id,
       lat = excluded.lat, lon = excluded.lon, booking_url = excluded.booking_url, flags = excluded.flags, raw = excluded.raw,
       fetched_at = excluded.fetched_at`,
  ).run(
    "a-tiqets-" + p.id.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    p.id,
    p.title.trim(),
    (p.summary || "").trim() || null,
    JSON.stringify(images(p)),
    typeof p.price === "number" && Number.isFinite(p.price) ? Math.round(p.price * 100) : null,
    p.currency || "USD",
    p.ratings?.average ?? null,
    p.ratings?.total ?? null,
    p.duration || null,
    p.city_id || null,
    p.city_name || p.venue?.name || null,
    metroId,
    // The API returns no coordinates for a product; the metro's centre is the honest pin, and it says "near".
    metro?.lat ?? null,
    metro?.lon ?? null,
    url,
    JSON.stringify(flags),
    JSON.stringify(p),
    nowIso(),
  );
  return true;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function pullTiqets(opts: { metros?: string[]; perMetro: number; write: boolean }): Promise<{ metros: number; matched: number; products: number; written: number; skipped: string[] }> {
  const out = { metros: 0, matched: 0, products: 0, written: 0, skipped: [] as string[] };
  if (!tiqetsConfigured()) {
    console.log("TIQETS_API_KEY is not set, so nothing is pulled. Generate one in the Tiqets partner portal (Tools -> API tokens) and put it in backend/.env.");
    return out;
  }
  const wanted = opts.metros?.length ? METROS.filter((m) => opts.metros!.includes(m.id)) : METROS;
  out.metros = wanted.length;
  const byMetro = metroCities(await cities());
  for (const m of wanted) {
    const city = byMetro.get(m.id);
    if (!city) {
      out.skipped.push(m.id);
      console.log(`  ${m.id}: no Tiqets city of that name, skipped`);
      continue;
    }
    out.matched++;
    let page = 1;
    let kept = 0;
    while (kept < opts.perMetro) {
      const r = await searchCity(city.id, { page, pageSize: Math.min(100, opts.perMetro - kept), currency: m.country === "CA" ? "CAD" : "USD" });
      if (!r.products.length) break;
      for (const p of r.products) {
        if (kept >= opts.perMetro) break;
        if (NOT_EXPERIENCE.test(p.title || "")) continue;
        out.products++;
        kept++;
        if (opts.write && upsertProduct(p, m.id)) out.written++;
      }
      if (page * 100 >= r.total) break;
      page++;
      await pause(250);
    }
    console.log(`  ${m.id}: ${city.name} (#${city.id}), ${kept} products${opts.write ? " stored" : ""}`);
  }
  if (opts.write) db.prepare("INSERT INTO affiliate_sync (source, last_full_at) VALUES ('tiqets', ?) ON CONFLICT(source) DO UPDATE SET last_full_at = excluded.last_full_at").run(nowIso());
  return out;
}
