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
  sitemaps?: string[];
  /** A fixed list of pages instead of a sitemap, for a directory that is one long page (the WATL affiliates list). */
  pages?: string[];
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
  /**
   * A reader for a directory that lists many businesses on one page (a state page of climbing gyms, one
   * league page of every affiliated venue): every business on the page, under the same rule as `read`.
   * A business with no website is keyed by its name, since the page's own key would be shared by all of them.
   */
  readMany?: (html: string, pageUrl: string) => DirectoryRead[];
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
  {
    id: "indoorclimbing",
    kind: "climbing",
    activity: "climbing gym",
    sitemaps: ["https://www.indoorclimbing.com/sitemap.xml"],
    // One page per state or province, every gym in it. The sitemap is worldwide plus gear and technique
    // articles, so only the sixty-odd US and Canada pages are business pages. Written out because the slug
    // table lives below the registry and a regex built from it here would run before it exists.
    match: /^https:\/\/www\.indoorclimbing\.com\/(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|newhampshire|newjersey|newmexico|newyork|northcarolina|northdakota|ohio|oklahoma|oregon|pennsylvania|rhodeisland|southcarolina|southdakota|tennessee|texas|utah|vermont|virginia|washington|westvirginia|wisconsin|wyoming|alberta|britishcolumbia|manitoba|newbrunswick|newfoundland|novascotia|ontario|quebec|saskatchewan|yukon)\.html$/,
    readMany: readIndoorclimbing,
    max: 60,
    gapMs: 4000,
    verified: "2026-09-23: robots.txt disallows only /update/, /csv/ and /search/; no terms page beyond a liability notice; /<state>.html lists every gym as a <p>: name in <b>, one address line (street, town, state or province, sometimes a postcode and 'Canada'), a phone line, and the gym's own site as a rel=nofollow link whose text is the name; a <div class=\"city\"> heads each town; no JSON-LD or microdata; Florida read 17 gyms and Ontario read the same shape with Canadian postcodes",
  },
  {
    id: "watl",
    kind: "axe",
    activity: "axe throwing venue",
    // The whole affiliate list is one page; there is no per-venue page and no sitemap entry for venues.
    pages: ["https://worldaxethrowingleague.com/affiliates/"],
    match: /^https:\/\/worldaxethrowingleague\.com\/affiliates\/$/,
    readMany: readWatlAffiliates,
    max: 60,
    gapMs: 4000,
    verified: "2026-09-23: no robots.txt (404) and no terms-of-use page, only a privacy policy and tournament terms; /affiliates/ carries 220 <li class=\"wm-card\"> venues, 182 US and 19 Canada, each with the name, a state or province (data-city holds the region, not a town) and the venue's own site as the card link ('Visit website'); three cards have no link; no street, town or phone anywhere on the page; no JSON-LD",
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
  // On a page that lists many businesses the page's own slug would be one key for all of them, so the name is the key.
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const domain = host || src.id + ":" + ((src.readMany ? null : new URL(pageUrl).pathname.split("/").filter(Boolean).pop()) || slug);
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

/** Every business on one page: all of them for a readMany source, else the one parseDirectoryPage finds. */
export function parseDirectoryPageAll(src: DirectorySource, html: string, pageUrl: string): DirectoryCandidate[] {
  if (!src.readMany) {
    const c = parseDirectoryPage(src, html, pageUrl);
    return c ? [c] : [];
  }
  const out: DirectoryCandidate[] = [];
  for (const r of src.readMany(html, pageUrl)) {
    const c = r.raw ? toCandidate(src, r.raw, pageUrl, r.website) : null;
    if (c) out.push(c);
  }
  return out;
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
  const locs: string[] = [...(src.pages || [])];
  for (const sm of src.sitemaps || []) locs.push(...(await sitemapLocs(sm, src.childMatch)));
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
    for (const c of parseDirectoryPageAll(src, page.html, url)) {
      out.parsed++;
      if (!c.region) {
        out.outsideMarket++;
        continue;
      }
      if (c.website) out.withWebsite++;
      out.candidates.push(c);
    }
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

/** indoorclimbing.com page slug -> region code: STATE_NAMES without spaces, plus the two the table lacks. */
const INDOORCLIMBING_REGION: Record<string, string> = Object.fromEntries([
  ...Object.entries(STATE_NAMES).map(([name, code]) => [name.replace(/\s+/g, ""), code]),
  ["newfoundland", "NL"],
  ["yukon", "YT"],
]);

/** Whether an address line names this region, as a code or its full name, so a page's slug is not trusted blindly. */
function lineNamesRegion(line: string, code: string): boolean {
  if (new RegExp(`(^|[\\s,])${code}(?=$|[\\s,])`).test(line)) return true;
  const name = Object.entries(STATE_NAMES).find(([, c]) => c === code)?.[0];
  return !!name && new RegExp(`\\b${name}\\b`, "i").test(line);
}

/**
 * indoorclimbing.com lists every gym in a state on one page, as a <p> per gym: the name in <b>, then one line
 * of address, then a phone line, then the gym's own site as a link whose text is the name again, then a blurb
 * (not read). The town is the <div class="city"> the paragraph sits under. The region comes from the page slug
 * and is kept only when the address line agrees (as a code or a name), so a page that lists somewhere else
 * under a shared name, or a misfiled gym, is a gap rather than a wrong state.
 */
export function readIndoorclimbing(html: string, pageUrl: string): DirectoryRead[] {
  const slug = pageUrl.match(/\/([a-z]+)\.html$/)?.[1] || "";
  const region = INDOORCLIMBING_REGION[slug] || null;
  const out: DirectoryRead[] = [];
  let city: string | null = null;
  for (const m of html.matchAll(/<div class="city">([^<]*)<\/div>|<p><b>([^<]+)<\/b><br>\s*([^<]*?)<br>\s*([^<]*?)<br>\s*(?:<a\b[^>]*href=['"]([^'"]+)['"][^>]*>)?/gi)) {
    if (m[1] !== undefined) {
      city = decode(m[1]).trim() || null;
      continue;
    }
    const name = decode(m[2]).trim();
    if (!name) continue;
    const site = m[5] ? decode(m[5]) : null;
    // The site also lists campus walls a guest cannot walk into (a university rec center's wall is for its
    // students). A .edu site, or a name that says university or college, is left out rather than listed.
    if (/\.edu(\/|$)/i.test(site || "") || /\b(university|college|campus recreation)\b/i.test(name)) continue;
    const line = decode(m[3]).replace(/\s+/g, " ").trim();
    const parts = line.replace(/,?\s*(Canada|USA|United States)\s*$/i, "").split(/\s*,\s*/);
    const street = parts.length > 1 && /^\d/.test(parts[0]) ? parts[0] : null;
    const postal = line.match(/\b(\d{5}(?:-\d{4})?|[A-Z]\d[A-Z] ?\d[A-Z]\d)\b/)?.[1] || null;
    const phone = decode(m[4]).trim();
    out.push({
      raw: {
        name,
        street,
        city,
        region: region && lineNamesRegion(line, region) ? region : null,
        postal,
        phone: /\d{3}/.test(phone) ? phone : null,
        url: pageUrl,
      },
      website: site ? ownWebsite(`<a href="${site}">Website</a>`, pageUrl) : null,
    });
  }
  return out;
}

/**
 * The World Axe Throwing League lists every affiliated venue on one page as a card: the name, a state or
 * province with its country, and the venue's own site as the card's link. No town, street or phone is on
 * the page (data-city holds the region), so those stay gaps. Venues outside the US and Canada get no region
 * and are dropped by the run.
 */
export function readWatlAffiliates(html: string, pageUrl: string): DirectoryRead[] {
  const out: DirectoryRead[] = [];
  for (const card of html.matchAll(/<li class="wm-card"[\s\S]*?<\/li>/gi)) {
    const c = card[0];
    const name = decode(c.match(/class="wm-card__name">([^<]*)</)?.[1] || "").trim();
    if (!name) continue;
    const country = decode(c.match(/data-country="([^"]*)"/)?.[1] || "").toLowerCase();
    const region = /^(united states|canada)$/.test(country) ? decode(c.match(/wm-card__loc-region">([^<]*)</)?.[1] || "") : null;
    const href = c.match(/class="wm-card__inner"\s+href="([^"]+)"/)?.[1];
    out.push({
      raw: { name, region, url: pageUrl },
      website: href ? ownWebsite(`<a href="${decode(href)}">Website</a>`, pageUrl) : null,
    });
  }
  return out;
}
