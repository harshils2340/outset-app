import { looksBlocked } from "../scrape/fetch.ts";
import { DROP_HOSTS } from "./braveapi.ts";
import { decode, hostOf, jsonLdNodes, parsePlaces, phoneE164, sitemapLocs, type RawPlace } from "./chains.ts";
import { CITIES } from "./cities.ts";
import { getPage } from "./polite.ts";

/**
 * Directory-style marketplaces as discovery sources: a business's name, town and (when the page carries one)
 * its own website, and nothing else.
 *
 * This is the whole of what is read from them. A marketplace's photos, descriptions and prices are its own or
 * its operators' copyright and its terms forbid reusing them; a business's name and where it is are facts, and
 * the operator's own website is where every fact on an Outset page comes from afterwards (the structure,
 * photos and hours crawls). So a directory can tell us a fishing guide exists in Gloucester; only the guide's
 * own site can tell us what they charge.
 *
 * Every fetch goes through polite.ts: robots.txt, one request per host at a time, a pause between. Sources
 * that answer a polite bot with a challenge page (Cloudflare "just a moment", a 403) are not in the registry
 * and must not be added with a workaround; that answer is the site's policy.
 *
 * Nothing here opens SQLite. scripts/discover-directories.mts writes data/discovered/directory-<source>.json
 * and scripts/import-discovered.mts inserts the rows that carry a website. Rows without one go to a separate
 * needs-website file: they are leads, not listings, until a website lookup finds their site.
 */

export type DirectorySource = {
  id: string;
  /** Outset category id (taxonomy/catalog.ts) every business found here is filed under, unless kindFromUrl says otherwise. */
  kind: string;
  /** Finer activity word for reporting. */
  activity?: string;
  /** Where the pages are enumerated. */
  sitemaps: string[];
  /**
   * When the sitemap lists something other than business pages (CourseHorse lists classes, not schools), the
   * entries matching `from` are read for the JSON-LD Organization whose url matches `match`, and those pages are
   * the businesses. Many entries lead to the same business; each is read once.
   */
  hop?: { from: RegExp };
  /** Only pages matching this are business pages. */
  match: RegExp;
  /** For a sitemap index, only child sitemaps matching this are followed. */
  childMatch?: RegExp;
  /** The category a page's URL places it in; null means the page is not an activity we list (a coding bootcamp). */
  kindFromUrl?: (url: string) => string | null;
  /**
   * A reader for a site whose pages parsePlaces and ownWebsite cannot read as they are (JSON-LD escaped into a
   * meta tag, a website written as text instead of a link): the place and the operator's own site, or a null
   * place for a page that is not a business. Only name, town, region, street, phone, pin and website, ever.
   */
  read?: (html: string, pageUrl: string) => DirectoryRead;
  /** Pages per run at most: a directory is read a slice at a time, never whole in one go. */
  max: number;
  /** Pause between two requests to this host, when the site has shown it wants more than polite.ts's default. */
  gapMs?: number;
  /** What a human saw on the live site when this entry was written. */
  verified: string;
};

/**
 * A page that is the site telling us to stop: a redirect to a rate-limit or challenge page, or a challenge
 * body behind a 200. It is not a business page, it must not be parsed, and the run must end there rather
 * than keep asking. That answer is the site's policy on being read by a bot, and the registry honours it.
 * The rule itself lives beside the page cache (scrape/fetch.ts), which refuses to store such a page.
 */
export const isBlockedPage = looksBlocked;

export type DirectoryCandidate = {
  name: string;
  website: string | null;
  /** The website host, or the directory page's own key when there is no website yet. */
  domain: string;
  street: string | null;
  city: string | null;
  region: string | null;
  postal: string | null;
  lat: number | null;
  lon: number | null;
  phone: string | null;
  kind: string;
  source: "directory";
  directory: string;
  sourceUrl: string;
  activity?: string;
};

/** CourseHorse's school categories that are activities a guest books a time for. The rest (tech, professional, language, music, kids) are not. */
const COURSEHORSE_KIND: Record<string, string> = { cooking: "cooking", art: "pottery", dance: "dance", fitness: "fitness", acting: "theatre" };
const COURSEHORSE_CITIES = ["nyc", "los-angeles", "chicago", "boston", "nashville-tn", "houston", "washington-dc", "san-diego", "san-francisco", "seattle", "atlanta"];

export const DIRECTORIES: DirectorySource[] = [
  {
    id: "captainexperiences",
    kind: "fishing",
    activity: "fishing guide",
    sitemaps: ["https://captainexperiences.com/sitemaps/sitemap_guides.xml"],
    match: /^https:\/\/captainexperiences\.com\/guides\/[a-z0-9-]+$/,
    max: 60,
    // 2026-09-22: two hundred pages at the default pace tripped their limiter (a 200 that redirects to
    // /rate-limit). Slower and smaller from here; a run stops at the first such page.
    gapMs: 8000,
    verified: "2026-09-22: /guides/<slug> carries LocalBusiness JSON-LD with the guide's name and town; no website or phone on the page; rate-limits a bot at the default pace",
  },
  {
    id: "coursehorse",
    kind: "cooking",
    activity: "class",
    sitemaps: COURSEHORSE_CITIES.map((c) => `https://coursehorse.com/${c}-sitemap.xml`),
    // Only classes in the activity categories are worth a hop: their school is in the same category.
    hop: { from: /^https:\/\/coursehorse\.com\/[a-z-]+\/classes\/(cooking|art|dance|fitness|acting)\/.+\/[a-z0-9-]+$/ },
    match: /^https:\/\/coursehorse\.com\/[a-z-]+\/schools\/[a-z-]+\/[a-z0-9-]+\/?$/,
    kindFromUrl: (url) => {
      const cat = url.match(/\/schools\/([a-z-]+)\//)?.[1] || "";
      return COURSEHORSE_KIND[cat] || null;
    },
    max: 40,
    verified: "2026-09-22: /<city>/schools is a redirect to /classes and links no schools; a class page's Organization JSON-LD carries the school's /schools/ url, and that page carries Place JSON-LD with the street address and an aggregate rating; no website on either",
  },
  {
    id: "dropzonefinder",
    kind: "skydive",
    activity: "dropzone",
    sitemaps: ["https://dropzonefinder.com/sitemap.xml"],
    // The sitemap is worldwide (1,765 pages); only the two countries we list, and not the /cities/ hub pages.
    match: /^https:\/\/dropzonefinder\.com\/dropzones\/(united-states|canada)\/[a-z0-9-]+$/,
    read: readDropzonefinder,
    max: 60,
    gapMs: 4000,
    verified: "2026-09-23: robots.txt allows /dropzones; 368 US and Canada pages in the sitemap; the dropzone's LocalBusiness JSON-LD is HTML-escaped into a <meta name=\"application/ld+json\"> tag with name, phone, pin, country and the operator's site in sameAs, and the page links it again as 'Visit the website'; no town, state or street anywhere on the page, so the state comes off the pin (regionNearPin) and the town stays a gap; a six-page dry slice read all six, four with a website, and kept two: the other four are rural or border Canada where the pin cannot name a province safely",
  },
  {
    id: "skydivingsource",
    kind: "skydive",
    activity: "dropzone",
    sitemaps: ["https://skydivingsource.com/sitemap_index.xml"],
    // A WordPress index: posts, pages and five dropzones-sitemapN.xml files, about 1,000 dropzones worldwide.
    childMatch: /\/dropzones-sitemap\d+\.xml$/,
    match: /^https:\/\/skydivingsource\.com\/locations\/[a-z0-9-]+\/?$/,
    read: readSkydivingSource,
    max: 60,
    gapMs: 4000,
    verified: "2026-09-23: robots.txt disallows only /wp-admin/; /locations/<slug>/ carries LocalBusiness microdata (name, street, town, state, postcode, phone, pin) and the country as a class on the article; the JSON-LD is a breadcrumb only; the website is plain text under 'Website:', not a link; 862 locations worldwide in the sitemap, so much of a slice is outside the US and Canada (the first sorted page is a Paris dropzone); two US pages read with street, town, state, phone and website",
  },
];

/** The JSON-LD Organization urls on a page that match `match`: the businesses a class or event page belongs to. */
export function organizationLinks(html: string, match: RegExp): string[] {
  const out = new Set<string>();
  for (const n of jsonLdNodes(html)) {
    const type = [n["@type"]].flat().map(String).join(" ");
    if (!/Organization|LocalBusiness/.test(type)) continue;
    const u = typeof n.url === "string" ? n.url.replace(/\/$/, "") : "";
    if (u && match.test(u)) out.add(u);
  }
  return [...out];
}

const US_REGION = /^(A[KLRZ]|C[AOT]|D[CE]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])$/i;
const CA_REGION = /^(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)$/i;

const STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
  alberta: "AB", "british columbia": "BC", manitoba: "MB", "new brunswick": "NB", "newfoundland and labrador": "NL", "nova scotia": "NS", ontario: "ON", "prince edward island": "PE", quebec: "QC", québec: "QC", saskatchewan: "SK",
};

/** "Massachusetts" or "MA" -> "MA"; anything outside the US and Canada -> null. */
export function regionCode(raw: string | null | undefined): string | null {
  const s = decode(raw || "").trim();
  if (!s) return null;
  if (US_REGION.test(s) || CA_REGION.test(s)) return s.toUpperCase();
  return STATE_NAMES[s.toLowerCase()] || null;
}

/** Hosts a page links to for reasons that have nothing to do with the business on it: fonts, scripts, analytics, app stores, players. */
const INFRA_HOST = /(^|\.)(typekit\.net|fonts\.googleapis\.com|gstatic\.com|googleapis\.com|googletagmanager\.com|google-analytics\.com|doubleclick\.net|cloudflare\.com|cloudfront\.net|amazonaws\.com|jsdelivr\.net|unpkg\.com|cdnjs\.com|bing\.com|apple\.com|spotify\.com|vimeo\.com|schema\.org|w3\.org|trustarc\.com|stripe\.com|paypal\.com|intercom\.io|hotjar\.com|segment\.com|sentry\.io|typeform\.com|mailchimp\.com|hubspot\.com)$/i;

/**
 * The business's own site, when the page says so, or null.
 *
 * Only two things count: a JSON-LD `url`/`sameAs` that points off the directory's host, or a link whose own
 * text calls it the website. "The one external link on the page" does not count: on a real guide page that
 * one link was a font host, and a wrong website is worse than none, since every fact on the listing would
 * then be read off a stranger's site.
 */
const ASSET = /\.(css|js|mjs|woff2?|ttf|otf|eot|png|jpe?g|webp|gif|svg|ico|xml|json|pdf|mp4|webm)(\?|#|$)/i;

export function ownWebsite(html: string, pageUrl: string, nodes = jsonLdNodes(html)): string | null {
  const here = hostOf(pageUrl);
  const ok = (u: string | null | undefined): string | null => {
    // A protocol-relative or bare-path href is the page's own asset, never another business's site.
    if (!u || !/^https?:\/\/[^/]/i.test(u) || ASSET.test(u)) return null;
    const h = hostOf(u);
    if (!h || !here || h === here || h.endsWith("." + here) || DROP_HOSTS.test(h) || INFRA_HOST.test(h)) return null;
    return u;
  };
  for (const n of nodes) {
    for (const v of [n.url, ...[n.sameAs].flat()]) {
      const w = ok(typeof v === "string" ? v : null);
      if (w) return w;
    }
  }
  // Only an <a> whose own text calls it the website. Not a <link> tag, and not a href that happens to sit
  // somewhere before the word "website" in the page: on a real school page that was a font file.
  for (const m of html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([^<]{0,160})<\/a>/gi)) {
    if (/\b(website|visit (our|their) (web)?site|official site)\b/i.test(m[2])) {
      const w = ok(decode(m[1]));
      if (w) return w;
    }
  }
  return null;
}

export function toCandidate(src: DirectorySource, raw: RawPlace, pageUrl: string, website: string | null): DirectoryCandidate | null {
  const name = raw.name ? decode(raw.name).replace(/\s*[|–—-]\s*(Captain Experiences|CourseHorse|Cozymeal|PADI|CellarPass).*$/i, "").trim() : "";
  if (name.length < 3) return null;
  const kind = src.kindFromUrl ? src.kindFromUrl(pageUrl) : src.kind;
  if (!kind) return null;
  const region = regionCode(raw.region);
  const host = hostOf(website);
  const domain = host || src.id + ":" + (new URL(pageUrl).pathname.split("/").filter(Boolean).pop() || name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
  return {
    name: name.slice(0, 120),
    website: host ? website : null,
    domain,
    street: raw.street ? decode(raw.street) : null,
    city: raw.city ? decode(raw.city) : null,
    region,
    postal: raw.postal ? decode(raw.postal) : null,
    lat: typeof raw.lat === "number" ? raw.lat : raw.lat ? Number(raw.lat) || null : null,
    lon: typeof raw.lon === "number" ? raw.lon : raw.lon ? Number(raw.lon) || null : null,
    phone: phoneE164(raw.phone),
    kind,
    source: "directory",
    directory: src.id,
    sourceUrl: pageUrl,
    activity: src.activity,
  };
}

/** One business page: the first place its structured data describes, with its own website when the page has one. */
export function parseDirectoryPage(src: DirectorySource, html: string, pageUrl: string): DirectoryCandidate | null {
  if (src.read) {
    const r = src.read(html, pageUrl);
    return r.raw ? toCandidate(src, r.raw, pageUrl, r.website) : null;
  }
  const places = parsePlaces(html, pageUrl);
  const raw = places.find((p) => p.name) || places[0];
  if (!raw) return null;
  return toCandidate(src, raw, pageUrl, ownWebsite(html, pageUrl));
}

export type DirectoryRun = { source: string; listed: number; fetched: number; parsed: number; withWebsite: number; outsideMarket: number; candidates: DirectoryCandidate[]; failed: string[]; /** The run ended early because the site answered with a rate-limit or challenge page. */ blocked: boolean };

/**
 * Read up to `max` business pages from one directory, starting after `skip` (so successive runs walk the
 * whole sitemap a slice at a time). Businesses outside the US and Canada are counted and dropped.
 */
export async function runDirectory(src: DirectorySource, opts: { max?: number; skip?: number; log?: (m: string) => void } = {}): Promise<DirectoryRun> {
  const log = opts.log || (() => {});
  const max = Math.min(opts.max ?? src.max, 200);
  const out: DirectoryRun = { source: src.id, listed: 0, fetched: 0, parsed: 0, withWebsite: 0, outsideMarket: 0, candidates: [], failed: [], blocked: false };
  const gap = src.gapMs ?? 1500;
  const locs: string[] = [];
  for (const sm of src.sitemaps) locs.push(...(await sitemapLocs(sm, src.childMatch)));
  let pages: string[];
  if (src.hop) {
    // The sitemap lists classes; each class page names its school. `max` and `skip` count class pages read,
    // so successive runs walk the sitemap, and a school named by several classes is read once.
    const from = [...new Set(locs.map((l) => l.replace(/\/$/, "")))].filter((l) => src.hop!.from.test(l)).sort();
    out.listed = from.length;
    log(`${src.id}: ${from.length} pages in the sitemap lead to businesses, reading ${max} from #${opts.skip || 0}`);
    const found = new Set<string>();
    let hopped = 0;
    for (const url of from.slice(opts.skip || 0, (opts.skip || 0) + max)) {
      const page = await getPage(url, gap);
      out.fetched++;
      if (++hopped % 25 === 0) log(`${src.id}: ${hopped}/${max} index pages read, ${found.size} businesses named so far`);
      if (isBlockedPage(page)) {
        out.blocked = true;
        out.failed.push(url + " (blocked: " + page.finalUrl + ")");
        log(`${src.id}: the site answered with a rate-limit or challenge page; stopping here`);
        break;
      }
      if (page.status !== 200 || !page.html) {
        out.failed.push(url + " (" + page.status + ")");
        continue;
      }
      for (const b of organizationLinks(page.html, src.match)) found.add(b);
    }
    pages = [...found].sort();
    log(`${src.id}: ${pages.length} distinct businesses named by those pages`);
  } else {
    pages = [...new Set(locs)].filter((l) => src.match.test(l)).sort();
    out.listed = pages.length;
    log(`${src.id}: ${pages.length} business pages in the sitemap, reading ${max} from #${opts.skip || 0}`);
    pages = pages.slice(opts.skip || 0, (opts.skip || 0) + max);
  }
  let n = 0;
  for (const url of pages) {
    if (out.blocked) break;
    const started = Date.now();
    const page = await getPage(url, gap);
    out.fetched++;
    n++;
    if (n % 25 === 0 || Date.now() - started > 20000) log(`${src.id}: ${n}/${pages.length} pages, last took ${Math.round((Date.now() - started) / 1000)}s`);
    if (isBlockedPage(page)) {
      out.blocked = true;
      out.failed.push(url + " (blocked: " + page.finalUrl + ")");
      log(`${src.id}: the site answered with a rate-limit or challenge page; stopping here`);
      break;
    }
    if (page.status !== 200 || !page.html) {
      out.failed.push(url + " (" + page.status + ")");
      log(`${src.id}: failed ${url} (${page.status})`);
      continue;
    }
    const c = parseDirectoryPage(src, page.html, url);
    if (!c) continue;
    out.parsed++;
    if (!c.region) {
      out.outsideMarket++;
      continue;
    }
    if (c.website) out.withWebsite++;
    out.candidates.push(c);
  }
  return out;
}

/** What a source's own reader hands back: the place (null when the page is not a business) and the operator's own site. */
export type DirectoryRead = { raw: RawPlace | null; website: string | null };

/**
 * The region of the city-grid entry nearest a pin, for a directory that pins a business but names no state.
 * Null when a grid city of another region is nearly as close (within 1.4x the nearest's distance): a pin
 * between Boston and Portsmouth could be either state, and a wrong state on a listing is worse than a dropped
 * lead. A dropzone 76 km from Atlanta with Chattanooga 116 km off is Georgia. The operator's own site settles
 * the address at the contact crawl.
 */
export function regionNearPin(lat: number, lon: number, maxKm = 130): string | null {
  const near = CITIES.map((c) => {
    const dLat = ((c.lat - lat) * Math.PI) / 180;
    const dLon = ((c.lon - lon) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat * Math.PI) / 180) * Math.cos((c.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return { region: c.region, km: 2 * 6371 * Math.asin(Math.sqrt(a)) };
  })
    .filter((c) => c.km <= maxKm)
    .sort((a, b) => a.km - b.km);
  if (!near.length) return null;
  const rival = near.find((c) => c.region !== near[0].region);
  if (rival && rival.km < near[0].km * 1.4) return null;
  return near[0].region;
}

/** The first parseable object in an HTML-escaped JSON blob (a JSON-LD block written into a meta content attribute). */
function escapedJsonNodes(escaped: string): Record<string, unknown>[] {
  try {
    return [JSON.parse(decode(escaped))].flat().filter((n): n is Record<string, unknown> => !!n && typeof n === "object");
  } catch {
    return [];
  }
}

/**
 * DropzoneFinder writes the dropzone's LocalBusiness JSON-LD HTML-escaped into a <meta name="application/ld+json"
 * content="..."> tag instead of a script, so jsonLdNodes never sees it. That block carries the name, phone, pin,
 * country and the operator's site in sameAs; the page names no town, state or street. The state is read off the
 * pin with regionNearPin and the town stays an honest gap. Nothing else on the page (aircraft, prices, weather,
 * ratings) is read.
 */
export function readDropzonefinder(html: string, pageUrl: string): DirectoryRead {
  const m = html.match(/<meta\s+name=["']application\/ld\+json["']\s+content="([^"]*)"/i);
  const nodes = m ? escapedJsonNodes(m[1]) : [];
  const biz = nodes.find((n) => /LocalBusiness|SportsActivityLocation/.test([n["@type"]].flat().map(String).join(" ")));
  if (!biz || typeof biz.name !== "string" || !biz.name.trim()) return { raw: null, website: null };
  const geo = (biz.geo && typeof biz.geo === "object" ? biz.geo : {}) as Record<string, unknown>;
  const lat = Number(geo.latitude);
  const lon = Number(geo.longitude);
  const pinned = Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 && lon !== 0;
  return {
    raw: {
      name: biz.name,
      phone: typeof biz.telephone === "string" ? biz.telephone : null,
      lat: pinned ? lat : null,
      lon: pinned ? lon : null,
      region: pinned ? regionNearPin(lat, lon) : null,
      url: pageUrl,
    },
    website: ownWebsite(html, pageUrl, nodes),
  };
}

/**
 * Skydiving Source carries the dropzone as LocalBusiness microdata (name, street, town, state, postcode, phone,
 * pin), the country as a class on the article, and the website as plain text under "Website:", not a link. The
 * text goes through ownWebsite's host rules as if it were a link, so the directory's own host, a social page or
 * "N/A" is never taken as a site.
 */
export function readSkydivingSource(html: string, pageUrl: string): DirectoryRead {
  const prop = (k: string): string | null => {
    const v = html.match(new RegExp(`<meta\\s+itemprop=["']${k}["'][^>]*\\bcontent=["']([^"']*)["']`, "i"))?.[1];
    return v ? decode(v) || null : null;
  };
  const name = prop("name");
  if (!name) return { raw: null, website: null };
  const country = html.match(/\bcountry-([a-z-]+)\b/)?.[1] || null;
  const inMarket = !country || country === "usa" || country === "canada";
  const w = html.match(/Website:<\/strong>\s*(?:<br\s*\/?>)?\s*(?:<a\b[^>]*href=["']([^"']+)["'][^>]*>)?([^<]*)/i);
  const text = decode(w?.[1] || w?.[2] || "").replace(/\s.*$/, "");
  const site = /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(text) ? (/^https?:\/\//i.test(text) ? text : "https://" + text) : null;
  return {
    raw: {
      name,
      street: prop("streetAddress"),
      city: prop("addressLocality"),
      region: inMarket ? prop("addressRegion") : null,
      postal: prop("postalCode"),
      lat: prop("latitude"),
      lon: prop("longitude"),
      phone: prop("telephone"),
      url: pageUrl,
    },
    website: site ? ownWebsite(`<a href="${site}">Website</a>`, pageUrl) : null,
  };
}
