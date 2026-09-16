import { mineSentences, plain, type Company, type Offering, type WidgetResult } from "../widgets.ts";
import { safeFetch } from "../../lib/safeFetch.ts";

/**
 * Rezdy as a free, exact source.
 *
 * Rezdy's REST API (api.rezdy.com/v1) answers 401 "Missing API Key" to everything, and there is no public JSON
 * feed behind the storefront: no JSON-LD, no XHR product endpoint. What an operator's guests see is the
 * server-rendered storefront at https://<shortname>.rezdy.com, and that HTML carries the whole menu:
 *
 *   /                          every uncategorised product as a card (name, blurb, duration, "From USD $68.00",
 *                              thumbnail) and a link to each catalog (category) page
 *   /catalog/<id>/<slug>       the products in one category, same card markup
 *   /<code>/<slug>             one product: h1, images, long description, duration, product code, location,
 *                              and one <select data-price-type data-price data-price-label> per price option
 *                              (Adult $150, Child $42.45, "60 min (4 ppl max)" $299) with a unit label
 *                              (Guests, Participants, Rentals)
 *   /productsCalendar/<code>, /productsMonthlyCalendar/<code>, /calendarWidget/<code>   calendars for one product
 *
 * The tenant storefronts sit behind Cloudflare with a rule that answers a plain 403 "Sorry, you have been blocked"
 * to anything that is not a browser (curl, Node fetch, even for robots.txt), so this reader takes an optional
 * page fetcher: the pipeline passes its headless-Chromium renderPage on the Render worker and the parser is the
 * same. The default fetcher is a plain fetch with browser headers, which works wherever the rule lets it.
 *
 * Nothing is invented: a product page the storefront will not serve keeps only what its card said.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export type RezdyRef = {
  /** Tenant shortname: the <shortname> in https://<shortname>.rezdy.com. */
  shortname: string;
  /** Product code from a deep link (/757013/vip-parasail-ride, /productsCalendar/403318), or null for a storefront root. */
  productCode: string | null;
  /** Catalog (category) id from /catalog/<id>/<slug>, or null. */
  catalogId: string | null;
  /** https://<shortname>.rezdy.com */
  origin: string;
  /** The path the link pointed at ("/catalog/75184/boats"), read as given when the storefront root gives nothing. */
  path: string;
};

export type RezdyFetch = (url: string) => Promise<string | null>;
export type RezdyOptions = {
  /** Returns the page's HTML after any scripts, or null when it could not be read. Default: plain fetch with browser headers. */
  fetchHtml?: RezdyFetch;
  /** Product pages read per operator, each one request. Default 40. */
  maxProducts?: number;
  /** Pause between requests in ms. Default 400. */
  pauseMs?: number;
};

/** Hosts under rezdy.com that are Rezdy's own, never a tenant. */
const NOT_TENANT = /^(www|api|app|img|static|widget|widgets|book|booking|help|support|developers|developer|marketplace|login|blog|mail|cdn|assets|status|docs|admin|partners?)$/i;
const CF_BLOCK = /Attention Required! \| Cloudflare|Sorry, you have been blocked|cf-error-details|Just a moment\.\.\./i;

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…", deg: "°" };

/** Storefront text is HTML-escaped ("20&#039; Nauticstar", "Pick Up &amp; Drop Off"); plain() handles tags, this handles entities. */
function text(s: string | null | undefined): string {
  return plain(String(s ?? "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  }));
}

function decodeMaybe(s: string): string {
  try {
    return /%[0-9a-f]{2}/i.test(s) ? decodeURIComponent(s) : s;
  } catch {
    return s;
  }
}

function refFromUrl(raw: string): RezdyRef | null {
  const m = decodeMaybe(raw).match(/https?:\/\/([a-z0-9][a-z0-9-]{0,80})\.rezdy\.com(\/[^\s"'<>)]*)?/i);
  if (!m || NOT_TENANT.test(m[1])) return null;
  const shortname = m[1].toLowerCase();
  const path = (m[2] || "/").replace(/[?#].*$/, "");
  const product = path.match(/^\/(?:productsCalendar|productsMonthlyCalendar|calendarWidget|product)\/(\d+)/i) || path.match(/^\/(\d+)(?:\/|$)/);
  const catalog = path.match(/^\/catalog\/(\d+)/i);
  return { shortname, productCode: product ? product[1] : null, catalogId: catalog ? catalog[1] : null, origin: "https://" + shortname + ".rezdy.com", path };
}

/**
 * A booking URL, or a page's HTML, to the storefront it points at. In HTML the tenant that appears most often
 * wins (iframes, booking buttons, pluginJs script tags, plain links); a deep link's product code rides along.
 */
export function rezdyRef(bookingUrlOrHtml: string): RezdyRef | null {
  const s = String(bookingUrlOrHtml || "").trim();
  if (!s) return null;
  if (!/[<>\s]/.test(s) || /^https?:\/\//i.test(s) && !/</.test(s)) return refFromUrl(s);
  const counts = new Map<string, { n: number; ref: RezdyRef }>();
  for (const m of s.matchAll(/https?:\/\/[a-z0-9-]+\.rezdy\.com[^\s"'<>)]*/gi)) {
    const ref = refFromUrl(m[0]);
    if (!ref) continue;
    const cur = counts.get(ref.shortname);
    if (cur) {
      cur.n += 1;
      if (!cur.ref.productCode && ref.productCode) { cur.ref.productCode = ref.productCode; cur.ref.path = ref.path; }
      if (!cur.ref.catalogId && ref.catalogId) { cur.ref.catalogId = ref.catalogId; cur.ref.path = ref.path; }
    } else counts.set(ref.shortname, { n: 1, ref });
  }
  let best: { n: number; ref: RezdyRef } | null = null;
  for (const c of counts.values()) if (!best || c.n > best.n) best = c;
  return best ? best.ref : null;
}

async function defaultFetch(url: string): Promise<string | null> {
  try {
    const res = await safeFetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      timeoutMs: 15000,
      maxBytes: 5_000_000,
    });
    if (res.status !== 200) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** robots.txt for the `*` agent. Unreadable (blocked, missing) counts as allowed, the way crawlers treat 4xx. */
async function disallowed(origin: string, fetchHtml: RezdyFetch): Promise<(path: string) => boolean> {
  const txt = await fetchHtml(origin + "/robots.txt");
  if (!txt || CF_BLOCK.test(txt) || /<html/i.test(txt)) return () => false;
  const rules: string[] = [];
  let applies = false;
  for (const line of txt.split(/\r?\n/)) {
    const l = line.replace(/#.*/, "").trim();
    const ua = l.match(/^user-agent:\s*(.+)$/i);
    if (ua) { applies = ua[1].trim() === "*"; continue; }
    const dis = l.match(/^disallow:\s*(.*)$/i);
    if (dis && applies && dis[1]) rules.push(dis[1].trim());
  }
  return (path) => rules.some((r) => path.startsWith(r));
}

/* ---------- parsing ---------- */

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp("\\b" + name + "=\"([^\"]*)\"", "i"));
  return m ? text(m[1]) : null;
}

/** "210 Minutes (approx.)" -> "3.5 hours"; "2 Hours (approx.)" -> "2 hours"; "90 Minutes" -> "90 min". */
function durationText(s: string | null): string | null {
  const m = (s || "").match(/(\d+(?:\.\d+)?)\s*(minutes?|mins?|hours?|hrs?|days?)/i);
  if (!m) return null;
  const n = Number(m[1]);
  const u = m[2].toLowerCase();
  if (/^min/.test(u)) {
    if (n >= 60 && n % 30 === 0) return (n / 60).toString().replace(/\.5$/, ".5") + (n === 60 ? " hour" : " hours");
    return n + " min";
  }
  if (/^h/.test(u)) return n + (n === 1 ? " hour" : " hours");
  return n + (n === 1 ? " day" : " days");
}

/** img.rezdy.com serves <file>.jpg, <file>_lg.jpg, <file>_med.jpg, <file>_tb.jpg: one photo each, largest kept. */
function photoSet(html: string): string[] {
  const byBase = new Map<string, { url: string; rank: number }>();
  for (const m of html.matchAll(/https:\/\/img\.rezdy\.com\/PRODUCT_IMAGE\/[^"'\s)]+/g)) {
    const url = m[0].replace(/&amp;/g, "&");
    const base = url.replace(/_(lg|med|tb|sm)(\.[a-z0-9]+)$/i, "$2");
    const rank = /_lg\./i.test(url) ? 3 : /_med\./i.test(url) ? 2 : /_(tb|sm)\./i.test(url) ? 0 : 1;
    const cur = byBase.get(base);
    if (!cur || rank > cur.rank) byBase.set(base, { url, rank });
  }
  return [...byBase.values()].map((v) => v.url);
}

type Card = { code: string; url: string; name: string; blurb: string | null; duration: string | null; fromPrice: number | null; currency: string | null; photo: string | null };

/** Product cards on the storefront root and on catalog pages. */
function parseCards(html: string, origin: string): Card[] {
  const out: Card[] = [];
  const seen = new Set<string>();
  // "products-list-item-side" and "-overview" are children of the card; only the card itself starts a part.
  const parts = html.split(/<div class="products-list-item(?:\s[^"]*)?"/).slice(1);
  for (const part of parts) {
    const link = part.match(/href="\/(\d+)\/([^"?#]*)"/);
    if (!link || seen.has(link[1])) continue;
    const name = text((part.match(/<h2[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/) || [])[1] || "");
    if (!name) continue;
    seen.add(link[1]);
    const overview = (part.match(/<div class="products-list-item-overview">([\s\S]*?)<\/div>/) || [])[1] || part;
    const blurb = text((overview.match(/<\/h2>\s*<p[^>]*>([\s\S]*?)<\/p>/) || [])[1] || "");
    const dur = text((part.match(/<strong>\s*Duration:\s*<\/strong>([\s\S]*?)<\/li>/) || [])[1] || "");
    const priceTag = part.match(/<span class="price"[^>]*>/);
    const amount = priceTag ? attr(priceTag[0], "data-original-amount") : null;
    const currency = priceTag ? attr(priceTag[0], "data-currency-base") : null;
    const priceNum = amount ? Number(amount.replace(/[^\d.]/g, "")) : NaN;
    out.push({
      code: link[1],
      url: origin + "/" + link[1] + "/" + link[2],
      name,
      blurb: blurb || null,
      duration: durationText(dur),
      fromPrice: Number.isFinite(priceNum) && priceNum > 0 ? priceNum : null,
      currency: currency || null,
      photo: photoSet(part)[0] || null,
    });
  }
  return out;
}

function catalogLinks(html: string): string[] {
  return [...new Set([...html.matchAll(/href="(\/catalog\/\d+\/[^"?#]*)"/g)].map((m) => m[1]))];
}

type PriceOption = { id: string | null; type: string; label: string; price: number; currency: string | null };
type Product = { name: string; code: string | null; duration: string | null; location: string | null; unitLabel: string | null; desc: string; photos: string[]; options: PriceOption[]; currency: string | null };

/** One product page: name, overview facts, description, photos, and every price option the guest can pick. */
function parseProduct(html: string): Product | null {
  const name = text((html.match(/<div class="product-overview[^"]*">[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/) || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || "");
  if (!name) return null;
  const overview = (html.match(/<div class="product-overview[^"]*">[\s\S]*?<ul class="unstyled">([\s\S]*?)<\/ul>/) || [])[1] || "";
  const li = (label: RegExp) => text((overview.match(new RegExp("<strong>\\s*" + label.source + "\\s*:?\\s*<\\/strong>([\\s\\S]*?)<\\/li>", "i")) || [])[1] || "") || null;
  const desc = text((html.match(/<div class="product-description">([\s\S]*?)<\/div>\s*(?:<!--|<div|<\/div)/) || [])[1] || "");
  const unitLabel = (html.match(/data-unit-label="([^"]*)"/) || [])[1] || null;
  const options: PriceOption[] = [];
  let currency: string | null = null;
  for (const m of html.matchAll(/<select\b[^>]*\bdata-price-type="[^"]*"[^>]*>/g)) {
    const tag = m[0];
    const price = Number(attr(tag, "data-price") || "");
    const label = attr(tag, "data-price-label") || attr(tag, "data-price-type") || "";
    if (!label) continue;
    const cur = (html.slice(Math.max(0, m.index! - 600), m.index).match(/data-currency-base="([A-Z]{3})"/) || [])[1] || null;
    currency = currency || cur;
    options.push({ id: attr(tag, "data-price-id"), type: (attr(tag, "data-price-type") || "").toUpperCase(), label, price: Number.isFinite(price) ? price : 0, currency: cur });
  }
  const mainImage = (html.match(/<div class="product-main-image[\s\S]*?(?=<!-- Description -->|<div class="product-description")/) || [])[0] || "";
  return {
    name,
    code: li(/Product code/) ,
    duration: durationText(li(/Duration/)),
    location: li(/Location/),
    unitLabel: unitLabel ? text(unitLabel) : null,
    desc,
    photos: photoSet(mainImage || html).slice(0, 8),
    options,
    currency,
  };
}

/* ---------- units ---------- */

const PER_PERSON_LABEL = /\b(adult|child|children|kid|infant|toddler|senior|student|youth|teen|person|people|guest|participant|rider|jumper|passenger|player|diver|paddler|skier|pax|per person)\b/i;
const WHOLE_LABEL = /\b(group|private|charter|whole|entire|family|couple|boat|vessel|pontoon|kayak|cart|kart|lane|room|table|vehicle|bike|jet ?ski|per (?:boat|group|hour|rental))\b|\b(?:up to|max(?:imum)?|for)\s*\d+\s*(?:ppl|people|persons?|guests?|pax|riders?|players?)\b|\(\s*\d+\s*(?:ppl|people|persons?|pax)\s*(?:max)?\s*\)/i;

/**
 * What one price buys: a person, the whole boat, the whole group, or one rental. With only a card to go on
 * (no option, no unit label) the name decides: "Boat Rental (MAX 7 people)" sells the boat.
 */
function unitFor(option: PriceOption | null, product: Pick<Product, "name" | "unitLabel">): string {
  const label = option?.label || "";
  const type = option?.type || "";
  const both = label + " " + product.name;
  // "Boat Rental (MAX 7 people)" sells the boat whatever the option is called ("Half Day"); the storefront's
  // unit label ("Rentals") says the same, but it is localised on ?lang= pages, so the name counts too.
  const rental = /rental/i.test(product.unitLabel || "") || /\brental\b|\b(?:max(?:imum)?|up to)\s*\d+\s*(?:people|ppl|persons?|pax|guests?|passengers?)\b/i.test(product.name);
  if (/^(ADULT|CHILD|INFANT|SENIOR|STUDENT|YOUTH)$/.test(type) || PER_PERSON_LABEL.test(label)) return "each";
  if (/^(FAMILY|GROUP)$/.test(type)) return "/group";
  if (/(boat|pontoon|tritoon|yacht|vessel|cruise|charter|sailboat|catamaran)/i.test(both) && (rental || WHOLE_LABEL.test(label))) return "/boat";
  if (/(jet ?ski|waverunner|sea-?doo)/i.test(both) && (rental || WHOLE_LABEL.test(label))) return "/jet ski";
  if (WHOLE_LABEL.test(label)) return "/group";
  if (rental) return "/rental";
  if (/hour|hr\b/i.test(product.unitLabel || "")) return "/hr";
  return "each";
}

/* ---------- reader ---------- */

/**
 * Reads the whole storefront: root, every catalog page, then each product page (capped) for its price options.
 * A product whose page cannot be read keeps its card: name, blurb, duration, "from" price.
 */
export async function readRezdy(ref: RezdyRef, opts: RezdyOptions = {}): Promise<WidgetResult | null> {
  const fetchHtml = opts.fetchHtml || defaultFetch;
  const maxProducts = opts.maxProducts ?? 40;
  const pauseMs = opts.pauseMs ?? 400;
  const origin = ref.origin;
  let pages = 0;
  const get = async (path: string): Promise<string | null> => {
    if (pages > 0) await pause(pauseMs);
    pages += 1;
    const html = await fetchHtml(path.startsWith("http") ? path : origin + path);
    if (!html || CF_BLOCK.test(html)) return null;
    return html;
  };

  const blocked = await disallowed(origin, fetchHtml);
  const cards = new Map<string, Card>();
  const root = blocked("/") ? null : await get("/");
  if (root) {
    for (const c of parseCards(root, origin)) cards.set(c.code, c);
    const catalogs = catalogLinks(root).filter((p) => !blocked(p)).slice(0, 12);
    for (const p of catalogs) {
      const html = await get(p);
      if (!html) continue;
      for (const c of parseCards(html, origin)) if (!cards.has(c.code)) cards.set(c.code, c);
    }
  }
  // A deep link into one catalog is read as given when the root gave nothing.
  if (!cards.size && ref.catalogId && !blocked(ref.path)) {
    const html = await get(ref.path);
    for (const c of parseCards(html || "", origin)) cards.set(c.code, c);
  }
  // A deep link to one product still reads that product when the root gave nothing (or listed it nowhere).
  if (ref.productCode && !cards.has(ref.productCode)) cards.set(ref.productCode, { code: ref.productCode, url: origin + ref.path, name: "", blurb: null, duration: null, fromPrice: null, currency: null, photo: null });
  if (!cards.size) return null;

  const offerings: Offering[] = [];
  const req = new Set<string>(); const pol = new Set<string>(); const inc = new Set<string>();
  let currency: string | null = null;
  let n = 0;
  for (const card of cards.values()) {
    let product: Product | null = null;
    if (n < maxProducts && !blocked("/" + card.code + "/")) {
      n += 1;
      const html = await get(card.url);
      product = html ? parseProduct(html) : null;
    }
    const name = (product?.name || card.name).trim();
    if (!name) continue;
    currency = currency || product?.currency || card.currency || null;
    const duration = product?.duration || card.duration;
    const photos = [...new Set([...(product?.photos || []), ...(card.photo ? [card.photo] : [])])].slice(0, 6);
    const longDesc = product?.desc || "";
    const desc = (card.blurb || longDesc.slice(0, 700).replace(/\s+\S*$/, "")).slice(0, 700) || null;
    const priced = (product?.options || []).filter((o) => o.price > 0);
    const base = { name, duration, url: card.url, desc, photo: photos[0] || null, photos };
    if (priced.length) {
      let first = true;
      for (const o of priced) {
        const labelIsGeneric = /^(adult|quantity|guest|participant|person|ticket|standard|general)s?$/i.test(o.label) || o.label.toLowerCase() === name.toLowerCase();
        offerings.push({
          ...base,
          detail: labelIsGeneric && priced.length === 1 ? duration : o.label,
          price: o.price,
          unit: unitFor(o, product!),
          desc: first ? desc : null,
          photo: first ? base.photo : null,
          photos: first ? photos : [],
        });
        first = false;
      }
      for (const o of product!.options) if (o.price === 0 && /infant|toddler|under \d|baby/i.test(o.label)) inc.add(`${name}: ${o.label} free.`);
    } else {
      offerings.push({ ...base, detail: duration, price: card.fromPrice, unit: unitFor(null, product || { name, unitLabel: null }) });
    }
    const mined = mineSentences(longDesc || card.blurb || "");
    mined.requirements.forEach((s) => req.add(s));
    mined.policies.forEach((s) => pol.add(s));
    mined.includes.forEach((s) => inc.add(s));
    const loc = product?.location?.replace(/^:?\s*/, "") || "";
    if (loc && loc.length <= 80 && !name.toLowerCase().includes(loc.toLowerCase().split(",")[0])) inc.add(`${name.slice(0, 60)}: meets in ${loc}.`);
  }
  if (!offerings.length) return null;
  const company: Company = { currency: currency ? currency.toUpperCase() : null };
  return { vendor: "rezdy", offerings, company, requirements: [...req].slice(0, 10), policies: [...pol].slice(0, 10), includes: [...inc].slice(0, 10), pages };
}
