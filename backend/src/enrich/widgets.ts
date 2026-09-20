import { randomUUID } from "node:crypto";
import { db, nowIso } from "../db/client.ts";
import { safeFetch } from "../lib/safeFetch.ts";
import { normalizePhone } from "../scrape/run.ts";
import { withDeadline } from "../scrape/fetch.ts";
import { spawnWorkers } from "../scrape/cpu.ts";
import { acuityRef, readAcuity } from "./vendors/acuity.ts";
import { burbleRef, readBurble } from "./vendors/burble.ts";
import { squareRef, readSquare } from "./vendors/square.ts";
import { checkfrontRef, readCheckfront } from "./vendors/checkfront.ts";
import { resovaRef, readResova } from "./vendors/resova.ts";
import { vallyproRef, readVallypro } from "./vendors/vallypro.ts";
import { rezdyRef, readRezdy } from "./vendors/rezdy.ts";
import { bookeoRef, readBookeo } from "./vendors/bookeo.ts";
import { renderPage } from "../scrape/render.ts";
import { isLaptop } from "../scrape/guard.ts";

/**
 * Booking widgets as a free, exact source. FareHarbor and Xola publish each operator's item catalog as JSON
 * with no key: names, headlines, prices, durations, descriptions, photos, cancellation and check-in notes.
 * That is the operator's own live menu, so it outranks anything read from marketing pages.
 * Rows carry confidence 'widget'. Nothing is invented: a field the widget leaves blank stays blank.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export type Offering = { name: string; detail: string | null; duration: string | null; price: number | null; unit: string; url: string; desc: string | null; photo: string | null; photos: string[] };
export type Company = { currency?: string | null; phone?: string | null; email?: string | null; street?: string | null; city?: string | null; region?: string | null; postal?: string | null; cover?: string | null; videoEmbed?: string | null; waiverUrl?: string | null; cancellation?: string | null; checkin?: string | null; faq?: string | null;
  /** The booking system's own review average and count, when its public payload states them (Peek). No review text is published. */
  aggregate?: { rating: number; count: number } | null };
export type WidgetResult = { vendor: string; offerings: Offering[]; company: Company; requirements: string[]; policies: string[]; includes: string[]; pages: number };

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await safeFetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, timeoutMs: 15000, maxBytes: 5_000_000 });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Markdown and HTML to plain sentences. */
export function plain(s: unknown): string {
  if (s == null) return "";
  if (typeof s !== "string") {
    if (typeof s === "number") return String(s);
    return "";
  }
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*|__|\*|_{1,2}/g, "")
    .replace(/^[-*•]\s+/gm, "")
    .replace(/_{5,}/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const REQ_RE = /\b(must be|minimum age|ages?\s*\d|\d+\s*(?:\+|and up|or older|years? old)|under \d+|weight limit|max(?:imum)? weight|\d{2,3}\s*(?:lbs?|pounds|kg)|valid (?:driver'?s? )?licen[cs]e|boating licen[cs]e|boater (?:safety )?(?:card|education)|swim|life ?jacket|pregnan|heart condition|adult (?:must|required)|accompanied by|photo id|closed[- ]toe|sober|alcohol|no experience)\b/i;
const POL_RE = /\b(cancel|refund|deposit|reschedul|no[- ]show|weather|rain ?check|late arrival|forfeit|non-?refundable|full payment|gratuit|tip)\b/i;
const INC_RE = /\b(includes?|included|provided|we provide|comes with)\b/i;
const NOISE_RE = /^rates?\b|\(\d{3}\)|\d{3}[-.]\d{3}[-.]\d{4}|call us|contact us|http|@|click|\bwww\b/i;

/** Sentences worth keeping as guest facts, split from any block of copy. */
export function mineSentences(text: string): { requirements: string[]; policies: string[]; includes: string[] } {
  const out = { requirements: [] as string[], policies: [] as string[], includes: [] as string[] };
  const seen = new Set<string>();
  for (const raw of plain(text).split(/(?<=[.!?])\s+(?=[A-Z0-9])/)) {
    const s = raw.trim().replace(/^[^A-Za-z0-9$]+/, "");
    if (s.length < 25 || s.length > 260 || NOISE_RE.test(s)) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    let bucket: keyof typeof out | null = null;
    if (REQ_RE.test(s)) bucket = "requirements";
    else if (POL_RE.test(s)) bucket = "policies";
    else if (INC_RE.test(s)) bucket = "includes";
    if (!bucket || out[bucket].length >= 8) continue;
    seen.add(key);
    out[bucket].push(/[.!?]$/.test(s) ? s : s + ".");
  }
  return out;
}

/** "One Hour Rental $125 Two Hour Rental: $199 Half Day Rental: $349" -> labelled rows. Only distinct labels, only the rates block. */
export function rateRows(text: string): { label: string; price: number }[] {
  const block = (text.match(/\bRates?\b[:\s]*(.{0,600}?)(?=\b(?:Duration|About|Includes?|What to bring|Requirements?|Cancellation|Policy|Please note|Note:)\b|$)/i) || [])[1] || "";
  const out: { label: string; price: number }[] = [];
  const seen = new Set<string>();
  const re = /([A-Z][A-Za-z0-9&\/' -]{2,40}?)\s*[:\-–]?\s*\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d{2,5}(?:\.\d{2})?)(?![\d,])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    const label = m[1].replace(/\b(Rates?|Price|Prices|Pricing|Starting at|From)\b/gi, "").replace(/\s+/g, " ").trim().replace(/[:\-–]$/, "").trim();
    if (label.length < 3 || /^(per|each|and|or|the)$/i.test(label)) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: label.slice(0, 60), price: Number(m[2].replace(/,/g, "")) });
    if (out.length >= 8) break;
  }
  return out;
}

function money(s: string | null | undefined): number | null {
  // "$1,150" is eleven hundred and fifty, not one dollar fifteen. Thousands groups first, then a plain number, then cents.
  const m = (s || "").match(/\$\s?(\d{1,3}(?:,\d{3})+|\d{1,6})(?:\.(\d{2}))?(?![\d,])/);
  return m ? Number(m[1].replace(/,/g, "") + (m[2] ? "." + m[2] : "")) : null;
}

function durationOf(...parts: (string | null | undefined)[]): string | null {
  for (const p of parts) {
    const m = (p || "").match(/\b(\d+(?:\.\d+)?(?:\s*-\s*\d+)?)\s*(hours?|hrs?|minutes?|mins?|days?)\b/i);
    if (m) return m[1] + " " + m[2].toLowerCase().replace(/^hrs?$/, "hours").replace(/^mins?$/, "min");
  }
  return null;
}

function unitOf(headline: string | null | undefined, name: string): string {
  const h = (headline || "") + " " + name;
  if (/per (?:jet ?ski|boat|kayak|vessel|cart|kart|lane|room|group|vehicle|hour|person|adult|guest|rider|player)/i.test(h)) {
    const m = h.match(/per (jet ?ski|boat|kayak|vessel|cart|kart|lane|room|group|vehicle|hour|person|adult|guest|rider|player)/i)![1].toLowerCase();
    if (/person|adult|guest|rider|player/.test(m)) return "each";
    if (m === "hour") return "/hr";
    return "/" + m.replace(/\s+/g, " ");
  }
  return "each";
}

/* ---------- FareHarbor ---------- */

type FhItem = {
  pk: number; name: string; headline: string | null; description: string | null; description_text: string | null; short_description: string | null;
  booking_notes: string | null; cancellation_notes: string | null; is_archived: boolean; is_unlisted: boolean; is_private: boolean;
  images?: { image_cdn_url: string }[]; image_cdn_url: string | null; minimum_initial_party_size: number | null; maximum_initial_party_size: number | null;
};
type FhCompany = {
  processor_currency?: string | null;
  phone: string | null; email: string | null; street: string | null; city: string | null; province: string | null; postal_code: string | null;
  image_background_cdn_url: string | null; url_youtube: string | null; smartwaiver_url: string | null; cancellation_notes: string | null;
  booking_notes: string | null; faq: string | null; about: string | null; intro: string | null; summary: string | null;
};

export function fareharborShortname(bookingUrl: string): string | null {
  /**
   * Not every FareHarbor link a shop publishes is a booking page. A signed waiver link is
   * `fareharbor.com/waivers?shortname=enrgkayaking&bookingUuid=...`, which carries the company outright, and
   * `fareharbor.com/legal/privacy/` carries none at all. Reading the first path segment as the company asked
   * FareHarbor about a shop called "waivers" and got nothing back, so a kayak outfitter with a live calendar
   * read as a business with nothing bookable online.
   */
  const named = bookingUrl.match(/[?&]shortname=([a-z0-9-]+)/i);
  if (named) return named[1];
  const m = bookingUrl.match(/fareharbor\.com\/(?:embeds\/(?:book|api\/v\d+)\/)?([a-z0-9-]+)\/?/i);
  if (!m || /^(api|embeds|book|widgets|static|waivers|legal|help|support|pages|www)$/i.test(m[1])) return null;
  return m[1];
}

/* ---------- FareHarbor prices ----------
 * The item catalog carries no prices: what a guest pays is decided per departure by a price sheet. The widget
 * itself reads it in three public calls, no key:
 *   companies/<sn>/calendar/<YYYY>/<MM>/                       every departure this month, with its item pk
 *   items/<pk>/availabilities/<apk>/                           the departure's customer types (Adult, Child, Single Rider)
 *   availabilities/<apk>/effective-sheets/                     which price sheet applies online (one per company, cached)
 *   total-sheets/<sheet>/pricing/availabilities/<apk>/         the online total per customer type, in cents, fees included
 * One departure per item is enough: the first bookable one this month or next. A seasonal item with no departure
 * keeps the price the copy states, if any. Calls go one at a time with a pause; every request lands on the same host. */

type FhRate = { label: string; cents: number; unit: string | null; min: number | null; max: number | null };
type FhItemRates = { rates: FhRate[]; availabilityPk: number };
type FhRateAvailability = { customer_type_rates?: { pk: number; minimum_party_size: number | null; maximum_party_size: number | null; customer_prototype?: { display_name?: string | null; customer_type?: { singular?: string | null; note?: string | null } | null } | null }[] };
type FhSheetPricing = { price_previews?: { customer_types?: { customer_type_rate: number; total: number | null }[] } };

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The price calls are four deep; one slow answer from fareharbor.com must not leave a whole item unpriced. */
async function getJsonRetry<T>(url: string): Promise<T | null> {
  const first = await getJson<T>(url);
  if (first) return first;
  await pause(1500);
  return getJson<T>(url);
}

/** "Group of up to 6", "Boat (1-4 people)", "Private tour" sell the whole thing; everything else is per person. */
function rateUnit(label: string): string | null {
  return /\b(group|boat|private|whole|entire|per (?:vessel|cart|kayak|bike|room|lane|table|hour))\b|\b(?:up to|for) \d+ (?:people|guests|riders|players|persons)\b/i.test(label) ? "each" : "person";
}

export async function fareharborRates(base: string, items: FhItem[]): Promise<Map<number, FhItemRates>> {
  const out = new Map<number, FhItemRates>();
  const wanted = new Set(items.filter((i) => i && !i.is_archived && !i.is_unlisted && !i.is_private).map((i) => i.pk));
  if (!wanted.size) return out;
  // First bookable departure per item, this month then next.
  const first = new Map<number, number>();
  const now = new Date();
  for (let k = 0; k < 2 && first.size < wanted.size; k++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + k, 1));
    const cal = await getJsonRetry<{ calendar?: { weeks?: { days?: { availabilities?: { pk?: number; is_bookable?: boolean; is_sold_out?: boolean; is_unlisted?: boolean; item?: { pk?: number; uri?: string } }[] }[] }[] } }>(base + `calendar/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/`);
    for (const w of cal?.calendar?.weeks || []) for (const day of w.days || []) for (const a of day.availabilities || []) {
      const pk = typeof a.item?.pk === "number" ? a.item.pk : Number(a.item?.uri?.match(/\/items\/(\d+)\//)?.[1] ?? NaN);
      if (!a.pk || !Number.isFinite(pk) || !wanted.has(pk) || first.has(pk) || a.is_unlisted || a.is_sold_out || a.is_bookable === false) continue;
      first.set(pk, a.pk);
    }
    await pause(150);
  }
  let sheet: number | null = null;
  for (const [itemPk, apk] of first) {
    const av = await getJsonRetry<{ availability?: FhRateAvailability }>(base + `items/${itemPk}/availabilities/${apk}/`);
    const ctrs = av?.availability?.customer_type_rates || [];
    if (!ctrs.length) continue;
    await pause(150);
    if (sheet == null) {
      const eff = await getJsonRetry<{ effective_sheets?: { total_sheet?: { pk?: number } } }>(base + `availabilities/${apk}/effective-sheets/`);
      sheet = eff?.effective_sheets?.total_sheet?.pk ?? null;
      await pause(150);
      if (sheet == null) break;
    }
    const pr = await getJsonRetry<FhSheetPricing>(base + `total-sheets/${sheet}/pricing/availabilities/${apk}/`);
    await pause(150);
    const totals = new Map((pr?.price_previews?.customer_types || []).map((c) => [c.customer_type_rate, c.total]));
    const rates: FhRate[] = [];
    for (const c of ctrs) {
      const cents = totals.get(c.pk);
      if (typeof cents !== "number" || cents <= 0) continue;
      const label = plain(c.customer_prototype?.display_name || c.customer_prototype?.customer_type?.singular || "").slice(0, 120);
      if (!label) continue;
      rates.push({ label, cents: Math.round(cents), unit: rateUnit(label), min: c.minimum_party_size, max: c.maximum_party_size });
    }
    if (rates.length) out.set(itemPk, { rates, availabilityPk: apk });
  }
  return out;
}

export async function readFareharbor(shortname: string): Promise<WidgetResult | null> {
  const base = "https://fareharbor.com/api/v1/companies/" + encodeURIComponent(shortname) + "/";
  const [co, it] = await Promise.all([getJson<{ company: FhCompany }>(base), getJson<{ items: FhItem[] }>(base + "items/")]);
  if (!co?.company || !it?.items) return null;
  const c = co.company;
  const live = await fareharborRates(base, it.items);
  const offerings: Offering[] = [];
  const req = new Set<string>(); const pol = new Set<string>(); const inc = new Set<string>();
  for (const item of it.items) {
    if (!item || !item.name || item.is_archived || item.is_unlisted || item.is_private) continue;
    const headline = plain(item.headline);
    const descLong = plain(item.description_text || item.description);
    const desc = [plain(item.short_description) || descLong.slice(0, 600).replace(/\s+\S*$/, ""), headline ? headline.replace(/\s*\|\s*/g, " · ") : ""].filter(Boolean).join(" ").slice(0, 700);
    const photos = (item.images || []).map((i) => i.image_cdn_url).filter(Boolean);
    if (item.image_cdn_url && !photos.includes(item.image_cdn_url)) photos.unshift(item.image_cdn_url);
    const duration = durationOf(headline, descLong);
    const url = "https://fareharbor.com/embeds/book/" + shortname + "/items/" + item.pk + "/";
    const unit = unitOf(headline, item.name);
    const name = String(item.name || "").trim();
    // A rates table in the copy ("One Hour Rental $125 Two Hour Rental: $199 Half Day: $349") becomes one option per row.
    const rates = rateRows(descLong);
    const priced = live.get(item.pk);
    if (priced) {
      // The price sheet is what the widget charges today: one row per customer type, exact, fees included.
      for (const r of priced.rates) {
        const detail = r.label.toLowerCase() === name.toLowerCase() ? (r.unit === "each" ? "Per booking" : "Per person") : r.label;
        offerings.push({ name, detail, duration: durationOf(r.label) || duration, price: r.cents / 100, unit: r.unit || unit, url, desc: desc || null, photo: photos[0] || null, photos });
      }
    } else if (rates.length >= 2) {
      for (const r of rates) offerings.push({ name, detail: r.label, duration: durationOf(r.label) || duration, price: r.price, unit, url, desc: desc || null, photo: photos[0] || null, photos });
    } else {
      offerings.push({
        name,
        // The variant label guests pick. The headline is copy, not a label, so it goes into the description.
        detail: duration,
        duration,
        price: money(headline) ?? money(descLong),
        unit,
        url,
        desc: desc || null,
        photo: photos[0] || null,
        photos,
      });
    }
    const mined = mineSentences([descLong, item.booking_notes, item.cancellation_notes].filter(Boolean).join(" "));
    mined.requirements.forEach((s) => req.add(s));
    mined.policies.forEach((s) => pol.add(s));
    mined.includes.forEach((s) => inc.add(s));
    if (item.minimum_initial_party_size && item.minimum_initial_party_size > 1) req.add(`${item.name}: minimum ${item.minimum_initial_party_size} guests per booking.`);
    if (item.maximum_initial_party_size) inc.add(`${item.name}: up to ${item.maximum_initial_party_size} guests per booking.`);
  }
  const coMined = mineSentences([c.cancellation_notes, c.booking_notes, c.faq, c.about, c.intro].filter(Boolean).join(" "));
  coMined.requirements.forEach((s) => req.add(s));
  coMined.policies.forEach((s) => pol.add(s));
  const yt = c.url_youtube && /youtu(?:be\.com\/(?:watch\?v=|embed\/)|\.be\/)([A-Za-z0-9_-]{6,})/.exec(c.url_youtube);
  return {
    vendor: "fareharbor",
    offerings,
    company: {
      currency: c.processor_currency ? c.processor_currency.toUpperCase() : null,
      phone: c.phone, email: c.email, street: c.street, city: c.city, region: c.province, postal: c.postal_code,
      cover: c.image_background_cdn_url || null,
      videoEmbed: yt ? "https://www.youtube.com/embed/" + yt[1] : null,
      waiverUrl: c.smartwaiver_url || null,
      cancellation: plain(c.cancellation_notes).slice(0, 400) || null,
      checkin: plain(c.booking_notes).slice(0, 400) || null,
      faq: plain(c.faq).slice(0, 1200) || null,
    },
    requirements: [...req].slice(0, 10),
    policies: [...pol].slice(0, 10),
    includes: [...inc].slice(0, 10),
    pages: 2,
  };
}

/* ---------- Xola ---------- */

/**
 * Xola publishes each seller's experiences at GET https://xola.com/api/experiences?seller=<id>&limit=100 with no key.
 * Prices come as `priceSchemes`, one per combination a guest can pick, each carrying constraints: privacy
 * (public or private), price type (per person or per outing), a party-size band for tiered private prices, and
 * sometimes a demographic id. When a seller prices per demographic (Adult, Child, Non-Drinker) but publishes one
 * flat scheme, the per-demographic prices sit in `catalog.items` with unitType 'demographic'. One offering row is
 * written per pickable price; the minimum price is only a fallback when no scheme has a price.
 */
type XolaConstraint = { object?: string; privacy?: string; priceType?: string; min?: number | null; max?: number | null; demographic?: { id?: string } | string | null; demographicId?: string | null };
type XolaCatalogItem = { name?: string; type?: string; unitType?: string | null; visibility?: string; required?: boolean; sku?: string;
  prices?: { price?: { min?: number; max?: number; priceType?: string } } | unknown[]; items?: XolaCatalogItem[]; displaySections?: string[] };
type XolaAddOn = { name?: string; desc?: string | null; visibility?: string; object?: string; price?: number; priceType?: string; choices?: { name?: string; price?: number; priceType?: string; visibility?: string }[] };
type XolaExp = {
  id: string; name: string; desc: string | null; excerpt: string | null; duration: number | null; eventDuration?: number | null; status: string; visible?: boolean; currency?: string | null;
  priceSchemes?: { price: number; constraints?: XolaConstraint[] }[];
  photo?: { src: string } | null; medias?: { src: string; type: string }[]; cancellationPolicy?: string | null; cancellation?: { policy?: string | null } | null;
  included?: string | string[] | null; notIncluded?: string | string[] | null; other?: string | null; pickupAddress?: string | null;
  requireAdult?: boolean; requireGuestIdentification?: boolean; demographics?: { id?: string; label?: string; minAge?: number; maxAge?: number }[];
  group?: { orderMin?: number | null; orderMax?: number | null; outingMin?: number | null; outingMax?: number | null } | null;
  addOns?: XolaAddOn[] | null; catalog?: { items?: XolaCatalogItem[] } | null; allowedPrivacies?: string[];
};

/**
 * The seller reference inside any Xola URL form we have seen. `#seller/<id>` (checkout.xola.com, checkout.xola.app)
 * and `sellerId=<id>` (waivers-ui.xola.com) carry the seller directly. Button forms (`#buttons/<id>`,
 * `?button=<id>` on x2-checkout.xola.app, gift-ui.xola.com and gift.xola.app) carry only a button id, which
 * readXola resolves through GET https://xola.com/api/buttons/<id> (returns `seller.id`, no key needed).
 */
export function xolaSeller(bookingUrl: string): string | null {
  const s = bookingUrl.match(/(?:seller\/|[?&]sellerId=)([a-f0-9]{24})\b/i);
  if (s) return s[1];
  const b = bookingUrl.match(/(?:buttons?\/|[?&#]button=)([a-f0-9]{24})\b/i);
  return b ? "button:" + b[1] : null;
}

function xolaText(s: string | string[] | null | undefined): string {
  return Array.isArray(s) ? s.map((x) => plain(x)).filter(Boolean).join(". ") : plain(s);
}

function xolaMinutes(min: number | null | undefined): string | null {
  if (!min || min <= 0) return null;
  if (min < 60) return min + " min";
  const h = (min / 60).toFixed(min % 60 ? 1 : 0);
  return h + (h === "1" ? " hour" : " hours");
}

/** "up to 16 guests", "17 guests", "17 to 20 guests", "8+ guests"; null when the band is unbounded. */
function xolaBand(min: number | null | undefined, max: number | null | undefined): string | null {
  const lo = typeof min === "number" && min > 1 ? min : null;
  const hi = typeof max === "number" && max > 0 && max < 9999 ? max : null;
  if (lo == null && hi == null) return null;
  if (lo == null) return `up to ${hi} guests`;
  if (hi == null) return `${lo}+ guests`;
  if (lo === hi) return `${lo} ${lo === 1 ? "guest" : "guests"}`;
  return `${lo} to ${hi} guests`;
}

function xolaMoney(n: number, currency: string | null | undefined): string {
  const sym = currency === "CAD" ? "CA$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : "$";
  return sym + (Number.isInteger(n) ? String(n) : n.toFixed(2));
}

export async function readXola(ref: string): Promise<WidgetResult | null> {
  let seller = ref;
  if (ref.startsWith("button:")) {
    const b = await getJson<{ seller?: { id?: string } }>("https://xola.com/api/buttons/" + ref.slice(7));
    if (!b?.seller?.id || !/^[a-f0-9]{24}$/i.test(b.seller.id)) return null;
    seller = b.seller.id;
  }
  const d = await getJson<{ data: XolaExp[] }>("https://xola.com/api/experiences?seller=" + seller + "&limit=100");
  if (!d?.data) return null;
  const offerings: Offering[] = [];
  const req = new Set<string>(); const pol = new Set<string>(); const inc = new Set<string>(); const addons = new Set<string>();
  let currency: string | null = null;
  for (const e of d.data) {
    if (!e || !e.name || (e.status && e.status !== "published") || e.visible === false) continue;
    if (!currency && e.currency) currency = e.currency;
    const name = String(e.name).trim();
    const photos = [...new Set([e.photo?.src, ...(e.medias || []).filter((m) => m.type === "photo").map((m) => m.src)].filter((s): s is string => !!s).map((s) => (s.startsWith("http") ? s : "https://xola.com" + s)))].slice(0, 6);
    const desc = plain(e.excerpt) || plain(e.desc).slice(0, 700).replace(/\s+\S*$/, "");
    const durationText = xolaMinutes(e.duration || e.eventDuration);
    const url = "https://checkout.xola.com/index.html#seller/" + seller + "/experiences/" + e.id;
    const demoLabel = new Map<string, string>();
    for (const dm of e.demographics || []) if (dm.id && dm.label) demoLabel.set(dm.id, plain(dm.label));
    const schemes = (e.priceSchemes || []).filter((p) => typeof p.price === "number" && p.price > 0);
    const privacies = new Set(schemes.map((p) => (p.constraints || []).find((c) => c.object === "privacy_constraint")?.privacy).filter(Boolean));

    // Rows a guest can pick: one per price scheme, labelled by its constraints.
    type Row = { label: string | null; price: number; unit: string };
    const rows: Row[] = [];
    for (const p of schemes) {
      const cs = p.constraints || [];
      const privacy = cs.find((c) => c.object === "privacy_constraint")?.privacy || null;
      const perOuting = cs.some((c) => c.object === "price_type_constraint" && c.priceType === "outing");
      const band = cs.find((c) => c.object === "quantity_constraint");
      const dc = cs.find((c) => c.object === "demographic_constraint");
      const dcId = dc ? (typeof dc.demographic === "string" ? dc.demographic : dc.demographic?.id || dc.demographicId || null) : null;
      const parts: string[] = [];
      if (privacy === "private" || (privacy === "public" && privacies.size > 1)) parts.push(privacy === "private" ? "Private" : "Shared");
      if (dcId) parts.push(demoLabel.get(dcId) || "Per guest");
      const bandText = band ? xolaBand(band.min, band.max) : null;
      if (bandText) parts.push(bandText);
      rows.push({ label: parts.length ? parts.join(", ") : null, price: p.price, unit: perOuting ? "/group" : "each" });
    }

    // Per-demographic prices (Adult, Child, Non-Drinker) live in the catalog when the seller publishes one flat
    // per-person scheme; each priced demographic becomes its own row.
    const demoItems: { name: string; min: number; max: number | null }[] = [];
    for (const i of e.catalog?.items || []) {
      const pr = !Array.isArray(i.prices) ? i.prices?.price : undefined;
      if (i.unitType === "demographic" && i.visibility !== "private" && i.name && typeof pr?.min === "number" && pr.min > 0) demoItems.push({ name: i.name, min: pr.min, max: typeof pr.max === "number" ? pr.max : null });
    }
    const flat = rows.length === 1 && rows[0].label == null && rows[0].unit === "each";
    if (demoItems.length > 1 && (flat || rows.length === 0)) {
      rows.length = 0;
      for (const i of demoItems) rows.push({ label: plain(i.name) + (i.max != null && i.max > i.min ? ", from" : ""), price: i.min, unit: "each" });
    }
    // Fallback: no priced scheme at all, keep the cheapest demographic price or leave the price blank.
    if (!rows.length) {
      const mins = demoItems.map((i) => i.min);
      rows.push({ label: null, price: mins.length ? Math.min(...mins) : NaN, unit: "each" });
    }
    // Dedupe identical rows (Xola sometimes repeats a scheme per privacy with the same price and label).
    const seenRow = new Set<string>();
    let first = true;
    for (const r of rows) {
      const key = `${r.label}|${r.price}|${r.unit}`;
      if (seenRow.has(key)) continue;
      seenRow.add(key);
      offerings.push({
        name,
        detail: r.label ? (durationText ? `${r.label} · ${durationText}` : r.label) : durationText,
        duration: e.duration ? e.duration + " min" : e.eventDuration ? e.eventDuration + " min" : null,
        price: Number.isFinite(r.price) ? r.price : null,
        unit: r.unit,
        url,
        desc: first ? desc || null : null,
        photo: first ? photos[0] || null : null,
        photos: first ? photos : [],
      });
      first = false;
    }

    // Add-ons a guest can buy with the booking (merchandise, insurance, extra guests); percent gratuities are skipped.
    for (const a of (e.addOns || []).filter((a) => a && a.visibility !== "private" && a.name)) {
      const opts = a.object === "choices" ? (a.choices || []).filter((c) => c.visibility !== "private" && typeof c.price === "number" && c.price > 0 && c.priceType === "absolute") : typeof a.price === "number" && a.price > 0 && a.priceType === "absolute" ? [{ name: null as string | null, price: a.price }] : [];
      for (const o of opts.slice(0, 2)) {
        const label = plain(a.name) + (o.name && plain(o.name).toLowerCase() !== plain(a.name).toLowerCase() ? ": " + plain(o.name) : "");
        const key = `addon|${label}|${o.price}`;
        if (seenRow.has(key)) continue;
        seenRow.add(key);
        addons.add(`Add-on for ${name}: ${label}, ${xolaMoney(o.price as number, e.currency)}.`);
      }
    }

    const cancel = plain(e.cancellationPolicy) || plain(e.cancellation?.policy);
    if (cancel) pol.add(cancel.slice(0, 260));
    const included = xolaText(e.included);
    if (included) included.split(/[.\n]/).map((s) => s.trim()).filter((s) => s.length > 3).slice(0, 6).forEach((s) => inc.add(`${name} includes ${s.charAt(0).toLowerCase() + s.slice(1)}.`));
    const notIncluded = xolaText(e.notIncluded);
    if (notIncluded) inc.add(`${name} does not include ${notIncluded.split(/[.\n]/).map((s) => s.trim()).filter((s) => s.length > 3).slice(0, 5).join(", ").toLowerCase()}.`);
    if (e.requireAdult) req.add(name + ": an adult must be in the group.");
    if (e.requireGuestIdentification) req.add(name + ": guests must show identification.");
    if (e.group?.orderMin && e.group.orderMin > 1) req.add(`${name}: minimum ${e.group.orderMin} guests per booking.`);
    if (e.group?.outingMax && e.group.outingMax < 9999) req.add(`${name}: up to ${e.group.outingMax} guests.`);
    for (const dm of e.demographics || []) if (dm.minAge != null) req.add(`${dm.label || "Guests"}: ages ${dm.minAge}${dm.maxAge ? " to " + dm.maxAge : " and up"}.`);
    const mined = mineSentences([plain(e.desc), plain(e.other), plain(e.pickupAddress)].filter(Boolean).join(" "));
    mined.requirements.forEach((s) => req.add(s));
    mined.policies.forEach((s) => pol.add(s));
  }
  return { vendor: "xola", offerings, company: { currency, cancellation: [...pol][0] || null }, requirements: [...req].slice(0, 10), policies: [...pol].slice(0, 10), includes: [...inc, ...addons].slice(0, 20), pages: ref.startsWith("button:") ? 2 : 1 };
}


/* ---------- Peek ---------- */

/** book.peek.com/s/<key>/<program code>. The key in the URL is the public API key the widget itself sends; a code may be a leaf "p_xxxx--<activity id>". */
export function peekRef(bookingUrl: string): { key: string; code: string } | null {
  const m = bookingUrl.match(/(?:book|www)\.peek\.com\/s\/([a-f0-9-]{36})\/([A-Za-z0-9_]+(?:--[a-f0-9-]{36})?)/i);
  return m ? { key: m[1], code: m[2] } : null;
}

type JsonApiDoc = { data?: { id: string }; included?: { type: string; id: string; attributes: Record<string, unknown>; relationships?: Record<string, { data: { id: string; type: string }[] | { id: string; type: string } | null }> }[] };

/** One Peek widget API call: the widget's own public key, one request at a time with a short pause so the vendor sees a browser-like pace. */
async function peekGet<T>(key: string, path: string): Promise<T | null> {
  await new Promise((r) => setTimeout(r, 400));
  try {
    const res = await safeFetch("https://book.peek.com/services/api/" + path, {
      headers: { "User-Agent": UA, Accept: "application/vnd.api+json", Authorization: "Key " + key },
      timeoutMs: 15000,
      maxBytes: 5_000_000,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function getPeek(key: string, code: string): Promise<JsonApiDoc | null> {
  return peekGet<JsonApiDoc>(key, "programs/" + encodeURIComponent(code));
}

const PEEK_RETAIL = /gift ?card|t-?shirt|hoodie|\bhat\b|sticker|merch|cake|mug|towel|sunscreen|photo package|video package|membership/i;

function peekMinutes(min: unknown, max: unknown): string | null {
  const a = typeof min === "number" ? min : null;
  const b = typeof max === "number" ? max : null;
  const fmt = (m: number) => (m >= 60 ? (m / 60).toFixed(m % 60 ? 1 : 0).replace(/\.0$/, "") + (m === 60 ? " hour" : " hours") : m + " min");
  if (a && b && b !== a) return fmt(a) + " to " + fmt(b);
  if (a) return fmt(a);
  if (b) return fmt(b);
  return null;
}

/** price: the shortest bookable block (or lowest date price); hourly: that block per hour when it is whole hours; hourSlot: a one-hour block exists. */
type PeekLive = { price: number; duration: string | null; span: string | null; hourly: number | null; hourSlot: boolean };

/**
 * Price of one ticket type from the widget's own availability feed, for tickets whose catalog price is blank.
 * availability-dates gives the next three weeks with a price range per date; for a rental the day's availability-times
 * lists every start time with its duration (minutes, name) and the price for one of this ticket, which is where
 * "from $40/hr" comes from: the shortest block's price divided by its hours. Other activities keep the lowest date price.
 * Requests: one, plus one more for a rental with an open date.
 */
async function peekLivePrice(key: string, activityId: string, ticketId: string, rental: boolean): Promise<PeekLive | null> {
  const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const q = `tickets%5B0%5D%5Bticket-id%5D=${ticketId}&tickets%5B0%5D%5Bquantity%5D=1`;
  type Dates = { data?: { id?: string; attributes?: { date?: string; "availability-status"?: string; "num-start-times"?: number; "price-range"?: { amount: string }[] } }[] };
  const dates = await peekGet<Dates>(key, `availability-dates?activity-id=${activityId}&start-date=${day(1)}&end-date=${day(21)}&${q}&use-legacy-api=false`);
  const days = dates?.data || [];
  const amounts = days.flatMap((d) => (d.attributes?.["price-range"] || []).map((p) => Number(p.amount))).filter((n) => Number.isFinite(n) && n > 0);
  const range: PeekLive | null = amounts.length ? { price: Math.min(...amounts), duration: null, span: null, hourly: null, hourSlot: false } : null;
  const open = days.find((d) => d.attributes?.["availability-status"] === "available" || Number(d.attributes?.["num-start-times"]) > 0);
  const date = open?.attributes?.date || open?.id;
  if (!rental || !date) return range;
  type Times = { data?: { attributes?: { price?: { amount: string }; duration?: { minutes?: number; name?: string } } }[] };
  const times = await peekGet<Times>(key, `availability-dates/${date}/availability-times?activity_id=${activityId}&tickets%5B0%5D%5Bquantity%5D=1&tickets%5B0%5D%5Bticket_id%5D=${ticketId}`);
  const slots = (times?.data || [])
    .map((t) => ({ minutes: Number(t.attributes?.duration?.minutes), price: Number(t.attributes?.price?.amount) }))
    .filter((s) => Number.isFinite(s.minutes) && s.minutes > 0 && Number.isFinite(s.price) && s.price > 0);
  if (!slots.length) return range;
  const shortest = slots.reduce((a, b) => (b.minutes < a.minutes || (b.minutes === a.minutes && b.price < a.price) ? b : a));
  const minutes = slots.map((s) => s.minutes);
  const hourly = shortest.minutes >= 60 && shortest.minutes % 60 === 0 ? Math.round((shortest.price / (shortest.minutes / 60)) * 100) / 100 : null;
  return { price: shortest.price, duration: peekMinutes(shortest.minutes, null), span: peekMinutes(Math.min(...minutes), Math.max(...minutes)), hourly, hourSlot: slots.some((s) => s.minutes === 60) };
}

/** "Paddle board rentals · from $40/hr" / "Lessons · $124 per person": the price the operator typed on a widget tile, a last resort. */
export function peekTilePrice(title: string): { price: number; unit: string | null } | null {
  const m = title.match(/\$\s?(\d{1,5}(?:\.\d{1,2})?)\s*(?:(\/|per)\s*(hr|hour|person|guest|adult|day|night|boat|group|rental|each))?/i);
  if (!m) return null;
  const price = Number(m[1]);
  if (!Number.isFinite(price) || price <= 0) return null;
  const what = (m[3] || "").toLowerCase();
  const unit = !what ? null : /^h/.test(what) ? "/hr" : /person|guest|adult|each/.test(what) ? "each" : "/" + what;
  return { price, unit };
}

/**
 * A Peek program is one of three shapes: a single activity with tickets; a multi-activity program whose tiles point at
 * "p_xxxx--<activity id>" leaf programs; or a hub whose tiles point at plain child program ids ("p_wgp8xd"), each of
 * which is itself one of the three. Hubs are followed by id, two levels deep, at most PEEK_MAX_PAGES requests per operator.
 */
const PEEK_MAX_PAGES = 20;
/** availability calls per operator: a rental ticket costs two, a date-priced ticket one. */
const PEEK_MAX_LIVE = 14;

export async function readPeek(key: string, code: string): Promise<WidgetResult | null> {
  const root = await getPeek(key, code);
  if (!root?.included) return null;
  const offerings: Offering[] = [];
  const req = new Set<string>(); const pol = new Set<string>(); const inc = new Set<string>();
  const seenActivity = new Set<string>();
  const seenProgram = new Set<string>([code]);
  /** Tile title and image per activity, from whichever program listed it ("Kayak rentals · from $45/hr"). */
  const tiles = new Map<string, { title: string; image: string | null }>();
  let pages = 1;
  let live = 0;
  const ids = (rel: { data: unknown } | undefined) => (Array.isArray(rel?.data) ? (rel!.data as { id: string }[]).map((x) => x.id) : []);

  const harvest = async (doc: JsonApiDoc, onlyActivity: string | null) => {
    const inc0 = doc.included || [];
    const tickets = new Map(inc0.filter((x) => x.type === "ticket").map((x) => [x.id, x.attributes]));
    const questions = inc0.filter((x) => x.type === "question").map((x) => String(x.attributes["question-text"] || ""));
    const pcaImages = inc0.filter((x) => x.type === "program-configuration-activity").map((x) => String(x.attributes.image || "")).filter(Boolean);
    for (const act of inc0.filter((x) => x.type === "activity")) {
      const a = act.attributes;
      const ticketIds = ids(act.relationships?.tickets);
      if (onlyActivity ? act.id !== onlyActivity : ticketIds.length === 0) continue;
      if (seenActivity.has(act.id)) continue;
      const name = plain(a.name);
      if (!name || PEEK_RETAIL.test(name)) continue;
      seenActivity.add(act.id);
      const tile = tiles.get(act.id) || null;
      const tilePrice = tile ? peekTilePrice(tile.title) : null;
      const mine = ticketIds.flatMap((id) => (tickets.get(id) ? [{ ...tickets.get(id)!, id } as Record<string, unknown> & { id: string }] : []));
      const prices = mine.map((t) => Number(t["source-price-gross"])).filter((n) => Number.isFinite(n) && n > 0);
      const fromPrice = Number(a["from-price"]);
      const price = prices.length ? Math.min(...prices) : Number.isFinite(fromPrice) && fromPrice > 0 ? fromPrice : null;
      const ticketNames = mine.map((t) => plain(t.name)).filter(Boolean);
      const rental = a.mode === "rental" || mine.some((t) => t.category === "EQUIPMENT");
      const perPersonTicket = ticketNames.some((n) => /adult|child|person|guest|rider|senior|youth|kid/i.test(n));
      const unit = rental && !perPersonTicket ? "/" + (/(boat|pontoon|tritoon)/i.test(name + " " + ticketNames.join(" ")) ? "boat" : /(jet ?ski|waverunner|sea-?doo)/i.test(name + " " + ticketNames.join(" ")) ? "jet ski" : /kayak|paddle|sup\b/i.test(name) ? "each" : "rental") : unitOf(ticketNames.join(" "), name);
      const durationText = peekMinutes(a["duration-min-minutes"], a["duration-max-minutes"]);
      const noImg = (t: unknown) => (typeof t === "string" ? t.replace(/!\[[^\]]*\]\([^)]*\)/g, " ") : t);
      const desc = plain(noImg(a["description-short"])) || plain(noImg(a.description)).slice(0, 700).replace(/\s+\S*$/, "");
      const image = typeof a.image === "string" ? a.image : tile?.image || null;
      const priced = mine.filter((t) => Number.isFinite(Number(t["source-price-gross"])) && Number(t["source-price-gross"]) > 0);
      // Tickets with a blank catalog price (rentals by the hour, date-priced seats) get their price from the availability feed, one ticket at a time.
      const liveByTicket = new Map<string, PeekLive>();
      if (!priced.length && price == null) {
        const order = mine.slice().sort((x, y) => (x.id === a["display-price-ticket-id"] ? -1 : y.id === a["display-price-ticket-id"] ? 1 : 0));
        for (const t of order) {
          if (live + (rental ? 2 : 1) > PEEK_MAX_LIVE) break;
          live += rental ? 2 : 1;
          const got = await peekLivePrice(key, act.id, t.id, rental);
          if (got) liveByTicket.set(t.id, got);
        }
      }
      const unitFor = (label: string) => {
        const text = label + " " + name;
        const count = label.match(/\b(\d+)\s*-?\s*(people|persons?|guests?|adults?|riders?|pax|players?|passengers?)\b/i);
        if (/\b(\d+\s*-?\s*person)\s+(boat|pontoon|tritoon|tiki|yacht|vessel|kayak|cart|kart)\b/i.test(label)) return "/" + label.match(/\b\d+\s*-?\s*person\s+(boat|pontoon|tritoon|tiki|yacht|vessel|kayak|cart|kart)\b/i)![1].toLowerCase().replace(/pontoon|tritoon|tiki|yacht|vessel/, "boat");
        if (/\beach\b|per person/i.test(label)) return "each";
        if ((count && Number(count[1]) > 1) || /\b(group|party|private|charter|whole boat|entire)\b/i.test(label)) return "/group";
        if (/\b(adult|child|children|person|guest|rider|senior|youth|kid|student|infant|toddler)\b/i.test(label)) return "each";
        if (/(boat|pontoon|tritoon|tiki|yacht|vessel)/i.test(text) && rental) return "/boat";
        if (/(jet ?ski|waverunner|sea-?doo)/i.test(text) && rental) return "/jet ski";
        return unit === "/rental" ? "each" : unit;
      };
      const base = {
        name,
        duration: durationText,
        url: "https://book.peek.com/s/" + key + "/" + code,
        desc: desc || null,
        photo: image,
        photos: [...new Set([image, ...pcaImages].filter((x): x is string => !!x))].slice(0, 6),
      };
      // One row per ticket type that has its own price (catalog or live); a lone row otherwise, never an unlabelled duplicate.
      const rows = mine
        .map((t) => {
          const catalog = Number(t["source-price-gross"]);
          const l = liveByTicket.get(t.id);
          // "$40/hr" only when the operator sells one-hour blocks or says /hr on the tile; a two-hour minimum is quoted as its block ("$63 · 2 hours").
          const perHour = l?.hourly != null && (l.hourSlot || tilePrice?.unit === "/hr");
          if (Number.isFinite(catalog) && catalog > 0) return { label: plain(t.name), price: catalog, unit: null, duration: null };
          return { label: plain(t.name), price: perHour ? l!.hourly : l?.price ?? null, unit: perHour ? "/hr" : null, duration: perHour ? l!.span : l?.duration ?? null };
        })
        .filter((r) => r.price != null);
      if (rows.length > 1) {
        for (const r of rows) {
          const dup = offerings.some((o) => o.name === name);
          offerings.push({ ...base, detail: r.label === name ? r.duration || durationText : r.label, duration: r.duration || durationText, price: r.price, unit: r.unit || unitFor(r.label), desc: dup ? null : base.desc, photo: dup ? null : base.photo, photos: dup ? [] : base.photos });
        }
      } else {
        const r = rows[0] || null;
        const label = r?.label || ticketNames[0] || "";
        const finalPrice = r?.price ?? price ?? tilePrice?.price ?? null;
        const finalUnit = r?.unit || (r?.price == null && price == null && tilePrice?.unit) || unitFor(label);
        offerings.push({ ...base, detail: r?.duration || durationText || (label && label !== name ? label : null), duration: r?.duration || durationText, price: finalPrice, unit: finalUnit });
      }
      for (const t of mine) {
        const d = plain(t.description);
        if (d && REQ_RE.test(d) && d.length < 200) req.add(/[.!?]$/.test(d) ? d : d + ".");
      }
      const cancel = plain(a["cancellation-policy"]);
      if (cancel) pol.add(cancel.slice(0, 260));
      const hours = Number(a["cancellation-hours"]);
      if (!cancel && Number.isFinite(hours) && hours > 0) pol.add("Cancel up to " + (hours >= 48 ? hours / 24 + " days" : hours + " hours") + " before the start time through the booking system.");
      const mined = mineSentences(plain(a.description));
      mined.requirements.forEach((x) => req.add(x));
      mined.policies.forEach((x) => pol.add(x));
      mined.includes.forEach((x) => inc.add(x));
    }
    for (const q of questions) {
      const mined = mineSentences(q);
      mined.requirements.filter((x) => x.length <= 180).forEach((x) => req.add(x));
      mined.policies.filter((x) => x.length <= 180).forEach((x) => pol.add(x));
    }
  };

  /** Harvest a program, then follow its tiles: leaf programs "p_xxxx--<activity id>" carry that activity's tickets; plain ids are child hubs. */
  const visit = async (doc: JsonApiDoc, depth: number) => {
    const tileRows = (doc.included || [])
      .filter((x) => x.type === "program-configuration-activity")
      .sort((x, y) => Number(x.attributes.order ?? 0) - Number(y.attributes.order ?? 0));
    for (const x of tileRows) {
      const activity = (x.relationships?.activity?.data as { id: string } | null | undefined)?.id;
      const title = plain(x.attributes.title);
      if (activity && title && !tiles.has(activity)) tiles.set(activity, { title, image: typeof x.attributes.image === "string" ? x.attributes.image : null });
    }
    await harvest(doc, null);
    for (const x of tileRows) {
      const rel = (x.relationships?.["program-configuration"]?.data as { id: string } | null | undefined)?.id;
      if (!rel || seenProgram.has(rel) || pages >= PEEK_MAX_PAGES) continue;
      const leaf = rel.match(/^([A-Za-z0-9_]+)--([a-f0-9-]{36})$/i);
      if (leaf) {
        if (seenActivity.has(leaf[2])) continue;
        seenProgram.add(rel);
        pages += 1;
        const sub = await getPeek(key, rel);
        if (sub) await harvest(sub, leaf[2]);
      } else if (depth < 2 && /^[A-Za-z0-9_]+$/.test(rel)) {
        seenProgram.add(rel);
        pages += 1;
        const child = await getPeek(key, rel);
        if (child) await visit(child, depth + 1);
      }
    }
  };
  await visit(root, 0);
  if (!offerings.length) return null;
  // Peek's partner record states the review average and count its checkout shows, unless the operator hid reviews.
  const partner = (root.included || []).find((x) => x.type === "partner")?.attributes || {};
  const avg = Number(partner["reviews-avg-rating"]);
  const count = Number(partner["reviews-count"]);
  const aggregate = !partner["disable-show-reviews"] && avg >= 1 && avg <= 5 && count >= 1 ? { rating: Math.round(avg * 10) / 10, count: Math.round(count) } : null;
  return { vendor: "peek", offerings, company: { aggregate }, requirements: [...req].slice(0, 10), policies: [...pol].slice(0, 10), includes: [...inc].slice(0, 10), pages };
}

/* ---------- store ---------- */

type OpRow = { id: string; domain: string; website: string | null; booking_url: string };

export function storeWidget(op: OpRow, w: WidgetResult): { offerings: number; facts: number } {
  const now = nowIso();
  db.prepare("DELETE FROM offerings WHERE operator_id = ? AND confidence IN ('widget', 'site')").run(op.id);
  db.prepare("DELETE FROM facts WHERE operator_id = ? AND confidence = 'widget'").run(op.id);
  db.prepare("DELETE FROM facts WHERE operator_id = ? AND confidence = 'site' AND fact_key IN ('service', 'service_desc', 'service_photo')").run(op.id);
  db.prepare("DELETE FROM sources WHERE operator_id = ? AND extractor = 'widgets'").run(op.id);
  const insOff = db.prepare(
    `INSERT INTO offerings (id, operator_id, name, detail, duration, price_cents, price_unit, currency, source_url, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'widget')`,
  );
  const currency = w.company.currency || "USD";
  const insFact = db.prepare("INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?, ?, ?, ?, ?, 'widget')");
  let facts = 0;
  const fact = (k: string, v: string | null | undefined, url = op.booking_url) => {
    if (!v) return;
    insFact.run(randomUUID(), op.id, k, v, url);
    facts += 1;
  };
  const seenPhotos = new Set<string>();
  for (const o of w.offerings) {
    insOff.run(randomUUID(), op.id, o.name.slice(0, 80), o.detail?.slice(0, 120) || null, o.duration, o.price == null ? null : Math.round(o.price * 100), o.unit, currency, o.url);
    fact("service", o.name.slice(0, 80), o.url);
    if (o.desc) fact("service_desc", JSON.stringify({ name: o.name.slice(0, 80), desc: o.desc }), o.url);
    if (o.photo) fact("service_photo", JSON.stringify({ name: o.name.slice(0, 80), url: o.photo }), o.url);
    for (const p of o.photos) if (!seenPhotos.has(p) && seenPhotos.size < 10) { seenPhotos.add(p); fact("photo", p, o.url); }
  }
  // Widget photos only become the cover when the site crawl found none.
  const hasCover = db.prepare("SELECT 1 FROM facts WHERE operator_id = ? AND fact_key = 'cover' LIMIT 1").get(op.id);
  if (!hasCover) fact("cover", w.company.cover || [...seenPhotos][0] || null);
  for (const r of w.requirements) fact("requirement", r);
  for (const p of w.policies) fact("policy", p);
  for (const i of w.includes) fact("includes", i);
  fact("cancellation", w.company.cancellation);
  fact("checkin", w.company.checkin);
  fact("waiver_url", w.company.waiverUrl);
  fact("faq", w.company.faq);
  if (w.company.videoEmbed && !db.prepare("SELECT 1 FROM facts WHERE operator_id = ? AND fact_key = 'video_embed' LIMIT 1").get(op.id)) fact("video_embed", w.company.videoEmbed);
  fact("booking_vendor", w.vendor);
  if (w.company.aggregate) {
    // Same rule as the site's own AggregateRating: only fills a listing that discovery left without a rating.
    fact("aggregate_rating", JSON.stringify({ ...w.company.aggregate, source: w.vendor, sourceUrl: op.booking_url }));
    db.prepare("UPDATE operators SET rating = ?, review_count = ?, updated_at = ? WHERE id = ? AND rating IS NULL AND review_count IS NULL").run(w.company.aggregate.rating, w.company.aggregate.count, now, op.id);
  }
  db.prepare(
    `UPDATE operators SET phone = COALESCE(phone, ?), email = COALESCE(email, ?), street = COALESCE(street, ?), city = COALESCE(city, ?),
       region = COALESCE(region, ?), postal = COALESCE(postal, ?), calendar_vendor = COALESCE(calendar_vendor, ?), updated_at = ? WHERE id = ?`,
  ).run(w.company.phone ? normalizePhone(w.company.phone) : null, w.company.email || null, w.company.street || null, w.company.city || null, w.company.region || null, w.company.postal || null, w.vendor, now, op.id);
  db.prepare(
    "INSERT INTO sources (id, operator_id, url, fetched_at, http_status, extractor, robots_allowed, note) VALUES (?, ?, ?, ?, 200, 'widgets', 1, ?)",
  ).run(randomUUID(), op.id, op.booking_url, now, `${w.vendor}: ${w.offerings.length} items with prices, descriptions and photos from the operator's booking widget.`);
  return { offerings: w.offerings.length, facts };
}

/** Which reader a booking link belongs to. Each vendor lives in its own module under ./vendors, one reader per system. */
async function readWidget(bookingUrl: string): Promise<WidgetResult | null> {
  const fh = fareharborShortname(bookingUrl);
  if (fh) return readFareharbor(fh);
  const xs = xolaSeller(bookingUrl);
  if (xs) return readXola(xs);
  const pk = peekRef(bookingUrl);
  if (pk) return readPeek(pk.key, pk.code);
  const ac = acuityRef(bookingUrl);
  if (ac) return readAcuity(ac);
  const bu = burbleRef(bookingUrl);
  if (bu) return readBurble(bu);
  const sq = squareRef(bookingUrl);
  if (sq) return readSquare(sq);
  const cf = checkfrontRef(bookingUrl);
  if (cf) return readCheckfront(cf);
  const rs = resovaRef(bookingUrl);
  if (rs) return readResova(rs);
  const vp = vallyproRef(bookingUrl);
  if (vp) return readVallypro(vp);
  const bk = bookeoRef(bookingUrl);
  if (bk) return readBookeo(bk);
  const rz = rezdyRef(bookingUrl);
  // Rezdy storefronts sit behind a Cloudflare block for plain clients, so the page is rendered in the worker's headless
  // Chromium. A laptop never launches a browser for a crawl (backend/AGENTS.md), so there the Rezdy read is skipped.
  if (rz) return isLaptop() ? null : readRezdy(rz, { fetchHtml: async (u) => { const r = await renderPage(u); return r && r.status === 200 ? r.html : null; } });
  return null;
}

/** The URL shapes readWidget() understands; pendingWidgets() queues only operators whose booking link matches one. */
export const WIDGET_URL_LIKE = ["%fareharbor.com/%", "%xola.%", "%peek.com/s/%", "%.as.me%", "%acuityscheduling.com/schedule%", "%squarespacescheduling.com/schedule%", "%burblesoft.com%", "%squareup.com/appointments%", "%square.site%", "%.checkfront.com%", "%.checkfront.site%", "%.resova.%", "%vallypro.com/p/%", "%.rezdy.com/%", "%bookeo.com/%"];

export async function widgetForOperator(op: OpRow): Promise<{ vendor: string; offerings: number; facts: number } | null> {
  const w = await readWidget(op.booking_url);
  if (!w || !w.offerings.length) return null;
  const n = storeWidget(op, w);
  return { vendor: w.vendor, ...n };
}

export function pendingWidgets(limit: number, redo = false): OpRow[] {
  const cond = redo ? "" : "AND NOT EXISTS (SELECT 1 FROM sources s WHERE s.operator_id = o.id AND s.extractor = 'widgets')";
  return db
    .prepare(
      `SELECT o.id, o.domain, o.website, f.fact_value AS booking_url FROM operators o
       JOIN facts f ON f.operator_id = o.id AND f.fact_key = 'booking_url'
       WHERE o.origin != 'demo' AND (${WIDGET_URL_LIKE.map((l) => `f.fact_value LIKE '${l}'`).join(" OR ")}) ${cond}
       GROUP BY o.id
       ORDER BY (o.metro_id IS NULL), o.review_count DESC NULLS LAST, o.name ASC
       LIMIT ?`,
    )
    .all(limit) as OpRow[];
}

export async function widgetsPending(limit: number, concurrency = 6, redo = false): Promise<{ sites: number; ok: number; offerings: number; facts: number }> {
  const queue = pendingWidgets(limit, redo);
  const out = { sites: 0, ok: 0, offerings: 0, facts: 0 };
  let i = 0;
  const worker = async () => {
    while (i < queue.length) {
      const op = queue[i++];
      try {
        // FareHarbor prices are read one departure per item, four paced calls deep; twenty items take about two minutes.
        const r = await withDeadline(widgetForOperator(op), 300000, op.domain);
        out.sites += 1;
        if (r) {
          out.ok += 1;
          out.offerings += r.offerings;
          out.facts += r.facts;
        } else {
          db.prepare("INSERT INTO sources (id, operator_id, url, fetched_at, http_status, extractor, robots_allowed, note) VALUES (?, ?, ?, ?, 0, 'widgets', 1, ?)").run(randomUUID(), op.id, op.booking_url, nowIso(), "widget returned no listed items");
        }
      } catch (e) {
        out.sites += 1;
        console.error(op.domain + ": " + (e as Error).message.slice(0, 120));
      }
      if (out.sites % 100 === 0) console.log(`${out.sites}/${queue.length} widgets, ${out.ok} ok, ${out.offerings} items`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(spawnWorkers(concurrency), queue.length) }, worker));
  return out;
}
