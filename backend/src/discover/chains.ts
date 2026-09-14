import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { getJson, getPage, sleep } from "./polite.ts";

/**
 * Chain and franchise location pages, Florida only.
 *
 * A franchise publishes every one of its locations on its own site, with name, street, phone and usually a
 * booking link, because that is how it sells. One sitemap or store-locator call gives every Florida studio,
 * gym or park of that brand with near-perfect precision, which is exactly the supply OpenStreetMap tags
 * miss (paint and sip, escape rooms, trampoline parks, massage, swim schools).
 *
 * This module never opens SQLite. It runs on a GitHub runner from scripts/discover-florida-ci.mts, which
 * writes backend/data/discovered/florida-chains.json; scripts/import-discovered.mts inserts the new ones on a
 * machine that has the database.
 *
 * Parsers prefer structured data: schema.org JSON-LD on each location page, a store-locator JSON endpoint, or
 * a sitemap of location pages. HTML text is the last resort (a "123 Main St, Tampa, FL 33602" line plus a
 * tel: link). Every fetch goes through polite.ts: robots.txt, one request per host at a time, a pause between.
 */

export type Candidate = {
  name: string;
  website: string | null;
  /** Unique key. A website host for independents; for a chain location a per-location key, since every location shares the brand host. */
  domain: string;
  street: string | null;
  city: string | null;
  region: "FL";
  postal: string | null;
  lat: number | null;
  lon: number | null;
  phone: string | null;
  /** Outset category id (taxonomy/catalog.ts). */
  kind: string;
  source: "chain" | "osm" | "web";
  sourceUrl: string;
  /** Finer activity word than the category, for reporting ("paint-and-sip" inside category "pottery"). */
  activity?: string;
  /** Brand for chain rows, so the importer can recognise an existing row of the same brand nearby. */
  brand?: string;
};

/** A location as a parser sees it, before it becomes a candidate. */
export type RawPlace = {
  name?: string | null;
  /** Location label when the page's name is just the brand ("South Tampa", "Carrollwood"). */
  label?: string | null;
  street?: string | null;
  city?: string | null;
  region?: string | null;
  postal?: string | null;
  lat?: number | string | null;
  lon?: number | string | null;
  phone?: string | null;
  url?: string | null;
};

export type ChainCtx = {
  getPage: typeof getPage;
  getJson: typeof getJson;
  parsePlaces: typeof parsePlaces;
  sitemapLocs: typeof sitemapLocs;
  linksFrom: typeof linksFrom;
  log: (msg: string) => void;
};

export type Strategy =
  /** A sitemap (or sitemap index) whose location URLs match `match`; each matching page is parsed. */
  | { type: "sitemap"; sitemaps: string[]; match: RegExp; childMatch?: RegExp; max?: number }
  /** Start pages (a Florida directory page), follow links matching `follow`, parse pages matching `leaf`. */
  | { type: "crawl"; start: string[]; follow?: RegExp; leaf: RegExp; max?: number }
  /** One or a few pages that list every location in structured data. */
  | { type: "page"; urls: string[] }
  /** A store-locator endpoint or embedded JSON that needs its own mapping. */
  | { type: "custom"; run: (ctx: ChainCtx) => Promise<RawPlace[]> };

export type Chain = {
  id: string;
  brand: string;
  kind: string;
  activity?: string;
  site: string;
  strategy: Strategy;
  /** What a human saw on the live site when this entry was written. */
  verified?: string;
};

// ---------------------------------------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", "#39": "'", "#x27": "'", nbsp: " ", lt: "<", gt: ">", ndash: "-", mdash: "-", rsquo: "'", lsquo: "'" };

export function decode(s: string): string {
  return s
    .replace(/&(#?[a-z0-9]+);/gi, (m, k: string) => {
      if (ENTITIES[k.toLowerCase()] != null) return ENTITIES[k.toLowerCase()];
      if (/^#\d+$/.test(k)) return String.fromCharCode(Number(k.slice(1)));
      if (/^#x[0-9a-f]+$/i.test(k)) return String.fromCharCode(parseInt(k.slice(2), 16));
      return m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

const str = (v: unknown): string | null => {
  if (v == null) return null;
  if (Array.isArray(v)) return str(v[0]);
  if (typeof v === "object") return null;
  const s = decode(String(v));
  return s ? s : null;
};

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n !== 0 ? n : null;
};

/** Every object inside every JSON-LD block, flattened through @graph, arrays and nesting. */
export function jsonLdNodes(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const re = /<script[^>]+type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let data: unknown;
    const raw = m[1].trim().replace(/^<!\[CDATA\[|\]\]>$/g, "");
    try {
      data = JSON.parse(raw);
    } catch {
      // Hand-written blocks break JSON in two common ways: raw newlines inside strings, and unrendered
      // template tags ("sameAs": {{links}}). Repair those; failing that, salvage the address objects.
      const repaired = raw.replace(/[\u0000-\u001f]+/g, " ").replace(/:\s*\{\{[^{}]*\}\}/g, ": null");
      try {
        data = JSON.parse(repaired);
      } catch {
        data = salvageAddresses(repaired);
        if (!data) continue;
      }
    }
    const walk = (v: unknown, depth: number): void => {
      if (depth > 6 || v == null) return;
      if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
      if (typeof v !== "object") return;
      const o = v as Record<string, unknown>;
      out.push(o);
      for (const [k, x] of Object.entries(o)) if (k !== "address" && typeof x === "object") walk(x, depth + 1);
    };
    walk(data, 0);
  }
  return out;
}

/** Address objects out of a JSON-LD block that will not parse, with the name, phone and geo written around them. */
function salvageAddresses(raw: string): Record<string, unknown>[] | null {
  const out: Record<string, unknown>[] = [];
  const re = /"address"\s*:\s*(\{[^{}]*\})/g;
  let m: RegExpExecArray | null;
  let from = 0;
  const lastOf = (r: RegExp, text: string) => [...text.matchAll(r)].pop()?.[1];
  while ((m = re.exec(raw))) {
    let address: unknown;
    try {
      address = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const before = raw.slice(from, m.index);
    const after = raw.slice(m.index, m.index + 800);
    let geo: unknown = null;
    try {
      const g = after.match(/"geo"\s*:\s*(\{[^{}]*\})/)?.[1];
      geo = g ? JSON.parse(g) : null;
    } catch {
      geo = null;
    }
    out.push({
      "@type": "LocalBusiness",
      name: lastOf(/"name"\s*:\s*"([^"]*)"/g, before),
      telephone: lastOf(/"telephone"\s*:\s*"([^"]*)"/g, before) || after.match(/"telephone"\s*:\s*"([^"]*)"/)?.[1],
      address,
      geo,
    });
    from = m.index + m[0].length;
  }
  return out.length ? out : null;
}

function addressOf(a: unknown): Pick<RawPlace, "street" | "city" | "region" | "postal"> | null {
  if (Array.isArray(a)) return addressOf(a[0]);
  if (typeof a === "string") return parseAddressLine(a);
  if (!a || typeof a !== "object") return null;
  const o = a as Record<string, unknown>;
  const street = str(o.streetAddress);
  const city = str(o.addressLocality);
  const region = str(o.addressRegion);
  const postal = str(o.postalCode);
  if (!street && !city && !postal) return null;
  return { street, city, region, postal };
}

/** "123 Main St, Suite 4, Tampa, FL 33602" -> parts. Null unless it ends in a US state and ZIP. */
export function parseAddressLine(s: string): Pick<RawPlace, "street" | "city" | "region" | "postal"> | null {
  const m = decode(s).match(/^(.*?),\s*([A-Za-z .'-]{2,40}),?\s+(FL|Florida|[A-Z]{2})\.?,?\s+(\d{5})(?:-\d{4})?\b/i);
  if (!m) return null;
  return { street: m[1].trim() || null, city: m[2].trim(), region: m[3], postal: m[4] };
}

const PLACE_TYPE = /LocalBusiness|Place|Store|Organization|Center|Club|Studio|Gym|Spa|Park|Attraction|Entertainment|Amusement|Bowling|Golf|Sports|Health|Beauty|Restaurant|School|Venue|Location/i;

/** Locations in one page: JSON-LD first, then microdata, then an address line in the text. */
export function parsePlaces(html: string, pageUrl: string): RawPlace[] {
  const found: RawPlace[] = [];
  for (const n of jsonLdNodes(html)) {
    const type = [n["@type"]].flat().map(String).join(" ");
    const addr = addressOf(n.address);
    if (!addr || (type && !PLACE_TYPE.test(type) && !n.address)) continue;
    const geo = (n.geo || {}) as Record<string, unknown>;
    found.push({
      name: str(n.name),
      ...addr,
      lat: num(geo.latitude),
      lon: num(geo.longitude),
      phone: str(n.telephone),
      url: str(n.url) || pageUrl,
    });
  }
  // Structured data that places the business in Florida wins. A block naming another state (a copied template:
  // one Florida tour page carries an Arizona address) does not stop the page text being read.
  if (found.some(isFlorida)) return dedupeRaw(found);

  const $ = cheerio.load(html);
  const street = $('[itemprop="streetAddress"]').first().text();
  const city = $('[itemprop="addressLocality"]').first().text();
  const region = $('[itemprop="addressRegion"]').first().text();
  const postal = $('[itemprop="postalCode"]').first().text();
  const tel = ($('a[href^="tel:"]').first().attr("href") || "").replace(/^tel:/, "") || $('[itemprop="telephone"]').first().text();
  if (street && (city || postal)) {
    return [...found, { name: str($('[itemprop="name"]').first().text()) || str($("h1").first().text()), street: decode(street), city: decode(city) || null, region: decode(region) || null, postal: decode(postal) || null, phone: tel || null, url: pageUrl }];
  }

  // Text fallback: the first "street, city, ST 12345" line on the page.
  $("script, style, noscript").remove();
  const text = $("body").text().replace(/\s+/g, " ");
  const m = text.match(/(\d{1,6}\s+[A-Za-z0-9 .#'-]{3,60}?(?:,\s*(?:Suite|Ste\.?|Unit|#)\s*[A-Za-z0-9-]+)?),\s*([A-Za-z .'-]{2,30}),\s*(FL|Florida)\.?\s+(3[234]\d{3})\b/i);
  if (m) {
    return [...found, { name: str($("h1").first().text()), street: m[1].trim(), city: m[2].trim(), region: "FL", postal: m[4], phone: tel || null, url: pageUrl }];
  }
  return dedupeRaw(found);
}

function dedupeRaw(list: RawPlace[]): RawPlace[] {
  const seen = new Set<string>();
  return list.filter((p) => {
    const k = [p.street, p.postal, p.name].map((x) => (x || "").toLowerCase()).join("|");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Florida by state field, else by ZIP (32004-34997 belong to Florida alone), else by coordinates and no other state. */
export function isFlorida(p: RawPlace): boolean {
  const r = (p.region || "").trim().toLowerCase().replace(/\.$/, "");
  if (r) return r === "fl" || r === "florida";
  if (p.postal && /^3[234]\d{3}/.test(p.postal)) return true;
  const lat = num(p.lat), lon = num(p.lon);
  // Peninsula south of the Georgia line; the panhandle strip needs a ZIP or state to tell it from Alabama.
  return lat != null && lon != null && lat > 24.3 && lat < 30.3 && lon > -83.2 && lon < -79.8;
}

/** Every <loc> in a sitemap, following sitemap indexes (children filtered by `childMatch` when given). */
export async function sitemapLocs(url: string, childMatch?: RegExp, depth = 0): Promise<string[]> {
  const page = await getPage(url);
  if (page.status !== 200 || !page.html) return [];
  const locs = [...page.html.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)\s*(?:\]\]>)?\s*<\/loc>/gi)].map((m) => decode(m[1]));
  if (/<sitemapindex/i.test(page.html) && depth < 2) {
    const out: string[] = [];
    for (const child of locs) {
      if (childMatch && !childMatch.test(child)) continue;
      out.push(...(await sitemapLocs(child, childMatch, depth + 1)));
    }
    return out;
  }
  return locs;
}

/** Absolute links in a page that match `re`, without fragments, deduplicated. */
export function linksFrom(html: string, base: string, re: RegExp): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(decode(m[1]), base);
      if (!/^https?:$/.test(u.protocol)) continue;
      u.hash = "";
      const s = u.toString();
      if (re.test(s)) out.add(s);
    } catch {
      /* not a URL */
    }
  }
  return [...out];
}

// ---------------------------------------------------------------------------------------------------------
// Running a chain
// ---------------------------------------------------------------------------------------------------------

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const norm = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
const titleCase = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url.startsWith("http") ? url : "https://" + url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** "(813) 555-0100" -> "+18135550100". Same shape as the scrape normaliser, without importing the database. */
export function phoneE164(p: string | null | undefined): string | null {
  const d = (p || "").replace(/[^\d+]/g, "");
  const digits = d.replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return null;
}

function chainName(chain: Chain, raw: RawPlace, city: string | null, pageUrl: string): string {
  const brand = chain.brand;
  const nm = raw.name ? decode(raw.name).replace(/\s*[|–—]\s.*$/, "").trim() : "";
  const nb = norm(brand);
  // The page's own name, when it is the brand plus a location ("Massage Envy - Aventura"), not a tagline.
  if (nm && norm(nm) !== nb && (` ${norm(nm)} `).includes(` ${nb} `) && nm.length <= 80) return nm;
  if (raw.label) return `${brand} ${decode(raw.label)}`.slice(0, 80);
  const last = decodeURIComponent(new URL(pageUrl).pathname.split("/").filter(Boolean).pop() || "");
  if (last && !/\d/.test(last) && last.length <= 40 && norm(last) !== nb && !/^(fl|florida|locations?|studios?|index(\.html?)?)$/i.test(last)) {
    const label = titleCase(last.replace(/\.(html?|aspx)$/i, "").replace(/[-_]+/g, " "));
    if (!norm(label).includes(nb)) return `${brand} ${label}`.slice(0, 80);
  }
  return city ? `${brand} ${city}` : brand;
}

export function toCandidate(chain: Chain, raw: RawPlace, sourceUrl: string): Candidate | null {
  if (!isFlorida(raw)) return null;
  const city = raw.city ? titleCase(decode(raw.city).toLowerCase()) : null;
  const street = raw.street ? decode(raw.street) : null;
  if (!city && !street) return null;
  const website = raw.url && /^https?:/.test(raw.url) ? raw.url : sourceUrl;
  // Sites publish copy-pasted pins and typo'd ZIPs; a pin outside Florida or a ZIP that is not five digits is dropped, not guessed.
  let lat = num(raw.lat), lon = num(raw.lon);
  if (lat == null || lon == null || lat < 24.3 || lat > 31.1 || lon < -87.7 || lon > -79.8) lat = lon = null;
  const postal = raw.postal && /^\d{5}(-\d{4})?$/.test(String(raw.postal).trim()) ? String(raw.postal).trim().slice(0, 5) : null;
  const key = createHash("sha1").update([chain.id, street || "", raw.postal || "", city || ""].join("|").toLowerCase()).digest("hex").slice(0, 6);
  return {
    name: chainName(chain, raw, city, website),
    website,
    domain: `chain-${chain.id}-${slug(city || "fl").slice(0, 16)}-${key}`,
    street,
    city,
    region: "FL",
    postal,
    lat,
    lon,
    phone: phoneE164(raw.phone),
    kind: chain.kind,
    source: "chain",
    sourceUrl,
    activity: chain.activity,
    brand: chain.brand,
  };
}

export type ChainResult = { id: string; brand: string; pages: number; florida: number; candidates: Candidate[]; note?: string };

/** Run one registry entry. Never throws; a broken parser returns zero with a note. */
export async function runChain(chain: Chain, log: (m: string) => void = console.log): Promise<ChainResult> {
  const out: Candidate[] = [];
  let pages = 0;
  const take = (raws: RawPlace[], url: string) => {
    for (const r of raws) {
      const c = toCandidate(chain, r, url);
      if (c) out.push(c);
    }
  };
  const ctx: ChainCtx = {
    getPage: async (u, gap) => {
      pages += 1;
      return getPage(u, gap);
    },
    getJson: async (u, init, gap) => {
      pages += 1;
      return getJson(u, init, gap);
    },
    parsePlaces,
    sitemapLocs,
    linksFrom,
    log,
  };
  const s = chain.strategy;
  try {
    if (s.type === "page") {
      for (const u of s.urls) {
        const p = await ctx.getPage(u);
        take(parsePlaces(p.html, p.finalUrl || u), u);
      }
    } else if (s.type === "custom") {
      const raws = await s.run(ctx);
      for (const r of raws) take([r], r.url || chain.site);
    } else if (s.type === "sitemap") {
      const locs = new Set<string>();
      for (const sm of s.sitemaps) {
        pages += 1;
        for (const l of await sitemapLocs(sm, s.childMatch)) if (s.match.test(l)) locs.add(l);
      }
      const list = [...locs].slice(0, s.max ?? 400);
      log(`  ${chain.id}: ${list.length} location pages in the sitemap`);
      for (const u of list) {
        const p = await ctx.getPage(u);
        if (p.status === 200) take(parsePlaces(p.html, u), u);
      }
    } else if (s.type === "crawl") {
      const queue = [...s.start];
      const seen = new Set(queue);
      const max = s.max ?? 300;
      while (queue.length && pages < max) {
        const u = queue.shift()!;
        const p = await ctx.getPage(u);
        if (p.status !== 200) continue;
        if (s.leaf.test(u)) take(parsePlaces(p.html, u), u);
        if (!s.follow || s.follow.test(u) || s.start.includes(u)) {
          for (const l of linksFrom(p.html, p.finalUrl || u, s.follow ? new RegExp(`${s.follow.source}|${s.leaf.source}`, s.leaf.flags) : s.leaf)) {
            if (!seen.has(l)) {
              seen.add(l);
              queue.push(l);
            }
          }
        }
      }
    }
  } catch (e) {
    return { id: chain.id, brand: chain.brand, pages, florida: dedupeCandidates(out).length, candidates: dedupeCandidates(out), note: (e as Error).message.slice(0, 120) };
  }
  const unique = dedupeCandidates(out);
  return { id: chain.id, brand: chain.brand, pages, florida: unique.length, candidates: unique, ...(unique.length ? {} : { note: "no Florida locations parsed" }) };
}

/**
 * By domain, then by normalised name plus city. Two chain locations with the same name in one city (two
 * "Massage Envy Tampa") are told apart by their street before the name check, so neither is lost.
 */
export function dedupeCandidates(list: Candidate[]): Candidate[] {
  const byDomain = new Map<string, Candidate>();
  for (const c of list) {
    const prev = byDomain.get(c.domain);
    if (!prev || filled(c) > filled(prev)) byDomain.set(c.domain, c);
  }
  const counts = new Map<string, number>();
  for (const c of byDomain.values()) {
    const k = norm(c.name) + "|" + norm(c.city || "");
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const byName = new Map<string, Candidate>();
  for (const c of byDomain.values()) {
    const k = norm(c.name) + "|" + norm(c.city || "");
    if ((counts.get(k) || 0) > 1 && c.source === "chain" && c.street) {
      const street = c.street.replace(/,.*$/, "").replace(/^\d+\s*/, "");
      c.name = `${c.name} (${street})`.slice(0, 90);
    }
    const k2 = norm(c.name) + "|" + norm(c.city || "");
    const prev = byName.get(k2);
    if (!prev || filled(c) > filled(prev)) byName.set(k2, c);
  }
  return [...byName.values()];
}

function filled(c: Candidate): number {
  return [c.website, c.street, c.postal, c.phone, c.lat, c.lon].filter((x) => x != null && x !== "").length;
}

export async function runChains(chains: Chain[], log: (m: string) => void = console.log, gapBetweenChainsMs = 1000): Promise<ChainResult[]> {
  const results: ChainResult[] = [];
  for (const c of chains) {
    const started = Date.now();
    const r = await runChain(c, log);
    results.push(r);
    log(`${c.id}: ${r.florida} Florida locations from ${r.pages} fetches in ${Math.round((Date.now() - started) / 1000)}s${r.note ? " (" + r.note + ")" : ""}`);
    await sleep(gapBetweenChainsMs);
  }
  return results;
}

// ---------------------------------------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------------------------------------

/**
 * Every entry was checked against the live site on 14 September 2026 (the `verified` note says what was seen).
 * Custom parsers exist where a brand's pages carry no usable structured data or where its store locator returns
 * every Florida location in one call. Brands left out on purpose: Wine & Design, All In Adventures, Escape Hunt
 * and Urban Axes (no Florida locations); Williams Sonoma (no per-store classes); Code Ninjas and Snapology (no
 * category fits kids' coding and STEM classes); Goldfish, Big Blue and British Swim School, Pure Barre and
 * Vertical Ventures (their sites refuse a non-browser client); Hammer & Nails and Drybar (grooming, not an
 * experience); Cozymeal and Classpop (marketplaces, not operators).
 */
export const CHAINS: Chain[] = [
  // Paint and sip, pottery painting, DIY workshops, cooking classes, kids' training, illusion museums
  {
    id: "pwat", brand: "Painting with a Twist", kind: "pottery", activity: "paint-and-sip", site: "https://www.paintingwithatwist.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        // /locations/ embeds every studio as `locations = [...]` (address, phone, lat/lon, status). No JSON-LD on studio pages.
        const p = await ctx.getPage("https://www.paintingwithatwist.com/locations/");
        const m = (p.html || "").match(/locations\s*=\s*(\[[\s\S]*?\]);\s*\n/);
        if (!m) return [];
        let list: any[] = [];
        try {
          list = JSON.parse(m[1]);
        } catch {
          return [];
        }
        return list
          .filter((x) => x && x.state === "FL" && (!x.FranchiseStatus || x.FranchiseStatus.description === "Open"))
          .map((x) => ({
            label: x.subArea || x.city || x.title,
            street: [x.address1, x.address2].map((s: string) => String(s || "").replace(/,\s*$/, "").trim()).filter(Boolean).join(", "),
            city: x.city ? String(x.city).trim() : null,
            region: "FL",
            postal: x.zip || null,
            lat: x.latitude,
            lon: x.longitude,
            phone: x.phone || null,
            url: `https://www.paintingwithatwist.com/studio/${x.url}/`,
          }));
      },
    },
    verified: "2026-09-14: /locations/ embeds a locations JSON array of 179 studios; 29 with state FL, 25 of them status Open (4 Opening Soon skipped). Studio pages have no JSON-LD, so the array is mapped directly. No sitemap.xml or robots.txt (both 404)",
  },
  {
    id: "pinots", brand: "Pinot's Palette", kind: "pottery", activity: "paint-and-sip", site: "https://www.pinotspalette.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        // /locations groups studio links under <h2>State</h2>; take the Florida block, parse each studio page's JSON-LD.
        const p = await ctx.getPage("https://www.pinotspalette.com/locations");
        const html = p.html || "";
        const i = html.search(/>\s*Florida\s*<\/h2>/i);
        if (i < 0) return [];
        const end = html.indexOf("</ul>", i);
        const links = ctx.linksFrom(html.slice(i, end > i ? end : i + 5000), "https://www.pinotspalette.com/", /^https:\/\/www\.pinotspalette\.com\/[a-z0-9-]+\/?$/);
        const out: any[] = [];
        for (const u of links) {
          const s = await ctx.getPage(u);
          if (s.status === 200) out.push(...ctx.parsePlaces(s.html, u));
        }
        return out;
      },
    },
    verified: "2026-09-14: /locations lists 1 Florida studio (Spring Hill, /springhill); its page carries JSON-LD EntertainmentBusiness with street, Brooksville FL 34613, phone and geo",
  },
  {
    id: "boardbrush", brand: "Board & Brush", kind: "pottery", activity: "diy-workshop", site: "https://boardandbrush.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        // /studio-locations/ has a FLORIDA heading followed by a <ul> of studio links. Studio pages have no JSON-LD and
        // the address has no comma before the city, so read the sidebar "contact-info" block directly.
        const p = await ctx.getPage("https://boardandbrush.com/studio-locations/");
        const html = p.html || "";
        const i = html.search(/>\s*FLORIDA\s*</);
        if (i < 0) return [];
        const end = html.indexOf("</ul>", i);
        const links = ctx.linksFrom(html.slice(i, end > i ? end : i + 5000), "https://boardandbrush.com/", /^https:\/\/boardandbrush\.com\/[a-z0-9-]+\/?$/);
        const clean = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
        const out: any[] = [];
        for (const u of links) {
          const s = await ctx.getPage(u);
          if (s.status !== 200) continue;
          const m = s.html.match(/<div class="contact-info">\s*<h2>([^<]*)<\/h2>\s*<p>([\s\S]*?)<\/p>\s*<p>([\s\S]*?)<\/p>/);
          if (!m) {
            out.push(...ctx.parsePlaces(s.html, u));
            continue;
          }
          const lines = m[2].split(/<br\s*\/?>/i).map(clean).filter(Boolean);
          const last = lines.pop() || "";
          const cm = last.match(/^(.*?),\s*([A-Za-z]{2})\.?\s+(\d{5})/);
          if (!cm) continue;
          out.push({
            label: clean(m[1]).replace(/,\s*[A-Z]{2}\s*Studio\s*$/i, "").replace(/\s*Studio\s*$/i, ""),
            street: lines.join(", ") || null,
            city: cm[1].trim(),
            region: cm[2].toUpperCase(),
            postal: cm[3],
            phone: clean(m[3]) || null,
            url: u,
          });
        }
        return out;
      },
    },
    verified: "2026-09-14: /studio-locations/ FLORIDA block lists 6 studios (Fort Myers, Lakewood Ranch, Ocoee, Safety Harbor, St. Johns, Wesley Chapel); /fortmyers/ has a contact-info block with 14261 S Tamiami Tr, Unit 18, Fort Myers, FL 33912 and (239) 221-6164, no JSON-LD. robots.txt serves an HTML page (no rules)",
  },
  {
    id: "colormemine", brand: "Color Me Mine", kind: "pottery", activity: "pottery-painting", site: "https://www.colormemine.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        // WP Store Locator endpoint used by /locations; a search centred on Florida returns every FL studio.
        const list = await ctx.getJson<any[]>("https://www.colormemine.com/wp-admin/admin-ajax.php?action=store_search&lat=28.1&lng=-83.0&max_results=200&search_radius=500");
        if (!Array.isArray(list)) return [];
        return list
          .filter((x) => /^(fl|florida)$/i.test(String(x.state || "").trim()) && !/coming soon/i.test(String(x.store || "")))
          .map((x) => ({
            label: String(x.store || "").replace(/&#8211;.*$/, "").trim() || null,
            street: [x.address, x.address2].map((s: string) => String(s || "").trim()).filter(Boolean).join(", "),
            city: x.city || null,
            region: "FL",
            postal: x.zip || null,
            lat: x.lat,
            lon: x.lng,
            phone: x.phone || null,
            url: x.url ? String(x.url).replace("@colormemine.com", ".colormemine.com") : null,
          }));
      },
    },
    verified: "2026-09-14: admin-ajax store_search around Florida returned 14 studios, 12 in FL (11 open plus Doral 'Coming Soon', skipped): Winter Garden, Altamonte Springs, Tampa, Trinity, Jacksonville, Davie, Aventura, Edgewater Miami, South Miami, Tallahassee, Pensacola; each with street, zip, phone, lat/lng and studio subdomain URL",
  },
  {
    id: "surlatable", brand: "Sur La Table", kind: "cooking", activity: "cooking-class", site: "https://www.surlatable.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        // Rio SEO location sitemap; only Florida stores that publish a cooking-classes page are taken.
        const locs = await ctx.sitemapLocs("https://www.surlatable.com/sitemap-riositemap.xml");
        const pages = locs.filter((u) => /\/locations\/fl\/[a-z0-9-]+\/cooking-classes-\d+\.html$/.test(u));
        const out: any[] = [];
        for (const u of pages) {
          const s = await ctx.getPage(u);
          if (s.status !== 200) continue;
          const tel = (s.html.match(/"telephone"\s*:\s*"([^"]+)"/) || [])[1] || null;
          for (const r of ctx.parsePlaces(s.html, u)) out.push({ ...r, phone: r.phone || tel, url: u });
        }
        return out;
      },
    },
    verified: "2026-09-14: sitemap-riositemap.xml has 8 FL stores, 7 with a cooking-classes page (Boca Raton, Jacksonville, Melbourne, Miami, Naples, Tampa, West Palm Beach; The Villages has none). Tampa cooking-classes page carries JSON-LD LocalBusiness with street, FL 33606 and geo; telephone sits inside the address object, so it is read separately",
  },
  {
    id: "kidstrong", brand: "KidStrong", kind: "fitness", activity: "kids-athletic-training", site: "https://www.kidstrong.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        // www sitemap lists /parties/<slug> for every centre but no state; each centre has its own subdomain
        // (slug without hyphens, a few with -fl) whose home page carries JSON-LD LocalBusiness. isFlorida filters.
        // The HubDB locator API behind /locations is disallowed by api.hubapi.com robots.txt, so it is not used.
        const locs = await ctx.sitemapLocs("https://www.kidstrong.com/sitemap.xml");
        const slugs = [...new Set(locs.map((u) => (u.match(/\/parties\/([a-z0-9-]+)\/?$/) || [])[1]).filter(Boolean))] as string[];
        const out: any[] = [];
        for (const slug of slugs) {
          const compact = slug.replace(/-/g, "");
          for (const host of [compact, `${compact}-fl`]) {
            const u = `https://${host}.kidstrong.com/`;
            const s = await ctx.getPage(u, 500);
            if (s.status !== 200 || !s.html) continue;
            const places = ctx.parsePlaces(s.html, s.finalUrl || u);
            if (places.length) {
              out.push(...places.map((r: any) => ({ ...r, url: s.finalUrl || u })));
              break;
            }
          }
        }
        return out;
      },
    },
    verified: "2026-09-14: 245 centres in the www sitemap (/parties/<slug>); 16 Florida centres (Coral Springs, Kendall, Southside, Oviedo, Orange Park, St. Johns, Plantation, South Tampa, Fort Myers, Doral, Palm Beach Gardens, Coral Gables, Stuart, Lake Worth, Citrus Park, Pembroke Pines). stuart.kidstrong.com and southtampa.kidstrong.com carry JSON-LD LocalBusiness with street, FL zip; citruspark.kidstrong.com redirects to citruspark-fl. Walks every subdomain (about 250 to 490 fetches, each a different host)",
  },
  {
    id: "moi", brand: "Museum of Illusions", kind: "museum", activity: "illusion-museum", site: "https://www.museumofillusions.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        // The only Florida museum (Orlando) runs on its own domain; its JSON-LD has three address nodes with a
        // "Located at ICON Park:" prefix and a "FL 32819" postal code, so keep one clean record.
        const u = "https://moiorlando.com/";
        const s = await ctx.getPage(u);
        if (s.status !== 200) return [];
        const tel = (s.html.match(/"telephone"\s*:\s*"([^"]+)"/) || [])[1] || null;
        const places = ctx.parsePlaces(s.html, u).filter((r: any) => r.name);
        const r: any = places[0];
        if (!r) return [];
        return [{
          ...r,
          name: "Museum of Illusions Orlando",
          street: String(r.street || "").replace(/^Located at [^:]*:\s*/i, "").trim() || null,
          postal: (String(r.postal || "").match(/\d{5}/) || [])[0] || null,
          region: "FL",
          phone: r.phone || tel,
          lat: r.lat ?? 28.443026,
          lon: r.lon ?? -81.469214,
          url: u,
        }];
      },
    },
    verified: "2026-09-14: /en/our-locations/ shows 1 Florida museum (Orlando, linking moiorlando.com); moiorlando.com JSON-LD LocalBusiness has 8441 International Dr Suite #250, Orlando, Florida 32819, phone +1 833-541-0992 and geo",
  },
  {
    id: "arworkshop", brand: "AR Workshop", kind: "pottery", activity: "diy-workshop", site: "https://www.arworkshop.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        // Site menu has a FLORIDA sub-menu of studio links; studio pages have no address JSON-LD but a
        // "2414 S. MacDill Avenue, Tampa, FL 33629" line (parsePlaces text fallback) and an empty tel: link.
        const p = await ctx.getPage("https://www.arworkshop.com/");
        const html = p.html || "";
        const i = html.search(/>\s*FLORIDA\s*</);
        if (i < 0) return [];
        const end = html.indexOf("</ul>", i);
        const links = ctx.linksFrom(html.slice(i, end > i ? end : i + 5000), "https://www.arworkshop.com/", /^https:\/\/www\.arworkshop\.com\/[a-z0-9-]+\/?$/);
        const out: any[] = [];
        for (const u of links) {
          const s = await ctx.getPage(u, 10000);
          if (s.status !== 200) continue;
          const text = s.html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
          const tel = (text.match(/FL\s+3\d{4}\s+(?:[^0-9(]{0,40})?(\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4})/) || [])[1] || null;
          for (const r of ctx.parsePlaces(s.html, u)) out.push({ ...r, phone: r.phone || tel, url: u });
        }
        return out;
      },
    },
    verified: "2026-09-14: site menu FLORIDA block lists 7 studios (Brandon, Naples, Ocala, St. Petersburg, Tallahassee, Tampa, Winter Haven); /tampa/ shows '2414 S. MacDill Avenue, Tampa, FL 33629 813-515-0833' as text. robots.txt: Disallow empty for *, Crawl-delay 10 (honoured with a 10 s gap)",
  },
  // Golf entertainment, mini golf, trampoline parks, arcades, bowling, action parks
  {
    id: "topgolf", brand: "Topgolf", kind: "golf", activity: "golf-entertainment", site: "https://topgolf.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        const p = await ctx.getPage("https://topgolf.com/us/locations-by-state/");
        const at = p.html.indexOf('{"state":"Florida","venues":[');
        if (at < 0) return [];
        // Balanced-brace scan of the embedded {"state":"Florida","venues":[...]} object, respecting strings.
        let depth = 0, inStr = false, esc = false, end = -1;
        for (let i = at; i < p.html.length; i++) {
          const ch = p.html[i];
          if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
          if (ch === '"') inStr = true;
          else if (ch === "{" || ch === "[") depth++;
          else if (ch === "}" || ch === "]") { depth--; if (depth === 0) { end = i + 1; break; } }
        }
        if (end < 0) return [];
        const group = JSON.parse(p.html.slice(at, end)) as { venues?: Record<string, any>[] };
        return (group.venues || [])
          .filter((v) => v.published !== false && !v.upcoming && !v.longterm_close && (v.location_type || "topgolf") === "topgolf")
          .map((v) => ({
            name: null, label: v.name, street: v.address, city: v.city, region: v.state, postal: v.post_code,
            lat: v.latitude, lon: v.longitude, phone: v.phone, url: `https://topgolf.com/us/${v.alias}/`,
          }));
      },
    },
    verified: "2026-09-14: 10 Florida venues (Fort Myers, Jacksonville, Lake Mary, Miami-Doral, Miami Gardens, Orlando, Panama City Beach, Pompano Beach, St. Petersburg, Tampa) in the venue JSON embedded in /us/locations-by-state/, each with street, ZIP, phone and lat/lon",
  },
  {
    id: "driveshack", brand: "Drive Shack", kind: "golf", activity: "golf-entertainment", site: "https://www.driveshack.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        const p = await ctx.getPage("https://www.driveshack.com/locations/");
        const out = [];
        // Cards: <p class="elementor-heading-title ...">1710 Belvedere Rd\nWest Palm Beach, FL 33406</p> ... (561) 771-5354
        const re = /<p class="elementor-heading-title[^"]*">\s*(\d[^<\n]*?)\s*(?:<br\s*\/?>|\n)\s*([A-Za-z .'-]+),\s*([A-Z]{2})\s+(\d{5})\s*<\/p>/g;
        let m;
        while ((m = re.exec(p.html))) {
          if (m[3] !== "FL") continue;
          const nextCard = p.html.indexOf("single-card-location", m.index);
          const tel = p.html.slice(m.index, nextCard > 0 ? nextCard : m.index + 15000).match(/\(\d{3}\) \d{3}-\d{4}/);
          out.push({ name: null, label: m[2].trim(), street: m[1].trim(), city: m[2].trim(), region: m[3], postal: m[4], phone: tel ? tel[0] : null, url: "https://www.driveshack.com/locations/" });
        }
        return out;
      },
    },
    verified: "2026-09-14: 1 Florida venue (West Palm Beach, 1710 Belvedere Rd) of 3 on /locations/; address is plain text with a newline between street and city, so a custom regex maps the card",
  },
  {
    id: "popstroke", brand: "PopStroke", kind: "minigolf", activity: "mini-golf", site: "https://popstroke.com",
    strategy: { type: "crawl", start: ["https://popstroke.com/locations/"], leaf: /^https:\/\/popstroke\.com\/venues\/[a-z0-9-]+\/?$/, max: 40 },
    verified: "2026-09-14: 10 Florida venues of 23 linked from /locations/ (Daytona Beach, Delray Beach, Fort Myers, Orlando, Orlando Waterford Lakes, Palm Beach, Port St Lucie, Sarasota, Tampa Wesley Chapel, Winter Garden Hamlin); venue pages carry JSON-LD LocalBusiness with street, city, region FL, telephone and geo (no postal code)",
  },
  {
    id: "puttshack", brand: "Puttshack", kind: "minigolf", activity: "mini-golf", site: "https://www.puttshack.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        const idx = await ctx.getPage("https://www.puttshack.com/locations/");
        const urls = [...new Set(ctx.linksFrom(idx.html, "https://www.puttshack.com/locations/", /^https:\/\/www\.puttshack\.com\/locations\/[a-z0-9-]+\/?$/).map((u) => u.replace(/\/?$/, "/")))];
        const out = [];
        for (const u of urls) {
          const p = await ctx.getPage(u);
          if (p.status !== 200) continue;
          // No JSON-LD address; the "Get directions" Google Maps link holds "Puttshack - Miami, <street>, <city>, FL 33131/@lat,lon".
          const m = p.html.match(/google\.com\/maps\/dir\/\/([^\/"]+)\/@(-?\d+\.\d+),(-?\d+\.\d+)/);
          if (!m) continue;
          const parts = decodeURIComponent(m[1].replace(/\+/g, " ")).split(/\s*,\s*/);
          const sz = (parts.pop() || "").match(/^([A-Z]{2})\s+(\d{5})/);
          if (!sz || parts.length < 3) continue;
          const city = parts.pop();
          const street = parts.slice(1).join(", ");
          out.push({ name: null, label: parts[0].replace(/^Puttshack\s*[-–]\s*/i, ""), street, city, region: sz[1], postal: sz[2], lat: m[2], lon: m[3], url: u });
        }
        return out;
      },
    },
    verified: "2026-09-14: 2 Florida venues (Dania Beach, Miami Brickell) of 20 US pages linked from /locations/; pages have no address JSON-LD and the text address lacks a street/city comma, so the custom parser reads the Google Maps directions link (name, street, city, FL ZIP, lat/lon)",
  },
  {
    id: "urbanair", brand: "Urban Air", kind: "trampoline", activity: "trampoline-park", site: "https://www.urbanair.com",
    strategy: { type: "sitemap", sitemaps: ["https://www.urbanair.com/gd_place-sitemap.xml"], match: /^https:\/\/www\.urbanair\.com\/florida-[a-z0-9-]+\/$/, max: 40 },
    verified: "2026-09-14: 17 Florida parks in gd_place-sitemap.xml (URLs /florida-<city>/); park pages carry JSON-LD with streetAddress, addressLocality, addressRegion Florida, postalCode, telephone and geo",
  },
  {
    id: "skyzone", brand: "Sky Zone", kind: "trampoline", activity: "trampoline-park", site: "https://www.skyzone.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        // WP Store Locator endpoint behind /locations/; results sorted by distance from central Florida.
        const list = await ctx.getJson("https://www.skyzone.com/wp-admin/admin-ajax.php?action=store_search&lat=28.2&lng=-83.0&max_results=100&search_radius=500");
        if (!Array.isArray(list)) return [];
        return list
          .filter((s) => s.state === "FL" && s.park_type !== "coming-soon")
          .map((s) => {
            const tel = String(s.phone || "").match(/\(?\d{3}\)?[ .-]?\d{3}-\d{4}/);
            return {
              name: null, label: s.store, street: [s.address, s.address2].filter(Boolean).join(", "), city: s.city, region: s.state, postal: s.zip,
              lat: s.lat, lon: s.lng, phone: tel ? tel[0] : null, url: s.park_url || s.url || "https://www.skyzone.com/locations/",
            };
          });
      },
    },
    verified: "2026-09-14: 22 Florida parks in the wpsl store_search JSON (21 open, Orlando Grande Lakes marked coming-soon and skipped), each with street, city, ZIP, lat/lng, phone and park_url; admin-ajax.php is explicitly allowed in robots.txt",
  },
  {
    id: "altitude", brand: "Altitude Trampoline Park", kind: "trampoline", activity: "trampoline-park", site: "https://www.altitudetrampolinepark.com",
    strategy: { type: "sitemap", sitemaps: ["https://www.altitudetrampolinepark.com/sitemap.xml"], match: /\/locations\/(?:florida|fl)\/[a-z0-9-]+\/[a-z0-9-]+\/$/, max: 30 },
    verified: "2026-09-14: 8 Florida parks in sitemap.xml under /locations/florida/<city>/<street>/ (Coral Springs, Tampa, Sanford, Kissimmee, Jacksonville Beach, Bradenton, Spring Hill, West Palm Beach); park pages carry JSON-LD LocalBusiness with street, city, region, postal and telephone",
  },
  {
    id: "launch", brand: "Launch Trampoline Park", kind: "trampoline", activity: "trampoline-park", site: "https://launchfamilyentertainment.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        const p = await ctx.getPage("https://launchfamilyentertainment.com/locations/");
        const html = p.html.replace(/\\\//g, "/");
        const re = /\{"site_id":\d+,"site_name":"([^"]*)","full_site_url":"([^"]*)"[^{}]*?"street":"([^"]*)","city":"([^"]*)","state":"([A-Z]{2})"[^{}]*?"zipcode":"(\d{5})"[^{}]*?"franchise_status":"([a-z-]+)","phone":"([^"]*)"/g;
        const seen = new Set();
        const out = [];
        let m;
        while ((m = re.exec(html))) {
          if (m[5] !== "FL" || m[7] !== "in-operation" || seen.has(m[2])) continue;
          seen.add(m[2]);
          const tels = m[8].match(/\(?\d{3}\)?[ .-]?\d{3}-\d{4}/g);
          out.push({ name: null, label: m[4], street: m[3], city: m[4], region: m[5], postal: m[6], phone: tels ? tels[tels.length - 1] : null, url: m[2] });
        }
        return out;
      },
    },
    verified: "2026-09-14: 3 open Florida parks (Doral, Orlando, Clearwater) plus Pensacola marked coming-soon, in the site JSON embedded in /locations/ (street, city, state, zipcode, franchise_status, phone)",
  },
  {
    id: "mainevent", brand: "Main Event", kind: "arcade", activity: "family-entertainment-center", site: "https://www.mainevent.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        // /locations lists every center only as URLs inside its JSON-LD ItemList (not as hrefs).
        const idx = await ctx.getPage("https://www.mainevent.com/locations");
        const urls = [...new Set(idx.html.match(/https:\/\/www\.mainevent\.com\/locations\/florida\/[a-z0-9-]+\//g) || [])];
        const out = [];
        for (const u of urls) {
          const p = await ctx.getPage(u);
          if (p.status === 200) out.push(...ctx.parsePlaces(p.html, u));
        }
        return out;
      },
    },
    verified: "2026-09-14: 3 Florida centers (Jacksonville, Orlando, Wesley Chapel) in the JSON-LD ItemList on /locations; center pages carry JSON-LD with street, city, FL, ZIP and telephone",
  },
  {
    id: "dnb", brand: "Dave & Buster's", kind: "arcade", activity: "arcade-restaurant", site: "https://www.daveandbusters.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        const idx = await ctx.getPage("https://www.daveandbusters.com/us/en/about/locations");
        const at = idx.html.indexOf(">FLORIDA<");
        if (at < 0) return [];
        const next = idx.html.indexOf("accordion-title", at + 20);
        const seg = idx.html.slice(at, next > 0 ? next : at + 6000);
        const urls = ctx.linksFrom(seg, "https://www.daveandbusters.com/", /\/us\/en\/about\/locations\/[a-z0-9-]+$/);
        const out = [];
        for (const u of urls) {
          const p = await ctx.getPage(u);
          if (p.status === 200) out.push(...ctx.parsePlaces(p.html, u));
        }
        return out;
      },
    },
    verified: "2026-09-14: 10 Florida stores in the FLORIDA accordion of /us/en/about/locations (Daytona Beach, Fort Myers, Gainesville, Hollywood, Jacksonville, Miami, Orlando, Panama City Beach, Port St. Lucie, Tampa Brandon); store pages carry JSON-LD with street, city, FL, ZIP, telephone and geo",
  },
  {
    id: "round1", brand: "Round1", kind: "bowling", activity: "bowling-arcade", site: "https://www.round1usa.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        // The /locations page lists every store as a party-booking link "(PLM) FL, Pembroke Pines" whose code maps to /locations/049plm.
        const idx = await ctx.getPage("https://www.round1usa.com/locations");
        const codes = new Set();
        for (const m of idx.html.matchAll(/ecom\.roller\.app\/(\d{3}[A-Z]{3})\/[^"]*"[^>]*>(?:<span[^>]*>[^<]*<\/span>)?\s*FL,/g)) codes.add(m[1].toLowerCase());
        const out = [];
        for (const c of codes) {
          const u = `https://www.round1usa.com/locations/${c}`;
          const p = await ctx.getPage(u);
          if (p.status !== 200) continue;
          // <h1>Pembroke Lakes Mall</h1><p>12055 Pines Blvd, Pembroke Pines, FL 33026<br>Hours...; the text fallback misses it because "33026Hours" has no word break.
          const m = p.html.match(/<h1[^>]*>([^<]+)<\/h1>\s*<p[^>]*>\s*(\d[^,<]+),\s*([^,<]+),\s*([A-Z]{2})\s+(\d{5})/);
          if (m) out.push({ name: null, label: m[1].trim(), street: m[2].trim(), city: m[3].trim(), region: m[4], postal: m[5], url: u });
        }
        return out;
      },
    },
    verified: "2026-09-14: 1 Florida store (Pembroke Lakes Mall, Pembroke Pines; the store list on /locations has FL only once); store page has no address JSON-LD; the h1 plus '12055 Pines Blvd, Pembroke Pines, FL 33026' paragraph is read by a custom regex (parsePlaces' text fallback misses it because the ZIP runs into 'Hours')",
  },
  {
    id: "bowlero", brand: "Bowlero", kind: "bowling", activity: "bowling", site: "https://www.bowlero.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        const idx = await ctx.getPage("https://www.bowlero.com/locations");
        const at = idx.html.indexOf('">Florida</h5>');
        if (at < 0) return [];
        const seg = idx.html.slice(at, idx.html.indexOf("<h5", at + 20));
        const urls = ctx.linksFrom(seg, "https://www.bowlero.com/", /^https:\/\/www\.bowlero\.com\/(?:en\/)?location\/[a-z0-9-]+$/);
        const out = [];
        for (const u of urls) {
          const p = await ctx.getPage(u);
          if (p.status === 200) out.push(...ctx.parsePlaces(p.html, p.finalUrl || u));
        }
        return out;
      },
    },
    verified: "2026-09-14: 12 Bowlero-hosted Florida centers in the Florida group of bowlero.com/locations (10 Bowlero-named plus Fiesta Bowl and Spanish Springs Lanes); pages carry JSON-LD BowlingAlley with name, street, city, region Florida, ZIP, telephone and geo. The same group also links 12 Lucky Strike and 7 AMF centers (separate entries) plus Big Kahunas, Boomers and Shipwreck Island (not bowling, skipped)",
  },
  {
    id: "luckystrike", brand: "Lucky Strike", kind: "bowling", activity: "bowling", site: "https://www.luckystrikeent.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        const idx = await ctx.getPage("https://www.bowlero.com/locations");
        const at = idx.html.indexOf('">Florida</h5>');
        if (at < 0) return [];
        const seg = idx.html.slice(at, idx.html.indexOf("<h5", at + 20));
        const urls = ctx.linksFrom(seg, "https://www.bowlero.com/", /^https:\/\/www\.luckystrikeent\.com\/location\/[a-z0-9-]+$/);
        const out = [];
        for (const u of urls) {
          const p = await ctx.getPage(u);
          if (p.status === 200) out.push(...ctx.parsePlaces(p.html, u));
        }
        return out;
      },
    },
    verified: "2026-09-14: 12 Florida Lucky Strike centers linked from the Florida group on bowlero.com/locations (Boca Raton, Bradenton, Dania Beach, Davie, East Ocala, Jupiter, Lakeland, Melbourne, Miami, Sarasota, Tamarac, West Ocala); luckystrikeent.com pages carry JSON-LD BowlingAlley with street, city, region, ZIP and telephone",
  },
  {
    id: "amf", brand: "AMF", kind: "bowling", activity: "bowling", site: "https://www.amf.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        const idx = await ctx.getPage("https://www.bowlero.com/locations");
        const at = idx.html.indexOf('">Florida</h5>');
        if (at < 0) return [];
        const seg = idx.html.slice(at, idx.html.indexOf("<h5", at + 20));
        const urls = ctx.linksFrom(seg, "https://www.bowlero.com/", /^https:\/\/www\.amf\.com\/location\/[a-z0-9-]+$/);
        const out = [];
        for (const u of urls) {
          const p = await ctx.getPage(u);
          if (p.status === 200) out.push(...ctx.parsePlaces(p.html, u));
        }
        return out;
      },
    },
    verified: "2026-09-14: 7 Florida AMF centers linked from the Florida group on bowlero.com/locations (Boynton Beach, Deltona, Kissimmee, Leesburg, Margate, Pembroke Pines, Sky Lanes); amf.com pages carry JSON-LD BowlingAlley with name, street, city, region, ZIP, telephone and geo",
  },
  {
    id: "kings", brand: "Kings Dining & Entertainment", kind: "bowling", activity: "bowling", site: "https://www.playatkings.com",
    strategy: { type: "sitemap", sitemaps: ["https://www.playatkings.com/sitemap.xml"], match: /^https:\/\/www\.playatkings\.com\/location\/[a-z0-9-]+\/$/, max: 30 },
    verified: "2026-09-14: 2 Florida venues (Doral, Orlando) of 11 location pages in sitemap.xml; location pages carry JSON-LD FoodEstablishment with streetAddress, addressLocality, addressRegion FL, postalCode and telephone",
  },
  {
    id: "chuckecheese", brand: "Chuck E. Cheese", kind: "arcade", activity: "kids-arcade-birthday-parties", site: "https://www.chuckecheese.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        const list = await ctx.getJson("https://www.chuckecheese.com/wp-json/cec-location/v1/all");
        if (!Array.isArray(list)) return [];
        return list
          .filter((s) => s.region === "FL" && !(s.hours || []).some((h: { day?: string }) => /closed/i.test(String(h.day || ""))))
          .map((s) => ({
            name: null, label: s.name, street: [s.addressLineOne, s.addressLineTwo].filter(Boolean).join(", "), city: s.city, region: s.region, postal: s.zip,
            lat: s.latitude || null, lon: s.longitude || null, phone: s.phone, url: `https://www.chuckecheese.com/${s.slug}/`,
          }));
      },
    },
    verified: "2026-09-14: 32 Florida stores in the site's own /wp-json/cec-location/v1/all JSON (31 open, Orlando Colonial marked Location Permanently Closed and skipped), each with street, city, ZIP, phone and slug; store pages also carry JSON-LD with address and geo",
  },
  {
    id: "dezerland", brand: "Dezerland Park", kind: "kart", activity: "indoor-action-park", site: "https://dezerlandpark.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        const p = await ctx.getPage("https://dezerlandpark.com/contact/");
        const text = p.html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
        const m = text.match(/Address\s+(\d+[^,]{3,60}),\s*([A-Za-z .'-]+?),?\s+(?:FL|Florida)\s+(\d{5})/);
        if (!m) return [];
        const tel = p.html.match(/href="tel:([^"]+)"/);
        return [{ name: "Dezerland Park Orlando", street: m[1].trim(), city: m[2].trim(), region: "FL", postal: m[3], phone: tel ? tel[1] : null, url: "https://dezerlandpark.com/" }];
      },
    },
    verified: "2026-09-14: 1 Florida venue (Dezerland Park Orlando, 5250 International Drive; the former North Miami Dezerland Action Park no longer appears on the site); no address JSON-LD, contact page text 'Address 5250 International Drive, Orlando Florida 32819' plus tel: link, read by a custom regex",
  },
  // Escape rooms, karting, indoor skydiving, amusement parks, climbing
  {
    id: "teg", brand: "The Escape Game", kind: "escape", activity: "escape-room", site: "https://theescapegame.com",
    strategy: {
      type: "sitemap",
      sitemaps: ["https://theescapegame.com/sitemap.xml"],
      match: /^https:\/\/theescapegame\.com\/(orlando|tampa|miami|jacksonville|sunrise|dania-beach|panama-city-beach|fort-lauderdale|kissimmee|st-pete|st-petersburg|clearwater|sarasota|naples|fort-myers|destin|pensacola|tallahassee|gainesville|daytona-beach|west-palm-beach|boca-raton|doral|hollywood|lakeland|melbourne|key-west|disney-springs)\/$/,
      max: 40,
    },
    verified: "2026-09-14: 7 Florida sites in the flat sitemap as top-level city slugs (orlando, tampa, miami, jacksonville, sunrise, dania-beach, panama-city-beach); /orlando/, /sunrise/, /dania-beach/, /panama-city-beach/ each carry JSON-LD LocalBusiness with PostalAddress (addressRegion FL) and telephone. Slugs carry no state, so the match lists Florida city slugs",
  },
  {
    id: "escapology", brand: "Escapology", kind: "escape", activity: "escape-room", site: "https://www.escapology.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        // /en/locations embeds every venue in the Next.js flight payload (escaped JSON): name, slug, address{...}, telephone.
        const page = await ctx.getPage("https://www.escapology.com/en/locations");
        const h = (page.html || "").replace(/\\"/g, '"');
        const out = [];
        const seen = new Set();
        const re = /"name":"([^"]*)","slug":"([a-z0-9-]+)"[^{}]*?"address":(\{[^{}]*\})[^{}]*?"telephone":(?:"([^"]*)"|null)/g;
        for (const m of h.matchAll(re)) {
          let a;
          try {
            a = JSON.parse(m[3]);
          } catch {
            continue;
          }
          if (!a || a.state !== "FL" || seen.has(m[2]) || /coming soon/i.test(a.name || "")) continue;
          seen.add(m[2]);
          out.push({
            name: "Escapology " + m[1].replace(/,?\s*FL$/i, "").trim(),
            street: [a.address, a.address2].filter(Boolean).join(", "),
            city: a.city,
            region: "FL",
            postal: a.postalCode,
            lat: a.latitude,
            lon: a.longitude,
            phone: /\d{3}.*\d{4}/.test(m[4] || "") ? m[4] : null,
            url: "https://www.escapology.com/en/" + m[2],
          });
        }
        return out;
      },
    },
    verified: "2026-09-14: /en/locations embeds 120 venues as JSON in the page payload; 13 have state FL, 11 open (Destin/Miramar Beach, Doral, Fort Lauderdale, Gainesville, Jacksonville, Kissimmee, Lakeland, Orlando I-Drive, Plantation, Sarasota, Tampa Armature Works) plus Viera and Palm Beach Gardens marked Coming Soon, which are skipped. Each has street, city, ZIP, lat/lon and phone",
  },
  {
    id: "breakout", brand: "Breakout Games", kind: "escape", activity: "escape-room", site: "https://breakoutgames.com",
    strategy: {
      type: "sitemap",
      sitemaps: ["https://breakoutgames.com/main_sitemap.xml"],
      match: /^https:\/\/breakoutgames\.com\/(jacksonville|orlando|tampa|miami|fort-lauderdale|pensacola|tallahassee|gainesville|sarasota|naples|fort-myers|destin|panama-city-beach|st-petersburg|clearwater|daytona-beach|west-palm-beach)$/,
      max: 20,
    },
    verified: "2026-09-14: 1 Florida site (Jacksonville) among 29 city roots in main_sitemap.xml; /jacksonville carries JSON-LD EntertainmentBusiness with PostalAddress (7999 Philips Highway, FL 32256) and telephone. Match lists Florida city slugs so new openings are picked up",
  },
  {
    id: "tger", brand: "The Great Escape Room", kind: "escape", activity: "escape-room", site: "https://thegreatescaperoom.com",
    strategy: { type: "sitemap", sitemaps: ["https://thegreatescaperoom.com/locations-sitemap.xml"], match: /\/locations\/[a-z-]+\/$/, max: 30 },
    verified: "2026-09-14: locations-sitemap.xml lists 16 locations, 3 in Florida (orlando, st-pete, tampa). No address in JSON-LD, but the page text has a parseable line, e.g. '2429 Central Avenue, Suite 101, St. Petersburg, FL 33713' and '2 South Magnolia Avenue, Orlando, FL 32801'; no tel: link, so phone stays empty. Out-of-state pages fail the FL text regex and drop",
  },
  {
    id: "k1speed", brand: "K1 Speed", kind: "kart", activity: "indoor-karting", site: "https://www.k1speed.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        // Florida hub page links every Florida track; each track page has a JSON-LD @graph whose location node points at
        // a separate PostalAddress node by @id, which parsePlaces cannot follow, so resolve it here.
        const hub = await ctx.getPage("https://www.k1speed.com/florida.html");
        const links = ctx.linksFrom(hub.html || "", "https://www.k1speed.com/florida.html", /^https:\/\/www\.k1speed\.com\/[a-z0-9-]+-location\.html$/).filter((u) => !/shenzhen/.test(u));
        const out = [];
        for (const url of links) {
          const p = await ctx.getPage(url);
          if (p.status !== 200) continue;
          const nodes = [];
          for (const m of p.html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
            try {
              const d = JSON.parse(m[1]);
              for (const x of [d].flat()) {
                if (x && Array.isArray(x["@graph"])) nodes.push(...x["@graph"]);
                else if (x) nodes.push(x);
              }
            } catch {
              /* skip bad block */
            }
          }
          const byId = new Map(nodes.filter((n) => n && n["@id"]).map((n) => [n["@id"], n]));
          const loc = nodes.find((n) => n && n.address && /SportsActivityLocation|EntertainmentBusiness|LocalBusiness/.test([n["@type"]].flat().join(" ")));
          if (!loc) {
            out.push(...ctx.parsePlaces(p.html, url));
            continue;
          }
          const a = loc.address["@id"] ? byId.get(loc.address["@id"]) || {} : loc.address;
          const g = loc.geo || {};
          out.push({ name: loc.name, street: a.streetAddress, city: a.addressLocality, region: a.addressRegion, postal: a.postalCode, lat: g.latitude, lon: g.longitude, phone: loc.telephone, url: loc.url || url });
        }
        return out;
      },
    },
    verified: "2026-09-14: /florida.html and /locations.html list 7 Florida tracks (Daytona Beach, Fort Lauderdale-Hollywood, Jacksonville, Miami-Medley, Orlando, Riviera Beach, Tampa Bay). Track pages carry JSON-LD @graph SportsActivityLocation with telephone and geo, address given as an @id reference to a PostalAddress node (Orlando: 5228 Vanguard Street, FL 32819)",
  },
  {
    id: "andretti", brand: "Andretti Indoor Karting & Games", kind: "kart", activity: "indoor-karting", site: "https://andrettikarting.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        // /locations renders one card per park: link, two or three address-line paragraphs, tel link.
        const page = await ctx.getPage("https://andrettikarting.com/locations");
        const out = [];
        for (const chunk of (page.html || "").split('class="location-wrapper').slice(1)) {
          const link = chunk.match(/<a href="(\/[a-z-]+)"[^>]*>\s*([^<]+?)\s*<\/a>/);
          const lines = [...chunk.matchAll(/<p class="address-line">\s*([^<]+?)\s*<\/p>/g)].map((m) => m[1]);
          const csz = (lines.pop() || "").match(/^(.*?),\s*([A-Z]{2})\s+(\d{5})/);
          if (!link || !csz || !lines.length) continue;
          const tel = chunk.match(/href="tel:([^"]+)"/);
          out.push({ label: csz[1], street: lines.join(", "), city: csz[1], region: csz[2], postal: csz[3], phone: tel ? tel[1] : null, url: "https://andrettikarting.com" + link[1] });
        }
        return out;
      },
    },
    verified: "2026-09-14: /locations lists 14 parks with address lines and tel links; 1 in Florida (Orlando, 9299 Universal Blvd, FL 32819, 407-610-5020). Location pages have no JSON-LD address and the street and city sit in separate paragraphs, so parsePlaces text fallback would miss it",
  },
  {
    id: "ifly", brand: "iFLY Indoor Skydiving", kind: "skydive", activity: "indoor-skydiving", site: "https://www.iflyworld.com",
    strategy: {
      type: "sitemap",
      sitemaps: ["https://www.iflyworld.com/sitemap.xml"],
      match: /^https:\/\/www\.iflyworld\.com\/(orlando|tampa|miami|fort-lauderdale|jacksonville|naples|fort-myers|sarasota|west-palm-beach|palm-beach|boca-raton|st-pete|st-petersburg|clearwater|pensacola|tallahassee|gainesville|daytona|kissimmee|destin|panama-city)(-[a-z]+)?$/,
      max: 15,
    },
    verified: "2026-09-14: 5 Florida tunnels in the sitemap as top-level slugs (orlando, tampa, miami, fort-lauderdale, jacksonville) among ~40 locations; /orlando carries JSON-LD with PostalAddress (8969 International Drive, FL 32819), telephone and geo. Pages are ~1.2 MB each, so the match lists Florida city slugs instead of fetching every tunnel",
  },
  {
    id: "funspot", brand: "Fun Spot America", kind: "themepark", activity: "amusement-park", site: "https://fun-spot.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        // Home page has one block per park: Google Maps embed (!2d lon !3d lat), <h1>Park</h1>, address paragraph, tel link.
        const page = await ctx.getPage("https://fun-spot.com/");
        const html = page.html || "";
        const out = [];
        for (const m of html.matchAll(/!2d(-?[\d.]+)!3d(-?[\d.]+)[^"]*"[\s\S]{0,400}?<h1[^>]*>([^<]+)<\/h1>\s*<p>[\s\S]*?<\/span>\s*([^<]+?)<\/p>\s*<p><a href="tel:([^"]+)"/g)) {
          const parts = m[4].split(",").map((s) => s.trim());
          const sz = (parts.pop() || "").match(/^([A-Z]{2})\s+(\d{5})/);
          if (!sz || parts.length < 2) continue;
          const city = parts.pop();
          const label = m[3].trim();
          out.push({ name: "Fun Spot America " + label, street: parts.join(", "), city, region: sz[1], postal: sz[2], lat: m[2], lon: m[1], phone: m[5], url: "https://fun-spot.com/" + label.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "/" });
        }
        return out;
      },
    },
    verified: "2026-09-14: 2 Florida parks on the home page (Orlando, 5700 Fun Spot Way, FL 32819; Kissimmee, 2850 Florida Plaza Blvd, FL 34746) with map-embed coordinates and phone 407.363.3867; the Atlanta park is outside Florida. No JSON-LD address, and the text fallback returns the Orlando line on every page, so Kissimmee needs this mapping",
  },
  {
    id: "crg", brand: "Central Rock Gym", kind: "climbing", activity: "climbing-gym", site: "https://centralrockgym.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        // Each gym is a WordPress subsite (centralrockgym.com/<slug>/). Only Florida slugs are fetched; the robots.txt
        // Sitemap lines are the canonical list, so new Florida gyms are found by matching Florida city words in the slug.
        const robots = await ctx.getPage("https://centralrockgym.com/robots.txt");
        const slugs = [...new Set([...(robots.html || "").matchAll(/centralrockgym\.com\/([a-z0-9-]+)\/sitemap_index\.xml/g)].map((m) => m[1]))];
        const fl = /^(fort-myers|orlando|citrus-park|tampa|miami|jacksonville|sarasota|naples|st-pete|st-petersburg|clearwater|brandon|lakeland|gainesville|tallahassee|pensacola|kissimmee|boca-raton|fort-lauderdale|west-palm-beach|melbourne|daytona|wesley-chapel|estero|cape-coral|bradenton|ocala)/;
        const list = slugs.filter((s) => fl.test(s));
        if (!list.length) list.push("fort-myers", "orlando", "citrus-park", "tampa");
        const out = [];
        for (const slug of list) {
          const url = "https://centralrockgym.com/" + slug + "/";
          const p = await ctx.getPage(url);
          if (p.status !== 200) continue;
          const m = p.html.match(/acc-header">\s*Address\s*<\/div>\s*<div class="acc-body">\s*<p>([\s\S]*?)<\/p>/);
          if (!m) {
            out.push(...ctx.parsePlaces(p.html, url));
            continue;
          }
          const lines = m[1].split(/<br\s*\/?>/i).map((s) => s.replace(/<[^>]+>/g, "").trim()).filter(Boolean);
          const last = (lines.pop() || "").match(/^(.*?),\s*([A-Za-z ]+?)\.?\s+(\d{5})/);
          if (!last || !lines.length) continue;
          const geo = p.html.match(/maps\?q=(-?[\d.]+),\s*(-?[\d.]+)/);
          const tel = p.html.match(/href="tel:([^"]+)"/);
          const title = (p.html.match(/<title>\s*(?:Home\s*-\s*)?([^<|]+)/) || [])[1];
          out.push({ label: title ? title.trim() : null, street: lines.join(", "), city: last[1], region: last[2], postal: last[3], lat: geo ? geo[1] : null, lon: geo ? geo[2] : null, phone: tel ? tel[1] : null, url });
        }
        return out;
      },
    },
    verified: "2026-09-14: robots.txt lists 29 gym subsites, 4 in Florida (fort-myers, orlando, citrus-park, tampa). Subsite home pages have no JSON-LD address but an Address accordion ('6150 Exchange Ln.<br/> Fort Myers, Florida 33912'; Citrus Park '6918 Gunn Highway, Tampa, Florida 33625') with a maps?q=lat,lon link and tel link. robots.txt sets Crawl-delay 10",
  },
  // Massage, stretching, boutique fitness, yoga
  {
    id: "handstone", brand: "Hand & Stone", kind: "spa", activity: "massage", site: "https://handandstone.com",
    strategy: {
      type: "sitemap",
      sitemaps: ["https://handandstone.com/sitemap.xml"],
      // Location URLs carry no state and the locator reads /api/* (robots-disallowed), so the Florida slugs are listed from the sitemap by hand. A few names shared with other states (hollywood, seminole, gainesville, trinity, bloomingdale, edgewater, englewood) are included; isFlorida drops the out-of-state ones. New Florida openings need adding here.
      match: /\/locations\/(apopka-hunt-club-corners|boca-raton|boca-raton-del-mar|boca-raton-east|boynton-beach|brandon|cape-coral|carrollwood|clearwater|clermont-landing|coral-springs|davie|daytona-beach|deland|delray-beach|destin|doral|downtown-miami|estero-corkscrew-village|fleming-island|fort-lauderdale-17th-st-causeway|fort-lauderdale-n-federal-hwy|fort-myers|gainesville|gibsonton-riverview|hollywood|jacksonville-atlantic|jacksonville-beach|jacksonville-mandarin|jacksonville-mandarin-north|jacksonville-northpoint-village|jacksonville-st-johns-tc|jupiter|kendall|kissimmee|lake-mary|lake-mary-east|lakeland|longwood|melbourne|miami-lakes|miami-west-kendall|mount-dora|naples-founders-square|naples-mercato|north-miami-beach|ocala|orlando-downtown|orlando-dr-phillips|orlando-of-lake-nona|orlando-waterford-lakes|oviedo|palm-beach-gardens|palm-city|palm-coast|palm-coast-parkway|palm-harbor-boot-ranch|palmetto-bay|panama-city-beach|pembroke-pines|poinciana|port-orange|port-st-lucie|port-st-lucie-east-port|punta-gorda|rockledge-viera-2|saint-johns-durbin-park|sarasota|seminole|south-miami|south-naples|spring-hill|st-augustine|st-petersburg|sunrise-sawgrass|tallahassee|tampa-citrus-park|tampa-south-tampa|temple-terrace|the-villages-sarasota-plaza|the-villages-southern-trace|trinity|vero-beach|w-palm-beach-shoppes-at-ibis|wellington|wesley-chapel|west-melbourne|weston|windermere|winter-garden-colonial|winter-garden-horizon-west|winter-haven|winter-park-village|winter-springs|bloomingdale|edgewater|englewood)\/$/,
      max: 110,
    },
    verified: "2026-09-14: about 90 Florida spas among 652 /locations/<slug>/ URLs in sitemap-0.xml (97 slugs selected, a handful are same-named towns elsewhere); pages have no address JSON-LD but the hero reads '11009 Causeway Blvd, Brandon, FL 33511' with a tel: link, which the text fallback parses (checked on /locations/brandon/)",
  },
  {
    id: "massageenvy", brand: "Massage Envy", kind: "spa", activity: "massage", site: "https://www.massageenvy.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        // The state directory page (locations.massageenvy.com/florida.html) fills itself from this SOCi endpoint; one POST returns every Florida clinic.
        const data = await ctx.getJson<{ code?: number; response?: { collection?: Record<string, unknown>[] } }>(
          "https://llp-renderer.meetsoci.com/massageenvy/rest/getlist",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ request: { appkey: "0B1F77E6-A2B2-4689-9C59-B227824AF3AA", formdata: { objectname: "Locator", limit: 1000, order: "city", where: { state: { eq: "FL" } } } } }),
          },
        );
        const out: RawPlace[] = [];
        for (const x of data?.response?.collection || []) {
          if (String(x["Hide Local Page"] || "").toUpperCase() === "YES") continue;
          const s = (k: string) => (x[k] == null ? null : String(x[k]));
          const street = [s("address1"), s("address2")].filter(Boolean).join(", ");
          out.push({
            name: s("name"),
            street: street || null,
            city: s("city"),
            region: s("state"),
            postal: s("postalcode"),
            lat: s("latitude"),
            lon: s("longitude"),
            phone: s("phone"),
            url: s("website") || (Array.isArray(x.links) ? String(x.links[0]) : null),
          });
        }
        return out;
      },
    },
    verified: "2026-09-14: 112 Florida clinics from the SOCi getlist endpoint used by locations.massageenvy.com/florida.html (where state eq FL); each row has address1/2, city, state, postalcode, latitude/longitude, phone and the local page URL; none flagged 'Hide Local Page'",
  },
  {
    id: "nowmassage", brand: "The NOW Massage", kind: "spa", activity: "massage", site: "https://www.thenowmassage.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        // /boutiques embeds every boutique as one JSON array: `let allLocations = [...]`.
        const url = "https://www.thenowmassage.com/boutiques";
        const p = await ctx.getPage(url);
        if (p.status !== 200) return [];
        const m = p.html.match(/let allLocations = (\[.*\]);?\s*\n/);
        if (!m) return [];
        let list: Record<string, unknown>[] = [];
        try {
          list = JSON.parse(m[1]);
        } catch {
          return [];
        }
        const out: RawPlace[] = [];
        for (const x of list) {
          if (x.state !== "FL" || (x.open_status && x.open_status !== "open")) continue;
          const s = (k: string) => (x[k] == null || x[k] === "" ? null : String(x[k]));
          out.push({
            name: s("name") ? `The NOW ${s("name")}` : null,
            label: s("name"),
            street: [s("address"), s("address2")].filter(Boolean).join(", ") || null,
            city: s("city"),
            region: "FL",
            postal: s("zip"),
            lat: (x.coords as { lat?: number } | undefined)?.lat ?? null,
            lon: (x.coords as { long?: number } | undefined)?.long ?? null,
            phone: s("phone_number"),
            url: s("slug") ? `https://www.thenowmassage.com/boutique/${s("slug")}` : url,
          });
        }
        return out;
      },
    },
    verified: "2026-09-14: 10 Florida boutiques (Wynwood, Pinecrest, Fort Lauderdale, Plantation, Downtown Orlando, Maitland, Winter Garden, Bradenton, Jacksonville Town Center, Julington Creek) in the allLocations JSON on /boutiques (104 total, all open), with address, city, zip, lat/long and phone; boutique pages also carry HealthAndBeautyBusiness JSON-LD",
  },
  {
    id: "stretchlab", brand: "StretchLab", kind: "fitness", activity: "assisted-stretching", site: "https://www.stretchlab.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        // Xponential members API behind the site's location search; one call returns every studio with state.
        const d = await ctx.getJson<{ locations?: Record<string, unknown>[] }>("https://members.stretchlab.com/api/brands/stretchlab/locations?open_status=external&lat=28.0&lng=-82.0&limit=2000");
        const out: RawPlace[] = [];
        for (const x of d?.locations || []) {
          if (x.state !== "FL" || x.open_status !== "open" || x.is_external) continue;
          const s = (k: string) => (x[k] == null || x[k] === "" ? null : String(x[k]));
          out.push({ name: `StretchLab ${s("name")}`, label: s("name"), street: [s("address"), s("address2")].filter(Boolean).join(", ") || null, city: s("city"), region: "FL", postal: s("zip"), lat: s("lat"), lon: s("lng"), phone: s("phone"), url: (s("site_url") || "").replace(/^http:\/\/(www\.)?/, "https://www.") || null });
        }
        return out;
      },
    },
    verified: "2026-09-14: 27 open Florida studios from members.stretchlab.com/api/brands/stretchlab/locations (495 total); same 27 FL rows appear in the JSON embedded in /location-search; rows carry address, city, zip, lat/lng, phone and site_url",
  },
  {
    id: "orangethry", brand: "Orangetheory Fitness", kind: "fitness", activity: "hiit-class", site: "https://www.orangetheory.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        // Studio URLs carry the state (/en-us/locations/altamonte-florida-0167). Pages have no address JSON-LD; the studio fields sit in inline `const cmsX = ...` script variables.
        const locs = (await ctx.sitemapLocs("https://www.orangetheory.com/en-us/sitemap.xml")).filter((u) => /\/en-us\/locations\/[a-z0-9-]+-florida-\d+\/?$/.test(u));
        const out: RawPlace[] = [];
        for (const url of locs.slice(0, 160)) {
          const p = await ctx.getPage(url);
          if (p.status !== 200) continue;
          const h = p.html;
          const v = (k: string): string | null => {
            const m = h.match(new RegExp(`const ${k} = (?:decodeCmsField\\()?'((?:[^'\\\\]|\\\\.)*)'`));
            return m && m[1].trim() ? m[1].trim() : null;
          };
          const n = (k: string): string | null => {
            const m = h.match(new RegExp(`const ${k} = (-?[\\d.]+)`));
            return m ? m[1] : null;
          };
          const status = v("cmsStudioStatus") || "";
          if (/closed|inactive/i.test(status)) continue;
          const label = (v("cmsStudioName") || "").replace(/,\s*FL$/i, "") || null;
          out.push({ name: label ? `Orangetheory Fitness ${label}` : null, label, street: v("cmsAddress"), city: v("cmsCity"), region: v("cmsState"), postal: v("cmsPostalCode"), lat: n("cmsLatitude"), lon: n("cmsLongitude"), phone: v("cmsPhone"), url });
        }
        return out;
      },
    },
    verified: "2026-09-14: 106 Florida studio URLs (-florida-NNNN) among 1245 location URLs in /en-us/sitemap.xml; studio page (altamonte-florida-0167) has cmsAddress '397 E Altamonte Dr Suite 1450', cmsCity, cmsState 'FL', cmsPostalCode, cmsLatitude/Longitude, cmsPhone, cmsStudioStatus 'Active' as inline script constants",
  },
  {
    id: "f45", brand: "F45 Training", kind: "fitness", activity: "hiit-class", site: "https://f45training.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        // /find-a-studio/ embeds every studio worldwide as `const G_STUDIOS = [...]` objects with state, country_code and a one-line address.
        const p = await ctx.getPage("https://f45training.com/find-a-studio/");
        if (p.status !== 200) return [];
        const out: RawPlace[] = [];
        for (const m of p.html.matchAll(/\{"id":\d+,"code":"[^"]*","slug":"[^"]*",[^{}]*\}/g)) {
          let x: Record<string, unknown>;
          try {
            x = JSON.parse(m[0]);
          } catch {
            continue;
          }
          if (x.country_code !== "US" || x.state !== "FL" || (x.status != null && Number(x.status) !== 1)) continue;
          const addr = String(x.address || "").replace(/,\s*(United States|USA)\s*$/i, "");
          const a = addr.match(/^(.*?)\s*,\s*([A-Za-z .'-]+?),?\s+FL\.?,?\s*(\d{5})?/);
          out.push({
            name: x.name ? String(x.name) : null,
            street: a ? a[1] : addr || null,
            city: a ? a[2] : null,
            region: "FL",
            postal: a && a[3] ? a[3] : null,
            lat: x.lat as number,
            lon: x.lng as number,
            url: `https://f45training.com/studio/${x.slug}/`,
          });
        }
        return out;
      },
    },
    verified: "2026-09-14: 71 active Florida studios (state FL, country_code US, status 1) among 1319 in the G_STUDIOS JSON on /find-a-studio/; each has name, lat/lng and an address line like '7500 NW 104th Ave , Doral, FL 33178, United States' (no phone)",
  },
  {
    id: "solidcore", brand: "[solidcore]", kind: "fitness", activity: "pilates", site: "https://solidcore.co",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        // /studios lists all 193 studios as Webflow items with data-url, data-lat, data-lng, data-name and data-address.
        const p = await ctx.getPage("https://solidcore.co/studios");
        if (p.status !== 200) return [];
        const out: RawPlace[] = [];
        for (const m of p.html.matchAll(/data-url="([^"]*)"[^>]*?data-lat="([^"]*)"[^>]*?data-lng="([^"]*)"[^>]*?data-name="([^"]*)"[^>]*?data-address="([^"]*)"/g)) {
          const addr = m[5].replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
          if (!/\b(FL|Florida)\b\.?,?\s+3\d{4}/.test(addr)) continue;
          const a = addr.match(/^(.*?)\s*,\s*([A-Za-z .'-]+?),\s*(?:FL|Florida)\.?,?\s+(\d{5})/);
          const b = a ? null : addr.match(/^(.*?),?\s+(?:FL|Florida)\.?,?\s+(\d{5})/);
          out.push({
            name: `[solidcore] ${m[4]}`,
            label: m[4],
            street: a ? a[1] : b ? b[1] : null,
            city: a ? a[2] : null,
            region: "FL",
            postal: a ? a[3] : b ? b[2] : null,
            lat: m[2],
            lon: m[3],
            url: m[1],
          });
        }
        return out;
      },
    },
    verified: "2026-09-14: 15 Florida studios on solidcore.co/studios (Aventura, Boca Raton, Brickell, Coral Gables, Delray Beach, Dr. Phillips, Edge District, Hyde Park, Las Olas, Midtown Miami, Riverside, Sunset Harbour, West Palm Beach, Water Street, Winter Park) from data-address/data-lat/data-lng attributes; two addresses lack the comma before the city so the street keeps the city name",
  },
  {
    id: "corepower", brand: "CorePower Yoga", kind: "yoga", activity: "hot-yoga", site: "https://www.corepoweryoga.com",
    strategy: { type: "sitemap", sitemaps: ["https://www.corepoweryoga.com/sitemap.xml"], match: /\/yoga-studios\/fl\/[a-z0-9-]+\/[a-z0-9-]+\/?$/, max: 40 },
    verified: "2026-09-14: 3 Florida studios in sitemap-0.xml under /yoga-studios/fl/miami/ (Midtown Miami, Coral Gables, Brickell); studio page has HealthClub JSON-LD with PostalAddress (25 SW 9th Street, Miami, FL 33130), telephone and geo",
  },
  {
    id: "hotworx", brand: "HOTWORX", kind: "fitness", activity: "infrared-sauna-workout", site: "https://www.hotworx.net",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        // /locations is a Webflow list, 100 studios a page sorted by city, paged with ?e9ea8dc6_page=N. Titles read "City, FL (Area)".
        const out: RawPlace[] = [];
        for (let page = 1; page <= 15; page++) {
          const url = page === 1 ? "https://www.hotworx.net/locations" : `https://www.hotworx.net/locations?e9ea8dc6_page=${page}`;
          const p = await ctx.getPage(url);
          if (p.status !== 200) break;
          const parts = p.html.split('role="listitem" class="maps-locations-item');
          if (parts.length < 2) break;
          for (let i = 1; i < parts.length; i++) {
            const it = parts[i];
            const title = (it.match(/sidebar__location-title">([^<]*)/) || [])[1] || "";
            const tm = title.replace(/&amp;/g, "&").match(/^(.*?),\s*FL\b\s*(?:\((.*)\))?/);
            if (!tm) continue;
            const geo = parts[i - 1].slice(-300).match(/jb-latitude="([^"]*)" jb-longitude="([^"]*)"\s*$/);
            const addr = ((it.match(/sidebar__location-address">([^<]*)/) || [])[1] || "").replace(/&amp;/g, "&").replace(/\s+/g, " ").replace(/,?\s*USA\s*$/i, "").trim();
            const slug = (it.match(/jetboost-list-item" value="([^"]*)"/) || [])[1];
            const zip = (addr.match(/\b(?:FL|Florida)\.?,?\s*(3\d{4})\s*$/) || [])[1] || null;
            let city = tm[1].trim();
            let street = addr.replace(/,?\s*(?:FL|Florida)\.?,?\s*(?:3\d{4})?\s*$/, "").trim();
            const withComma = addr.match(/^(.*?),\s*([A-Za-z .'-]+),\s*(?:FL|Florida)\.?,?\s*(?:3\d{4})?\s*$/);
            if (withComma) {
              street = withComma[1].trim();
              city = withComma[2].trim();
            } else if (street.toLowerCase().endsWith(city.toLowerCase())) {
              street = street.slice(0, street.length - city.length).replace(/[,\s]+$/, "");
            }
            out.push({
              name: `HOTWORX ${tm[2] ? `${tm[1].trim()} (${tm[2]})` : tm[1].trim()}`,
              label: tm[2] || tm[1].trim(),
              street: street || null,
              city,
              region: "FL",
              postal: zip,
              lat: geo ? geo[1] : null,
              lon: geo ? geo[2] : null,
              url: slug ? `https://www.hotworx.net/studio/${slug}` : url,
            });
          }
          if (!new RegExp(`e9ea8dc6_page=${page + 1}"`).test(p.html)) break;
        }
        return out;
      },
    },
    verified: "2026-09-14: 71 Florida studios (titles 'City, FL') across the 10 pages of hotworx.net/locations (963 studios, 100 per page); items carry jb-latitude/jb-longitude, the address line and the /studio/<slug> key; 13 FL rows have an address without ZIP, kept via region FL and coordinates",
  },
  {
    id: "clubpilates", brand: "Club Pilates", kind: "fitness", activity: "pilates", site: "https://www.clubpilates.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        const d = await ctx.getJson<{ locations?: Record<string, unknown>[] }>("https://members.clubpilates.com/api/brands/clubpilates/locations?open_status=external&lat=28.0&lng=-82.0&limit=2000");
        const out: RawPlace[] = [];
        for (const x of d?.locations || []) {
          if (x.state !== "FL" || x.open_status !== "open" || x.is_external || x.la_fitness) continue;
          const s = (k: string) => (x[k] == null || x[k] === "" ? null : String(x[k]));
          out.push({ name: `Club Pilates ${s("name")}`, label: s("name"), street: [s("address"), s("address2")].filter(Boolean).join(", ") || null, city: s("city"), region: "FL", postal: s("zip"), lat: s("lat"), lon: s("lng"), phone: s("phone"), url: (s("site_url") || "").replace(/^http:\/\/(www\.)?/, "https://www.") || null });
        }
        return out;
      },
    },
    verified: "2026-09-14: 118 open Florida studios (plus 9 coming soon, skipped) of 1402 from members.clubpilates.com/api/brands/clubpilates/locations, the endpoint the site's location search calls (apiBaseURL in template_script.min.js); rows carry address, city, zip, lat/lng, phone, site_url",
  },
  {
    id: "yogasix", brand: "YogaSix", kind: "yoga", activity: "yoga-class", site: "https://www.yogasix.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        const d = await ctx.getJson<{ locations?: Record<string, unknown>[] }>("https://members.yogasix.com/api/brands/yogasix/locations?open_status=external&lat=28.0&lng=-82.0&limit=2000");
        const out: RawPlace[] = [];
        for (const x of d?.locations || []) {
          if (x.state !== "FL" || x.open_status !== "open" || x.is_external) continue;
          const s = (k: string) => (x[k] == null || x[k] === "" ? null : String(x[k]));
          out.push({ name: `YogaSix ${s("name")}`, label: s("name"), street: [s("address"), s("address2")].filter(Boolean).join(", ") || null, city: s("city"), region: "FL", postal: s("zip"), lat: s("lat"), lon: s("lng"), phone: s("phone"), url: (s("site_url") || "").replace(/^http:\/\/(www\.)?/, "https://www.") || null });
        }
        return out;
      },
    },
    verified: "2026-09-14: 12 open Florida studios (plus 1 coming soon) of 197 from members.yogasix.com/api/brands/yogasix/locations (same Xponential API as Club Pilates); rows carry address, city, zip, lat/lng, phone, site_url",
  },
  {
    id: "elements", brand: "Elements Massage", kind: "spa", activity: "massage", site: "https://elementsmassage.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        // /locator is the JSON the find-a-studio page calls; a state query ("Florida, United States") returns that state's studios.
        const d = await ctx.getJson<{ locations?: Record<string, unknown>[] }>("https://elementsmassage.com/locator?q=Florida%2C+United+States&lat=28.1&lng=-81.6&limit=500", { headers: { "x-requested-with": "XMLHttpRequest" } });
        const out: RawPlace[] = [];
        for (const x of d?.locations || []) {
          if (x.state !== "FL" || String(x.active) !== "1" || (x.status && x.status !== "open")) continue;
          const s = (k: string) => (x[k] == null || x[k] === "" ? null : String(x[k]));
          out.push({ name: `Elements Massage ${s("name")}`, label: s("name"), street: [s("address"), s("address_2")].filter(Boolean).join(", ") || null, city: s("city"), region: "FL", postal: s("zip_code"), lat: s("latitude"), lon: s("longitude"), phone: s("phone_number"), url: s("slug") ? `https://elementsmassage.com/${s("slug")}` : null });
        }
        return out;
      },
    },
    verified: "2026-09-14: 8 open Florida studios (Boca Raton, Bradenton, Coral Springs, Delray Beach, Melbourne, Pinecrest, Stuart, University Park) from elementsmassage.com/locator?q=Florida, United States (regionQuery true, locationCount 8); rows carry address, city, zip_code, latitude/longitude, phone_number and slug",
  },
  {
    id: "rumble", brand: "Rumble Boxing", kind: "fitness", activity: "boxing-class", site: "https://www.rumbleboxinggym.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        const d = await ctx.getJson<{ locations?: Record<string, unknown>[] }>("https://members.rumbleboxinggym.com/api/brands/rumble/locations?open_status=external&lat=28.0&lng=-82.0&limit=2000");
        const out: RawPlace[] = [];
        for (const x of d?.locations || []) {
          if (x.state !== "FL" || x.open_status !== "open" || x.is_external) continue;
          const s = (k: string) => (x[k] == null || x[k] === "" ? null : String(x[k]));
          out.push({ name: `Rumble Boxing ${s("name")}`, label: s("name"), street: [s("address"), s("address2")].filter(Boolean).join(", ") || null, city: s("city"), region: "FL", postal: s("zip"), lat: s("lat"), lon: s("lng"), phone: s("phone"), url: (s("site_url") || "").replace(/\?.*$/, "") || null });
        }
        return out;
      },
    },
    verified: "2026-09-14: 5 open Florida studios of 68 from members.rumbleboxinggym.com/api/brands/rumble/locations (Xponential API, same shape as Club Pilates/StretchLab/YogaSix)",
  },
  // Trolley, ghost, food and segway tours
  {
    id: "otttrolley", brand: "Old Town Trolley Tours", kind: "tour", activity: "trolley-tour", site: "https://www.trolleytours.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        // No ticket-office street is published (the only address on every page is the Historic Tours of America HQ footer), so emit the city only when its city page is live.
        const cities = [
          { slug: "key-west", city: "Key West" },
          { slug: "st-augustine", city: "St. Augustine" },
        ];
        const out: RawPlace[] = [];
        for (const c of cities) {
          const url = `https://www.trolleytours.com/${c.slug}`;
          const p = await ctx.getPage(url);
          if (p.status !== 200) continue;
          if (!p.html.includes(c.city)) continue;
          out.push({ name: `Old Town Trolley Tours ${c.city}`, label: c.city, city: c.city, region: "FL", url });
        }
        return out;
      },
    },
    verified: "2026-09-14: 2 Florida cities (Key West, St. Augustine) - the sitemap index lists key-west-sitemap.xml and st-augustine-sitemap.xml among 9 cities, both city pages return 200; pages have no location JSON-LD and the only street on them is the HQ footer (201 Front Street, Key West), so the entry is city-only",
  },
  {
    id: "ghostsgrave", brand: "Ghosts & Gravestones", kind: "tour", activity: "ghost-tour", site: "https://www.ghostsandgravestones.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        const cities = [
          { slug: "key-west", city: "Key West" },
          { slug: "st-augustine", city: "St. Augustine" },
        ];
        const out: RawPlace[] = [];
        for (const c of cities) {
          const url = `https://www.ghostsandgravestones.com/${c.slug}`;
          const p = await ctx.getPage(url);
          if (p.status !== 200 || !p.html.toLowerCase().includes(c.city.toLowerCase())) continue;
          const text = p.html
            .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&#8217;|&rsquo;/g, "'")
            .replace(/&nbsp;|&#160;/g, " ")
            .replace(/\s+/g, " ");
          // "Ghosts & Gravestones Frightseeing Tour boards at the Welcome Center, 27 San Marco Ave."
          const m = text.match(/boards at[^0-9]{0,80}?(\d{1,5} [A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)* (?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd))\b/);
          out.push({ name: `Ghosts & Gravestones ${c.city}`, label: c.city, street: m ? m[1] : null, city: c.city, region: "FL", url });
        }
        return out;
      },
    },
    verified: "2026-09-14: 2 Florida cities - sitemap index lists key-west and st-augustine among 6 cities; city pages say the tour boards at the Conch Tour Train Depot, 501 Front Street (Key West) and the Welcome Center, 27 San Marco Ave (St. Augustine); no location JSON-LD, so the boarding street is read from that sentence",
  },
  {
    id: "ghostcity", brand: "Ghost City Tours", kind: "tour", activity: "ghost-tour", site: "https://ghostcitytours.com",
    strategy: {
      type: "page",
      urls: [
        "https://ghostcitytours.com/key-west/",
        "https://ghostcitytours.com/st-augustine/",
        "https://ghostcitytours.com/jacksonville/",
        "https://ghostcitytours.com/ybor-city/",
      ],
    },
    verified: "2026-09-14: 4 Florida cities in sitemap.xml city directories (key-west, st-augustine, jacksonville, ybor-city of 57 cities); each city page carries JSON-LD TravelAgency with PostalAddress (Key West has 401 Duval Street 33040; Ybor City gives Tampa FL, Jacksonville gives Jacksonville FL, city only) and telephone",
  },
  {
    id: "usghostadv", brand: "US Ghost Adventures", kind: "tour", activity: "ghost-tour", site: "https://usghostadventures.com",
    strategy: {
      type: "page",
      urls: [
        "https://usghostadventures.com/daytona-beach-ghost-tour/",
        "https://usghostadventures.com/fort-lauderdale-ghost-tour/",
        "https://usghostadventures.com/jacksonville-ghost-tour/",
        "https://usghostadventures.com/key-west-ghost-tour/",
        "https://usghostadventures.com/miami-ghost-tour/",
        "https://usghostadventures.com/orlando-ghost-tour/",
        "https://usghostadventures.com/pensacola-ghost-tour/",
        "https://usghostadventures.com/st-augustine-ghost-tour/",
        "https://usghostadventures.com/st-petersburg-ghost-tour/",
        "https://usghostadventures.com/tampa-ghost-tour/",
      ],
    },
    verified: "2026-09-14: 10 Florida city pages in sitemap.xml (of 269 *-ghost-tour city pages; jacksonville-or is Oregon and excluded); Tampa and Pensacola pages carry JSON-LD LocalBusiness with street, ZIP, phone and geo (711 N. Franklin Street 33602; 118 South Palafox Street 32502); Jacksonville's JSON-LD is malformed but the text fallback reads 6 Beach Blvd, Jacksonville Beach, FL 32250",
  },
  {
    id: "secretfood", brand: "Secret Food Tours", kind: "tour", activity: "food-tour", site: "https://www.secretfoodtours.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        // City pages give JSON-LD with addressLocality only (no state, so Naples FL and Naples Italy look alike);
        // the food-tour page under each city has "We'll meet at ..., Tampa, FL 33605", which the text parser reads.
        const flSlugs = /^https:\/\/www\.secretfoodtours\.com\/(tampa|miami|miami-beach|orlando|fort-lauderdale|key-west|st-petersburg|sarasota|west-palm-beach|palm-beach|jacksonville|clearwater|fort-myers|naples|st-augustine|pensacola|destin|daytona-beach|boca-raton|delray-beach|cocoa-beach|kissimmee|winter-park|tallahassee|gainesville)\/food-tours-[a-z-]+\/$/;
        const locs = (await ctx.sitemapLocs("https://www.secretfoodtours.com/sitemap.xml")).filter((u) => flSlugs.test(u));
        const out: RawPlace[] = [];
        const seenCity = new Set();
        for (const url of locs.slice(0, 20)) {
          const p = await ctx.getPage(url);
          if (p.status !== 200) continue;
          for (const r of ctx.parsePlaces(p.html, url)) {
            const region = (r.region || "").toLowerCase();
            if (!(region === "fl" || region === "florida" || /^3[234]\d{3}/.test(r.postal || ""))) continue;
            const city = (r.city || "").toLowerCase();
            if (!city || seenCity.has(city)) continue;
            seenCity.add(city);
            out.push({ ...r, name: `Secret Food Tours ${r.city}`, label: r.city, region: "FL", url });
          }
        }
        return out;
      },
    },
    verified: "2026-09-14: 5 Florida cities with bookable food-tour pages in sitemap.xml (tampa, miami x2 neighbourhoods, orlando, fort-lauderdale, key-west); tour pages carry a meeting-spot line the text fallback parses (1818 E 9th Ave, Tampa, FL 33605; 274 N Orange Ave, Orlando, FL 32801). St-petersburg, sarasota, west-palm-beach, jacksonville, clearwater, fort-myers have bare city pages with no tour page yet (picked up automatically once one appears); /naples/ is Naples, Italy and fails the FL check",
  },
  {
    id: "tbfoodtours", brand: "Tampa Bay Food Tours", kind: "tour", activity: "food-tour", site: "https://tampabayfoodtours.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        // Tour pages publish no meeting-point street, so a city is emitted only when its tour page is live and names the city.
        const tours = [
          { url: "https://tampabayfoodtours.com/riverwalk-dine-wine-tour/", city: "Tampa", word: /tampa|riverwalk/i },
          { url: "https://tampabayfoodtours.com/st-pete-beach-drive-dine-wine-tour/", city: "St. Petersburg", word: /st\.? pete/i },
          { url: "https://tampabayfoodtours.com/dunedin-food-tour/", city: "Dunedin", word: /dunedin/i },
        ];
        const out: RawPlace[] = [];
        for (const t of tours) {
          const p = await ctx.getPage(t.url);
          if (p.status !== 200 || !t.word.test(p.html)) continue;
          out.push({ name: `Tampa Bay Food Tours ${t.city}`, label: t.city, city: t.city, region: "FL", url: t.url });
        }
        return out;
      },
    },
    verified: "2026-09-14: 3 Florida cities (Tampa, St. Petersburg, Dunedin) - page-sitemap.xml lists tampa-tours, st-pete-tours, dunedin-tours and a food-tour page for each; Dunedin tour page returns 200 but has no JSON-LD or address, so the entry is city-only",
  },
  {
    id: "ultflatours", brand: "Ultimate Florida Tours", kind: "tour", activity: "segway-tour", site: "https://www.ultimatefloridatours.com",
    strategy: {
      type: "custom",
      run: async (ctx) => {
        const url = "https://www.ultimatefloridatours.com/directionss/";
        const p = await ctx.getPage(url);
        if (p.status !== 200) return [];
        const text = p.html
          .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&nbsp;|&#160;/g, " ")
          .replace(/\s+/g, " ");
        const out: RawPlace[] = [];
        for (const a of text.matchAll(/(?<![\d-])(\d{1,6} [A-Za-z0-9 .#'-]{3,60}?),\s*([A-Za-z .'-]{2,30}),\s*(?:FL|Florida)\.?\s+(3[234]\d{3})\b/g)) {
          const pre = text.slice(Math.max(0, (a.index || 0) - 60), a.index || 0);
          const ph = pre.match(/\(?\d{3}\)?[ .-]?\d{3}-\d{4}(?!.*\d{3}-\d{4})/);
          out.push({ name: `Ultimate Florida Tours ${a[2].trim()}`, label: a[2].trim(), street: a[1].trim(), city: a[2].trim(), region: "FL", postal: a[3], phone: ph ? ph[0] : null, url });
        }
        return out;
      },
    },
    verified: "2026-09-14: 3 Florida Segway tour sites on the Directions page (219 SW 2nd Ave, Fort Lauderdale 33301; 2501 North Ocean Drive, Hollywood 33019; 950 SE 20th Avenue, Deerfield Beach) each with phone (954) 903-7049; no JSON-LD, one page lists all three so parsePlaces alone would keep only the first",
  },
];
