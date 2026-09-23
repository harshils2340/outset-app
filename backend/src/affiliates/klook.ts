import { db, nowIso } from "../db/client.ts";
import { METROS } from "../taxonomy/catalog.ts";

/**
 * Klook affiliate feed: attractions, tickets and activities licensed through Klook's affiliate content API,
 * booked on klook.com on a link that carries our affiliate ids. Same shape and same table as viator.ts and
 * tiqets.ts; see viator.ts for what an affiliate row is and is not.
 *
 * What is and is not documented, as of 23 September 2026. Klook publishes exactly one API specification
 * (klook.gitbook.io/openapi) and it is the OCTO supplier spec: a tour operator hosts the endpoints and Klook
 * calls them, so it carries no city list, no product search and no affiliate link. The affiliate portal
 * (affiliate.klook.com) offers deep links, banners and search boxes, and says "data feeds, API, white label"
 * are available on request from affiliate@klook.com; the documentation for that API is only handed out
 * with the access. AltexSoft's write-up of the same portal says outright that Klook "doesn't provide APIs
 * for businesses that distribute tours and attractions" beyond those tools. So:
 *
 *   verified    the affiliate tracked-link shape, seen on the affiliate portal's link tools and reproduced
 *               by third parties: affiliate.klook.com/redirect?aid=<WID>&aff_adid=<AID>&k_site=<url>.
 *               Note the naming: the `aid=` query parameter carries the WEBSITE id, and the affiliate
 *               partner id goes in `aff_adid=`.
 *   verified    Klook's only published auth scheme (the OCTO spec, getting-started/authentication): HTTPS
 *               only, `Authorization: Bearer <key>`, a bad key answers 403.
 *   unverified  everything else: the base URL, the paths and the product fields below are the smallest
 *               plausible shape and every one is marked "unverified: no public doc". Nothing here reads a
 *               klook.com page; when the affiliate team sends the real document, correct the marked lines
 *               and the tests, and the rest of the pipeline (table, sync, listing page) needs nothing.
 *
 *   KLOOK_API_KEY   the key the affiliate team issues with API access. Unset: every command says so and
 *                   does nothing.
 *   KLOOK_API_BASE  the base URL that comes with the key, since none is published. Unset: same.
 *   KLOOK_AID       the affiliate partner id (affiliate.klook.com, account page: "AID"). Goes in aff_adid=.
 *   KLOOK_WID       the website id for onoutset.com (same page, "WID"). Goes in aid=.
 *
 * Cities are matched to our metros by name and country like tiqets.ts does, since a name match cannot fill
 * a metro with another city's tours the way a loose radius can.
 */

const KEY = () => (process.env.KLOOK_API_KEY || "").trim();
const BASE = () => (process.env.KLOOK_API_BASE || "").trim().replace(/\/+$/, "");
const AID = () => (process.env.KLOOK_AID || "").trim();
const WID = () => (process.env.KLOOK_WID || "").trim();

export function klookConfigured(): boolean {
  return !!KEY() && !!BASE();
}

/** Why a pull cannot start, for the log line; null when it can. */
export function klookMissing(): string | null {
  const missing = [!KEY() && "KLOOK_API_KEY", !BASE() && "KLOOK_API_BASE"].filter(Boolean);
  return missing.length ? missing.join(" and ") + " not set" : null;
}

// unverified: no public doc. The field names are the smallest plausible shape of a city row.
export type KlookCity = { id: string | number; name: string; country?: string; country_code?: string };

// unverified: no public doc. Field names follow what Klook's public listing pages show (title, price with
// currency, score with review count, duration, city) so a real document is a rename, not a redesign.
export type KlookActivity = {
  id: string | number;
  title?: string;
  subtitle?: string;
  description?: string;
  images?: (string | { url?: string; large?: string; medium?: string })[];
  image_url?: string;
  price?: number | string;
  selling_price?: number | string;
  market_price?: number | string;
  currency?: string;
  rating?: number;
  score?: number;
  review_count?: number;
  reviews?: number;
  duration?: string;
  city_id?: string | number;
  city_name?: string;
  url?: string;
  deep_link?: string;
  affiliate_url?: string;
  free_cancellation?: boolean;
  instant_confirmation?: boolean;
  tags?: string[];
};

/**
 * Klook has published no rate limit for this API. Viator's Basic Access key throttled on the second call of
 * a run, so the same pacing is used here from the start: a floor between calls and a waited-out 429.
 */
const MIN_GAP_MS = 500;
let lastCallAt = 0;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const key = KEY();
  const base = BASE();
  if (!key || !base) throw new Error(klookMissing() || "Klook is not configured");
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));
  const url = base + path + (q.size ? "?" + q.toString() : "");
  for (let attempt = 0; ; attempt++) {
    const wait = lastCallAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await pause(wait);
    lastCallAt = Date.now();
    const res = await fetch(url, {
      // Verified: the one auth scheme Klook documents (OCTO, getting-started/authentication) is a Bearer key
      // over HTTPS. Unverified that the affiliate API uses the same header; it is the documented default.
      headers: { Authorization: "Bearer " + key, Accept: "application/json", "Accept-Language": "en-US" },
      signal: AbortSignal.timeout(25000),
    });
    if (res.status === 429 && attempt < 6) {
      const after = Number(res.headers.get("retry-after")) || 0;
      const ms = after > 0 ? after * 1000 : 2000 * 2 ** attempt;
      console.log(`  klook ${path}: 429, waiting ${Math.round(ms / 1000)}s`);
      await res.text();
      await pause(ms);
      continue;
    }
    if (!res.ok) throw new Error(`klook ${path} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as T;
  }
}

/** Every Klook city, all pages. Path and paging: unverified, no public doc. */
export async function cities(): Promise<KlookCity[]> {
  const out: KlookCity[] = [];
  for (let page = 1; page < 100; page++) {
    const r = await call<{ cities?: KlookCity[]; total?: number }>("/cities", { page, page_size: 100 });
    out.push(...(r.cities || []));
    if (!r.cities?.length || (r.total != null && out.length >= r.total)) break;
  }
  return out;
}

const COUNTRY: Record<string, { name: RegExp; code: string }> = { US: { name: /^united states/i, code: "US" }, CA: { name: /^canada$/i, code: "CA" } };

/** The Klook city for each metro: same name, same country (by code or name). A metro with none is skipped, never guessed. */
export function metroCities(list: KlookCity[]): Map<string, KlookCity> {
  const out = new Map<string, KlookCity>();
  for (const m of METROS) {
    const want = m.name.toLowerCase().replace(/ bay$/, "");
    const c = COUNTRY[m.country];
    const hit = list.find((x) => (x.name || "").toLowerCase() === want && ((x.country_code || "").toUpperCase() === c.code || c.name.test(x.country || "")));
    if (hit) out.set(m.id, hit);
  }
  return out;
}

/** Activities in one city, most booked first. Path, params and response shape: unverified, no public doc. */
export async function searchCity(cityId: string | number, opts: { page?: number; pageSize?: number; currency?: string } = {}): Promise<{ activities: KlookActivity[]; total: number }> {
  const r = await call<{ activities?: KlookActivity[]; total?: number }>("/activities", {
    city_id: cityId,
    page: opts.page ?? 1,
    page_size: Math.min(opts.pageSize ?? 100, 100),
    currency: opts.currency || "USD",
    lang: "en_US",
  });
  return { activities: r.activities || [], total: r.total ?? 0 };
}

/** Photo URLs, https only, at most eight. Accepts a bare URL or an object with a size variant (unverified shape). */
export function images(p: KlookActivity, max = 8): string[] {
  const out: string[] = [];
  const add = (u?: string) => {
    if (u && /^https:\/\//i.test(u) && !out.includes(u) && out.length < max) out.push(u);
  };
  for (const i of p.images || []) add(typeof i === "string" ? i : i.large || i.url || i.medium);
  add(p.image_url);
  return out;
}

const num = (v: number | string | undefined): number | null => {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** The from price in cents: the selling price when the API states one separately, else the price. */
export function fromCents(p: KlookActivity): number | null {
  const v = num(p.selling_price) ?? num(p.price);
  return v == null ? null : Math.round(v * 100);
}

/**
 * The link the guest books on, carrying our ids. If the API already returns an affiliate-attributed link
 * (affiliate_url or deep_link), that is used as is. Otherwise the activity's klook.com page is wrapped in the
 * portal's tracked redirect, whose shape is verified: affiliate.klook.com/redirect?aid=<WID>&aff_adid=<AID>&k_site=<url>.
 * With no ids set the plain page is returned, so a listing still works and the CLI says the commission is off.
 */
export function bookingUrl(p: KlookActivity): string | null {
  const tracked = (p.affiliate_url || p.deep_link || "").trim();
  if (/^https:\/\//i.test(tracked)) return tracked;
  const page = (p.url || "").trim();
  if (!/^https:\/\/(www\.)?klook\.com\//i.test(page)) return null;
  const aid = AID();
  const wid = WID();
  if (!aid || !wid) return page;
  return "https://affiliate.klook.com/redirect?aid=" + encodeURIComponent(wid) + "&aff_adid=" + encodeURIComponent(aid) + "&k_site=" + encodeURIComponent(page);
}

/** Not an experience a guest books a day around: SIM cards, airport buses, hotels, which are a lot of Klook. */
const NOT_EXPERIENCE = /\b(transfer|shuttle|airport|limousine bus|sim card|esim|wi-?fi|pocket wifi|hotel|parking|luggage|storage|car rental|rental car|rail pass|train ticket)\b/i;

export function isExperience(p: KlookActivity): boolean {
  return !NOT_EXPERIENCE.test(p.title || "");
}

export function upsertProduct(p: KlookActivity, city: KlookCity, metroId: string): boolean {
  const url = bookingUrl(p);
  const code = p.id == null ? "" : String(p.id);
  if (!url || !p.title || !code) return false;
  const flags: string[] = [];
  if (p.free_cancellation) flags.push("FREE_CANCELLATION");
  if (p.instant_confirmation) flags.push("INSTANT_CONFIRMATION");
  const metro = METROS.find((m) => m.id === metroId);
  db.prepare(
    `INSERT INTO affiliate_products (id, source, product_code, title, description, images, from_cents, currency, rating, review_count, duration,
       destination_id, destination_name, metro_id, lat, lon, tags, booking_url, flags, raw, fetched_at)
     VALUES (?, 'klook', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source, product_code) DO UPDATE SET
       title = excluded.title, description = excluded.description, images = excluded.images, from_cents = excluded.from_cents,
       currency = excluded.currency, rating = excluded.rating, review_count = excluded.review_count, duration = excluded.duration,
       destination_id = excluded.destination_id, destination_name = excluded.destination_name, metro_id = excluded.metro_id,
       lat = excluded.lat, lon = excluded.lon, tags = excluded.tags, booking_url = excluded.booking_url, flags = excluded.flags,
       raw = excluded.raw, fetched_at = excluded.fetched_at`,
  ).run(
    "a-klook-" + code.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    code,
    p.title.trim(),
    (p.description || p.subtitle || "").trim() || null,
    JSON.stringify(images(p)),
    fromCents(p),
    p.currency || "USD",
    p.rating ?? p.score ?? null,
    p.review_count ?? p.reviews ?? null,
    p.duration || null,
    String(city.id),
    p.city_name || city.name,
    metroId,
    // No coordinates are known for an activity; the metro's centre is the honest pin, and it says "near".
    metro?.lat ?? null,
    metro?.lon ?? null,
    JSON.stringify(p.tags || []),
    url,
    JSON.stringify(flags),
    JSON.stringify(p),
    nowIso(),
  );
  return true;
}

export async function pullKlook(opts: { metros?: string[]; perMetro: number; write: boolean }): Promise<{ metros: number; matched: number; products: number; written: number; skipped: string[] }> {
  const out = { metros: 0, matched: 0, products: 0, written: 0, skipped: [] as string[] };
  if (!klookConfigured()) {
    console.log(`${klookMissing()}, so nothing is pulled. API access comes from the Klook affiliate team (affiliate@klook.com, affiliate.klook.com); put the key and base URL they send in backend/.env.`);
    return out;
  }
  if (!AID() || !WID()) console.log("  KLOOK_AID or KLOOK_WID is not set: links go to klook.com untracked, so no commission is earned on them.");
  const wanted = opts.metros?.length ? METROS.filter((m) => opts.metros!.includes(m.id)) : METROS;
  out.metros = wanted.length;
  const byMetro = metroCities(await cities());
  for (const m of wanted) {
    const city = byMetro.get(m.id);
    if (!city) {
      out.skipped.push(m.id);
      console.log(`  ${m.id}: no Klook city of that name, skipped`);
      continue;
    }
    out.matched++;
    let page = 1;
    let kept = 0;
    while (kept < opts.perMetro) {
      const r = await searchCity(city.id, { page, pageSize: Math.min(100, opts.perMetro - kept), currency: m.country === "CA" ? "CAD" : "USD" });
      if (!r.activities.length) break;
      for (const p of r.activities) {
        if (kept >= opts.perMetro) break;
        if (!isExperience(p)) continue;
        out.products++;
        kept++;
        if (opts.write && upsertProduct(p, city, m.id)) out.written++;
      }
      if (page * 100 >= r.total) break;
      page++;
      await pause(250);
    }
    console.log(`  ${m.id}: ${city.name} (#${city.id}), ${kept} activities${opts.write ? " stored" : ""}`);
  }
  if (opts.write) db.prepare("INSERT INTO affiliate_sync (source, last_full_at) VALUES ('klook', ?) ON CONFLICT(source) DO UPDATE SET last_full_at = excluded.last_full_at").run(nowIso());
  return out;
}
