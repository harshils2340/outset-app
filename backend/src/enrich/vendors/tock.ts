import type { Offering, WidgetResult } from "../widgets.ts";
import { safeFetch } from "../../lib/safeFetch.ts";

/**
 * Tock (exploretock.com): wineries, tasting experiences, cruises.
 *
 * What is public and what is not (probed 15 September 2026, plain HTTP, no browser):
 * - Every dynamic path on www.exploretock.com, app.exploretock.com and widget.exploretock.com answers
 *   403 with `cf-mitigated: challenge` (a Cloudflare managed JavaScript challenge). That includes the
 *   business page, /<biz>/widget/experiences (the iframe tock.js opens), /<biz>/experience/<id>/<slug>,
 *   /api/consumer/..., and even /robots.txt and /sitemap.xml. curl over HTTP/1.1 and HTTP/2, and Node's
 *   fetch, with a full Chrome header set, all get the challenge. Only static assets (/tock.js) are served.
 * - api.exploretock.com resolves to the same Cloudflare edge and answers 400/404 to every guess.
 * - There is no keyless JSON feed. The experience list exists only inside the challenged HTML.
 *
 * So `readTock` is honest about that: it fetches the business page once, and when the answer is the
 * challenge it returns null and says why on stderr. If Tock ever serves the page to a plain client, the
 * reader takes what is standard on it, schema.org JSON-LD (Event / Product / Offer, which Tock publishes
 * for search engines), and never guesses at Tock's private state shape. Nothing is invented.
 *
 * What IS reachable without a browser is the operator's own site: Tock buttons carry
 * `data-tock-experience="<id>"` and links to /<biz>/experience/<id>/<slug>. `tockRef` reads those, so the
 * crawl can at least pin the business slug and the set of experience ids an operator sells, one id per
 * bookable experience, and the deep link for each.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export type TockRef = {
  /** Business slug: exploretock.com/<business>. */
  business: string;
  /** Experience ids seen in the booking URL or in the operator's HTML (data-tock-experience, /experience/<id>/). Empty when none. */
  experiences: { id: string; slug: string | null; url: string }[];
};

const RESERVED = new Set(["widget", "api", "static", "city", "search", "login", "signup", "about", "faq", "gift", "reservations", "cdn-cgi", "tock.js", "experience", "event", "detail"]);

/** Business slug and experience ids from a Tock booking URL, or from a page of the operator's own HTML that embeds Tock. */
export function tockRef(bookingUrlOrHtml: string): TockRef | null {
  const s = bookingUrlOrHtml || "";
  const exps = new Map<string, { id: string; slug: string | null; url: string }>();
  let business: string | null = null;

  // Every exploretock.com/<biz>[/experience|event|detail/<id>[/<slug>]] link in the input.
  const linkRe = /https?:\/\/(?:www\.)?exploretock\.com\/([a-z0-9][a-z0-9_-]*)(?:\/(?:experience|event|detail)\/(\d+)(?:\/([a-z0-9-]+))?)?/gi;
  for (const m of s.matchAll(linkRe)) {
    const biz = m[1].toLowerCase();
    if (RESERVED.has(biz)) continue;
    business ||= biz;
    if (m[2] && biz === business) {
      const slug = m[3] ? m[3].toLowerCase() : null;
      exps.set(m[2], { id: m[2], slug, url: `https://www.exploretock.com/${business}/experience/${m[2]}${slug ? "/" + slug : ""}` });
    }
  }
  // tock.js embeds: Tock('init', '<biz>') and data-tock-experience="<id>" buttons.
  const init = s.match(/Tock\(\s*['"]init['"]\s*,\s*['"]([a-z0-9][a-z0-9_-]*)['"]/i);
  if (init && !RESERVED.has(init[1].toLowerCase())) business ||= init[1].toLowerCase();
  if (business) {
    for (const m of s.matchAll(/data-tock-experience=["'](\d+)["']/gi)) {
      if (!exps.has(m[1])) exps.set(m[1], { id: m[1], slug: null, url: `https://www.exploretock.com/${business}/experience/${m[1]}` });
    }
  }
  if (!business) return null;
  return { business, experiences: [...exps.values()] };
}

type Fetched = { status: number; challenged: boolean; html: string };

async function getPage(url: string): Promise<Fetched | null> {
  try {
    const res = await safeFetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" },
      timeoutMs: 15000,
      maxBytes: 5_000_000,
    });
    const html = await res.text();
    const challenged = res.headers.get("cf-mitigated") === "challenge" || /<title>Just a moment\.\.\.<\/title>/.test(html);
    return { status: res.status, challenged, html };
  } catch {
    return null;
  }
}

/** Every JSON-LD object on a page, flattened through @graph. */
function jsonLd(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1].trim()) as unknown;
      const push = (x: unknown) => {
        if (Array.isArray(x)) x.forEach(push);
        else if (x && typeof x === "object") {
          const o = x as Record<string, unknown>;
          out.push(o);
          if (Array.isArray(o["@graph"])) (o["@graph"] as unknown[]).forEach(push);
        }
      };
      push(j);
    } catch { /* not JSON */ }
  }
  return out;
}

const strip = (s: unknown): string | null => (typeof s === "string" ? s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null : null);

function lowestOffer(o: Record<string, unknown>): { price: number | null; currency: string | null } {
  const offers = Array.isArray(o.offers) ? o.offers : o.offers ? [o.offers] : [];
  let price: number | null = null; let currency: string | null = null;
  for (const raw of offers as Record<string, unknown>[]) {
    const p = Number(raw.price ?? raw.lowPrice);
    if (Number.isFinite(p) && p > 0 && (price == null || p < price)) { price = p; currency = typeof raw.priceCurrency === "string" ? raw.priceCurrency : currency; }
  }
  return { price, currency };
}

function isoDuration(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const m = s.match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/i);
  if (!m) return null;
  const h = Number(m[1] || 0); const min = Number(m[2] || 0);
  if (h && min) return `${h}.${Math.round((min / 60) * 10)} hours`;
  if (h) return h === 1 ? "1 hour" : `${h} hours`;
  return min ? `${min} min` : null;
}

/**
 * Reads the Tock business page. Returns null when Cloudflare serves its challenge instead of the page
 * (the case for every plain client today) or when the page carries no schema.org offerings.
 */
export async function readTock(ref: TockRef): Promise<WidgetResult | null> {
  const url = `https://www.exploretock.com/${ref.business}`;
  const page = await getPage(url);
  if (!page) return null;
  if (page.challenged || page.status >= 400) {
    console.error(`tock: ${url} answered ${page.status}${page.challenged ? " with a Cloudflare managed challenge" : ""}; Tock has no keyless feed, nothing read`);
    return null;
  }
  const nodes = jsonLd(page.html);
  const offerings: Offering[] = [];
  const seen = new Set<string>();
  for (const n of nodes) {
    const type = String(n["@type"] || "");
    if (!/Event|Product|Offer|Service/i.test(type)) continue;
    const name = strip(n.name);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const { price } = lowestOffer(n);
    const image = Array.isArray(n.image) ? n.image[0] : n.image;
    const photo = typeof image === "string" ? image : image && typeof image === "object" ? strip((image as Record<string, unknown>).url) : null;
    const link = typeof n.url === "string" ? n.url : url;
    const idm = link.match(/\/(?:experience|event|detail)\/(\d+)/);
    const known = idm ? ref.experiences.find((e) => e.id === idm[1]) : null;
    offerings.push({
      name,
      detail: null,
      duration: isoDuration(n.duration),
      price,
      unit: "each",
      url: known?.url || link,
      desc: strip(n.description)?.slice(0, 700) || null,
      photo,
      photos: photo ? [photo] : [],
    });
  }
  if (!offerings.length) {
    console.error(`tock: ${url} served HTML but no schema.org Event/Product nodes; nothing read`);
    return null;
  }
  const org = nodes.find((n) => /Organization|Winery|LocalBusiness|Restaurant/i.test(String(n["@type"] || "")));
  const addr = org && typeof org.address === "object" && org.address ? (org.address as Record<string, unknown>) : null;
  return {
    vendor: "tock",
    offerings,
    company: {
      currency: lowestOffer(nodes.find((n) => n.offers) || {}).currency,
      phone: strip(org?.telephone),
      street: strip(addr?.streetAddress),
      city: strip(addr?.addressLocality),
      region: strip(addr?.addressRegion),
      postal: strip(addr?.postalCode),
    },
    requirements: [],
    policies: [],
    includes: [],
    pages: 1,
  };
}
