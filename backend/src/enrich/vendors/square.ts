import { mineSentences, plain } from "../widgets.ts";
import type { Company, Offering, WidgetResult } from "../widgets.ts";
import { safeFetch } from "../../lib/safeFetch.ts";

/**
 * Square Appointments and Square Online, read from what the public booking pages already ship, no key and no browser.
 *
 * Three page shapes carry a service list:
 *
 *  1. The booking flow. squareup.com/appointments/book/<widget>/<location>/..., app.squareup.com/... and
 *     book.squareup.com/appointments/<widget>/location/<location> all land on the same React page, and its server
 *     response embeds the whole widget state in <meta name="widget" content="{...}">: every bookable service with
 *     variations, price in cents, duration in seconds, description, images, categories, staff, the business
 *     (name, phone, email, currency, cancellation policy) and the location (street, city, state, zip, hours).
 *     book.squareup.com's robots.txt disallows the .../services/ path, so only the location root is fetched.
 *
 *  2. The older "minisite", square.site/book/<location>/<slug>: server-rendered HTML cards (name, description,
 *     price line, duration) whose "Book now" links name the widget id, so the reader hops to shape 1 and only
 *     parses the cards when that hop fails.
 *
 *  3. A Square Online site, <name>.square.site, whose bootstrap state names the site owner (user id) and the
 *     catalog site id. The appointments page then reads
 *       /app/square-sync/published/users/<user>/site/<site>/appointments/services       (Catalog API ITEM objects)
 *       /app/square-sync/published/users/<user>/site/<site>/appointments/business-booking-profile
 *     Sites whose featuresets do not include "appointments" sell products, not services, and read as null.
 *
 * square.link/u/... and checkout.square.site/merchant/... are single payment links (often a deposit or a balance
 * with a buyer-entered amount), not a menu, so squareRef() ignores them.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type SquareRef =
  | { kind: "widget"; widgetId: string; locationId: string }
  | { kind: "minisite"; locationId: string; slug: string }
  | { kind: "site"; host: string };

const LOC = "[A-Z0-9]{10,16}"; // location tokens: LN0J87F6T53R6
const WIDGET = "(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|[a-z0-9]{10,20})"; // rivga4vgg85qfq or a uuid

/** A booking URL, or any HTML that links to one. Widget links win over minisites, minisites over a whole store. */
export function squareRef(bookingUrlOrHtml: string): SquareRef | null {
  const s = bookingUrlOrHtml || "";
  let m = s.match(new RegExp("book\\.squareup\\.com/appointments/(" + WIDGET + ")/location/(" + LOC + ")", "i"));
  if (m) return { kind: "widget", widgetId: m[1].toLowerCase(), locationId: m[2].toUpperCase() };
  m = s.match(new RegExp("(?:app\\.|www\\.)?squareup\\.com/appointments/book/(" + WIDGET + ")/(" + LOC + ")(?![A-Za-z0-9])", "i"));
  if (m && !/^(profile|classes)$/i.test(m[1])) return { kind: "widget", widgetId: m[1].toLowerCase(), locationId: m[2].toUpperCase() };
  m = s.match(new RegExp("(?:square\\.site|squareup\\.com)/(?:appointments/)?book/(" + LOC + ")/([a-z0-9][a-z0-9-]*)", "i"));
  if (m && !/^(profile|classes)$/i.test(m[1])) return { kind: "minisite", locationId: m[1].toUpperCase(), slug: m[2].toLowerCase() };
  m = s.match(/(?:^|[\/."'\s])([a-z0-9][a-z0-9-]{1,80})\.square\.site(?![a-z0-9-])/i);
  if (m && !/^(www|checkout|api|app|cdn|static)$/i.test(m[1])) return { kind: "site", host: m[1].toLowerCase() + ".square.site" };
  return null;
}

/* ---------- polite fetch: robots.txt per host, crawl-delay, one request at a time ---------- */

type Robots = { disallow: RegExp[]; delayMs: number };
const robotsCache = new Map<string, Promise<Robots>>();
const lastHit = new Map<string, number>();

function robotsFor(host: string): Promise<Robots> {
  let p = robotsCache.get(host);
  if (!p) {
    p = (async () => {
      const out: Robots = { disallow: [], delayMs: 1000 };
      try {
        const res = await safeFetch("https://" + host + "/robots.txt", { headers: { "User-Agent": UA }, timeoutMs: 15000, maxBytes: 5_000_000 });
        if (!res.ok) return out;
        const text = await res.text();
        let mine = false;
        for (const raw of text.split(/\r?\n/)) {
          const line = raw.replace(/#.*/, "").trim();
          const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
          if (!m) continue;
          const key = m[1].toLowerCase(), val = m[2].trim();
          if (key === "user-agent") mine = val === "*";
          else if (mine && key === "disallow" && val) {
            const re = "^" + val.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (val.endsWith("$") ? "" : "");
            out.disallow.push(new RegExp(re.replace(/\\\$$/, "$")));
          } else if (mine && key === "crawl-delay" && Number(val) > 0) out.delayMs = Math.min(10000, Number(val) * 1000);
        }
      } catch { /* no robots, default politeness */ }
      return out;
    })();
    robotsCache.set(host, p);
  }
  return p;
}

async function politeGet(url: string, accept = "text/html"): Promise<{ status: number; url: string; text: string } | null> {
  const u = new URL(url);
  const robots = await robotsFor(u.host);
  const path = u.pathname + u.search;
  if (robots.disallow.some((re) => re.test(path) || re.test(path + "/"))) return null;
  const wait = robots.delayMs - (Date.now() - (lastHit.get(u.host) || 0));
  if (wait > 0) await pause(wait);
  lastHit.set(u.host, Date.now());
  try {
    const res = await safeFetch(url, { headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "en-US,en;q=0.9" }, timeoutMs: 15000, maxBytes: 5_000_000 });
    const text = await res.text();
    lastHit.set(new URL(res.url).host, Date.now());
    return { status: res.status, url: res.url, text };
  } catch {
    return null;
  }
}

/* ---------- shared shaping ---------- */

function secondsToDuration(sec: number | null | undefined): string | null {
  if (!sec || sec <= 0) return null;
  const min = Math.round(sec / 60);
  if (min < 60) return min + " min";
  const h = min / 60;
  const txt = Number.isInteger(h) ? String(h) : h.toFixed(1).replace(/\.0$/, "");
  return txt + (h === 1 ? " hour" : " hours");
}

/** "(1-4 people)", "Group of 2", "35ft Vessel" sell the whole thing; "Adult", "per person" sell a seat. */
function unitFor(label: string, name: string): string {
  const text = label + " " + name;
  const headcount = /\b(\d+\s*(?:-|to)\s*\d+|up to \d+|\d+)\s*(?:people|persons?|guests?|passengers?|riders?|players?|pax|ppl|jumpers?)\b/i.test(text);
  const whole = /\b(group|party|private|charter|whole|entire|vessel|boat|pontoon|yacht)\b/i.test(text);
  if (!headcount && !whole) return "each";
  return /\b(boat|vessel|pontoon|yacht|charter)\b/i.test(text) ? "/boat" : "/group";
}

/** Service names carry operator notes ("***Arrive 10 minutes early") and prices ("($600.00)"); neither is the name. */
function cleanName(raw: string): string {
  return plain(raw.replace(/\s*\*{2,}[\s\S]*$/, "")).replace(/\s*\(\$?\s?[\d,]+(?:\.\d{2})?\)\s*$/, "").trim();
}

/**
 * Square charges what the seller set as the service price, and many operators set that to a deposit and write the
 * real price into the name ("1/2 Day Charter ($600.00)") or the price note ("$100 Deposit Required"). A guest sees
 * the larger figure as the price, so the listing does too, with the deposit as the detail.
 */
function depositAware(rawName: string, priceNote: string | null, charged: number | null): { price: number | null; detail: string | null } {
  // "($600.00)" and "(800.00)" both mean the price; a bare number is only read inside the parentheses.
  const named = [...moneyIn(rawName), ...[...rawName.matchAll(/\((\d{2,5}(?:,\d{3})?\.\d{2})\)/g)].map((m) => Number(m[1].replace(/,/g, "")))];
  const isDeposit = /deposit/i.test((priceNote || "") + " " + rawName);
  if (isDeposit && named.length && charged != null && Math.max(...named) > charged) return { price: Math.max(...named), detail: "$" + charged + " deposit at booking" };
  if (isDeposit && charged != null) return { price: charged, detail: "Deposit at booking" };
  return { price: charged, detail: priceNote && !/^\$?[\d.,]+$/.test(priceNote) ? priceNote : null };
}

function moneyIn(s: string): number[] {
  return [...s.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d{1,6})(?:\.(\d{2}))?(?![\d,])/g)].map((m) => Number(m[1].replace(/,/g, "") + (m[2] ? "." + m[2] : "")));
}

const RETAIL = /\bgift ?card|t-?shirt|hoodie|\bhat\b|sticker|merch\b|\bmug\b|towel|membership|tip\b|gratuity|balance due|remaining balance/i;

function dedupe(list: string[]): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const s of list) { const k = s.toLowerCase(); if (s && !seen.has(k)) { seen.add(k); out.push(s); } }
  return out;
}

/* ---------- 1. booking flow widget ---------- */

type WidgetVariation = { id: string; name: string | null; price_type: string | null; price_description: string | null; price_cents: number | null; service_time: number | null; is_visible_in_default_booking?: boolean; image_tokens?: string[] };
type WidgetService = { id: string; name: string; description: string | null; description_html?: string | null; price_description: string | null; price_cents: number | null; price_type: string | null; time: number | null; image_tokens?: string[]; category_token?: string | null; variations?: WidgetVariation[] };
type WidgetState = {
  id: string;
  business?: { name?: string; phone?: string | null; email?: string | null; currency_code?: string | null; cancellation_policy?: string | null; display_cancellation_policy?: boolean; profile_image?: { url?: string } | null; booking_site_url?: string | null };
  active_business_locations?: { id: string; address1?: string | null; city?: string | null; state?: string | null; zipcode?: string | null; website_url?: string | null }[];
  services?: WidgetService[];
  categories?: { id: string; name: string }[];
  images?: Record<string, string>;
};

function decodeEntities(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");
}

export function parseWidgetState(html: string): WidgetState | null {
  const m = html.match(/<meta\s+name="widget"\s+content="([^"]*)"/);
  if (!m) return null;
  try {
    const j = JSON.parse(decodeEntities(m[1])) as WidgetState;
    return j && Array.isArray(j.services) ? j : null;
  } catch {
    return null;
  }
}

/** Square's price types: fixed, starting_at (from), variable (varies), free, call (call for price). */
function widgetPrice(type: string | null | undefined, cents: number | null | undefined): number | null {
  if (!cents || cents <= 0) return null;
  if (type && !/^(fixed|starting_at|variable)$/i.test(type)) return null;
  return cents / 100;
}

function widgetToResult(w: WidgetState, widgetId: string, locationId: string): WidgetResult | null {
  const services = (w.services || []).filter((s) => s && s.name);
  const images = w.images || {};
  const offerings: Offering[] = [];
  const req: string[] = []; const pol: string[] = []; const inc: string[] = [];
  const link = (serviceId: string) => `https://squareup.com/appointments/book/${widgetId}/${locationId}/start?service_id=${serviceId}`;
  for (const s of services) {
    const name = cleanName(s.name) || plain(s.name);
    if (!name || RETAIL.test(name)) continue;
    const desc = plain(s.description || s.description_html) || null;
    const photos = (s.image_tokens || []).map((t) => images[t]).filter((u): u is string => !!u);
    const vars = (s.variations || []).filter((v) => v.is_visible_in_default_booking !== false);
    const base = { name, url: link(s.id), desc, photo: photos[0] || null, photos: photos.slice(0, 6) };
    const distinct = vars.filter((v) => v.name && !/^regular$/i.test(v.name));
    if (distinct.length > 1) {
      distinct.forEach((v, i) => {
        const label = plain(v.name);
        offerings.push({ ...base, detail: label, duration: secondsToDuration(v.service_time ?? s.time), price: widgetPrice(v.price_type ?? s.price_type, v.price_cents ?? s.price_cents), unit: unitFor(label, name), desc: i ? null : base.desc, photo: i ? null : base.photo, photos: i ? [] : base.photos });
      });
    } else {
      const v = vars[0];
      const duration = secondsToDuration(v?.service_time ?? s.time);
      const priceDesc = plain(s.price_description || v?.price_description) || null;
      const { price, detail } = depositAware(s.name, priceDesc, widgetPrice(v?.price_type ?? s.price_type, v?.price_cents ?? s.price_cents));
      offerings.push({ ...base, detail: detail && detail.toLowerCase() !== name.toLowerCase() ? detail : duration, duration, price, unit: unitFor(priceDesc || "", name) });
    }
    if (desc) {
      const mined = mineSentences(desc);
      req.push(...mined.requirements); pol.push(...mined.policies); inc.push(...mined.includes);
    }
  }
  if (!offerings.length) return null;
  const b = w.business || {};
  const loc = (w.active_business_locations || []).find((l) => l.id === locationId) || (w.active_business_locations || [])[0];
  const cancellation = b.display_cancellation_policy !== false ? plain(b.cancellation_policy) || null : null;
  if (cancellation) pol.unshift(cancellation.slice(0, 260));
  const company: Company = {
    currency: b.currency_code || null,
    phone: b.phone || null,
    email: b.email || null,
    street: loc?.address1 || null,
    city: loc?.city || null,
    region: loc?.state || null,
    postal: loc?.zipcode || null,
    cover: offerings.find((o) => o.photo)?.photo || null,
    cancellation,
  };
  return { vendor: "square", offerings, company, requirements: dedupe(req).slice(0, 8), policies: dedupe(pol).slice(0, 8), includes: dedupe(inc).slice(0, 8), pages: 1 };
}

async function readWidget(widgetId: string, locationId: string): Promise<WidgetResult | null> {
  const page = await politeGet(`https://book.squareup.com/appointments/${widgetId}/location/${locationId}`);
  if (!page || page.status !== 200) return null;
  const state = parseWidgetState(page.text);
  return state ? widgetToResult(state, widgetId, locationId) : null;
}

/* ---------- 2. minisite ---------- */

/** The cards on square.site/book/<loc>/<slug>. Used only when the page names no widget id. */
export function parseMinisite(html: string, pageUrl: string): WidgetResult | null {
  const offerings: Offering[] = [];
  const req: string[] = []; const pol: string[] = []; const inc: string[] = [];
  const cardRe = /<a class="card card--interactive service[^"]*" href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = cardRe.exec(html))) {
    const href = decodeEntities(m[1]); const card = m[2];
    const rawName = plain((card.match(/<h5[^>]*>([\s\S]*?)<\/h5>/) || [])[1] || "");
    if (!rawName) continue;
    const name = cleanName(rawName);
    if (!name || RETAIL.test(name)) continue;
    const desc = plain((card.match(/<p[^>]*data-see-more-less=[\s\S]*?>([\s\S]*?)<\/p>/) || [])[1] || "") || null;
    const priceLine = plain((card.match(/<p class="color--full-black[^"]*">([\s\S]*?)<\/p>/) || [])[1] || "");
    const priceDesc = plain((card.match(/<p class="color--full-black[^"]*">\s*<span>([\s\S]*?)<\/span>/) || [])[1] || "");
    const charged = moneyIn(priceLine);
    const durM = priceLine.match(/\b(\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?)\b/i);
    const duration = durM ? durM[1] + " " + durM[2].toLowerCase().replace(/^hrs?$/, "hours").replace(/^mins?$/, "min") : null;
    const { price, detail } = depositAware(rawName, priceDesc || null, charged.length ? charged[charged.length - 1] : moneyIn(rawName)[0] ?? null);
    offerings.push({ name, detail: detail || duration, duration, price, unit: unitFor(priceDesc, name), url: href, desc, photo: null, photos: [] });
    if (desc) { const mined = mineSentences(desc); req.push(...mined.requirements); pol.push(...mined.policies); inc.push(...mined.includes); }
  }
  if (!offerings.length) return null;
  const tel = (html.match(/href="tel:([^"]+)"/) || [])[1] || null;
  const mail = (html.match(/href="mailto:([^"?]+)"/) || [])[1] || null;
  const cover = (html.match(/<meta name="twitter:image" content="([^"]+)"/) || [])[1] || null;
  const company: Company = { phone: tel, email: mail, cover };
  void pageUrl;
  return { vendor: "square", offerings, company, requirements: dedupe(req).slice(0, 8), policies: dedupe(pol).slice(0, 8), includes: dedupe(inc).slice(0, 8), pages: 1 };
}

async function readMinisite(locationId: string, slug: string): Promise<WidgetResult | null> {
  const url = `https://square.site/book/${locationId}/${slug}`;
  const page = await politeGet(url);
  if (!page || page.status !== 200) return null;
  const fromState = parseWidgetState(page.text);
  if (fromState) return widgetToResult(fromState, fromState.id, locationId);
  const hop = squareRef(page.text);
  if (hop && hop.kind === "widget") {
    const viaWidget = await readWidget(hop.widgetId, hop.locationId);
    if (viaWidget) return { ...viaWidget, pages: 2 };
  }
  return parseMinisite(page.text, url);
}

/* ---------- 3. Square Online site ---------- */

type CatalogItem = {
  type: string; id: string; is_deleted?: boolean;
  item_data?: {
    name?: string; description?: string; description_plaintext?: string; description_html?: string; product_type?: string; is_archived?: boolean;
    images?: { url?: string }[]; categories?: { id: string }[];
    variations?: { id: string; is_deleted?: boolean; item_variation_data?: { name?: string; pricing_type?: string; price_money?: { amount?: number; currency?: string }; service_duration?: number; available_for_booking?: boolean; sellable?: boolean } }[];
  };
};
type Bootstrap = { siteData?: { site?: { properties?: { classicSiteID?: string | number; catalogSiteId?: string | number; squareMerchantId?: string } }; user?: { id?: number | string }; snapshot?: { properties?: { featuresets?: string[] } } }; storeInfo?: { currency?: string } };

export function parseBootstrap(html: string): Bootstrap | null {
  const m = html.match(/window\.__BOOTSTRAP_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]) as Bootstrap; } catch { return null; }
}

async function readSite(host: string): Promise<WidgetResult | null> {
  const home = await politeGet(`https://${host}/`);
  if (!home || home.status !== 200) return null;
  const boot = parseBootstrap(home.text);
  const props = boot?.siteData?.site?.properties;
  const userId = boot?.siteData?.user?.id ?? (home.text.match(/user_id:\s*'(\d+)'/) || [])[1];
  if (!props || !userId) return null;
  const featuresets = boot?.siteData?.snapshot?.properties?.featuresets || [];
  if (!featuresets.includes("appointments")) return null; // a store of products, not a service menu
  const siteIds = dedupe([props.catalogSiteId, props.classicSiteID].filter(Boolean).map(String));
  let items: CatalogItem[] = [];
  let usedSite: string | null = null;
  for (const sid of siteIds) {
    const res = await politeGet(`https://${host}/app/square-sync/published/users/${userId}/site/${sid}/appointments/services`, "application/json");
    if (!res || res.status !== 200) continue;
    try {
      const j = JSON.parse(res.text) as { items?: CatalogItem[] };
      if (Array.isArray(j.items)) { items = j.items; usedSite = sid; break; }
    } catch { /* try the other id */ }
  }
  if (!usedSite) return null;
  const offerings: Offering[] = [];
  const req: string[] = []; const pol: string[] = []; const inc: string[] = [];
  for (const it of items) {
    const d = it.item_data;
    if (!d || it.is_deleted || d.is_archived || it.type !== "ITEM") continue;
    if (d.product_type && d.product_type !== "APPOINTMENTS_SERVICE") continue;
    const name = plain(d.name);
    if (!name || RETAIL.test(name)) continue;
    const vars = (d.variations || []).filter((v) => !v.is_deleted && v.item_variation_data && v.item_variation_data.available_for_booking !== false);
    if (!vars.length) continue;
    const desc = plain(d.description_plaintext || d.description || d.description_html) || null;
    const photos = (d.images || []).map((i) => i.url).filter((u): u is string => !!u);
    const priceOf = (v: (typeof vars)[number]) => {
      const vd = v.item_variation_data!;
      const amt = vd.price_money?.amount;
      return vd.pricing_type === "FIXED_PRICING" && amt && amt > 0 ? amt / 100 : null;
    };
    const base = { name, url: `https://${host}/s/appointments`, desc, photo: photos[0] || null, photos: photos.slice(0, 6) };
    const distinct = vars.filter((v) => v.item_variation_data!.name && !/^regular$/i.test(v.item_variation_data!.name!));
    if (distinct.length > 1) {
      distinct.forEach((v, i) => {
        const label = plain(v.item_variation_data!.name);
        offerings.push({ ...base, detail: label, duration: secondsToDuration((v.item_variation_data!.service_duration || 0) / 1000), price: priceOf(v), unit: unitFor(label, name), desc: i ? null : base.desc, photo: i ? null : base.photo, photos: i ? [] : base.photos });
      });
    } else {
      const v = vars[0];
      const duration = secondsToDuration((v.item_variation_data!.service_duration || 0) / 1000);
      const { price, detail } = depositAware(d.name || "", null, priceOf(v));
      offerings.push({ ...base, detail: detail || duration, duration, price, unit: unitFor("", name) });
    }
    if (desc) { const mined = mineSentences(desc); req.push(...mined.requirements); pol.push(...mined.policies); inc.push(...mined.includes); }
  }
  if (!offerings.length) return null;
  let cancellation: string | null = null;
  const prof = await politeGet(`https://${host}/app/square-sync/published/users/${userId}/site/${usedSite}/appointments/business-booking-profile`, "application/json");
  if (prof && prof.status === 200) {
    try {
      const j = JSON.parse(prof.text) as { business_booking_profile?: { business_appointment_settings?: { cancellation_policy_text?: string } } };
      cancellation = plain(j.business_booking_profile?.business_appointment_settings?.cancellation_policy_text) || null;
    } catch { /* optional */ }
  }
  if (cancellation) pol.unshift(cancellation.slice(0, 260));
  const company: Company = { currency: boot?.storeInfo?.currency || null, cover: offerings.find((o) => o.photo)?.photo || null, cancellation };
  return { vendor: "square", offerings, company, requirements: dedupe(req).slice(0, 8), policies: dedupe(pol).slice(0, 8), includes: dedupe(inc).slice(0, 8), pages: 2 };
}

/* ---------- entry ---------- */

export async function readSquare(ref: SquareRef): Promise<WidgetResult | null> {
  if (ref.kind === "widget") return readWidget(ref.widgetId, ref.locationId);
  if (ref.kind === "minisite") return readMinisite(ref.locationId, ref.slug);
  return readSite(ref.host);
}
