import { DROP_HOSTS } from "./braveapi.ts";
import { decode, hostOf, jsonLdNodes, linksFrom, parsePlaces, phoneE164, sitemapLocs, type RawPlace } from "./chains.ts";
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
  /** Business pages enumerated by sitemap... */
  sitemaps?: string[];
  /** ...or found by following links from index pages: `follow` pages are crawled (two levels), `leaf` pages are businesses. */
  crawl?: { start: string[]; follow: RegExp; leaf: RegExp };
  /** Only sitemap entries matching this are business pages. */
  match: RegExp;
  /** For a sitemap index, only child sitemaps matching this are followed. */
  childMatch?: RegExp;
  /** The category a page's URL places it in; null means the page is not an activity we list (a coding bootcamp). */
  kindFromUrl?: (url: string) => string | null;
  /** Pages per run at most: a directory is read a slice at a time, never whole in one go. */
  max: number;
  /** What a human saw on the live site when this entry was written. */
  verified: string;
};

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
    max: 40,
    verified: "2026-09-22: /guides/<slug> carries LocalBusiness JSON-LD with the guide's name and town; no website or phone on the page",
  },
  {
    id: "coursehorse",
    kind: "cooking",
    activity: "class",
    crawl: {
      start: COURSEHORSE_CITIES.map((c) => `https://coursehorse.com/${c}/schools`),
      follow: /^https:\/\/coursehorse\.com\/[a-z-]+\/schools\/[a-z-]+\/?$/,
      leaf: /^https:\/\/coursehorse\.com\/[a-z-]+\/schools\/[a-z-]+\/[a-z0-9-]+\/?$/,
    },
    match: /^https:\/\/coursehorse\.com\/[a-z-]+\/schools\/[a-z-]+\/[a-z0-9-]+\/?$/,
    kindFromUrl: (url) => {
      const cat = url.match(/\/schools\/([a-z-]+)\//)?.[1] || "";
      return COURSEHORSE_KIND[cat] || null;
    },
    max: 40,
    verified: "2026-09-22: /<city>/schools/<category>/<school> carries Organization plus Place JSON-LD with the school's street address and an aggregate rating; no website on the page",
  },
];

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
export function ownWebsite(html: string, pageUrl: string, nodes = jsonLdNodes(html)): string | null {
  const here = hostOf(pageUrl);
  const ok = (u: string | null | undefined): string | null => {
    const h = hostOf(u);
    if (!u || !h || !here || h === here || h.endsWith("." + here) || DROP_HOSTS.test(h) || INFRA_HOST.test(h)) return null;
    return /^https?:\/\//i.test(u) ? u : "https://" + u;
  };
  for (const n of nodes) {
    for (const v of [n.url, ...[n.sameAs].flat()]) {
      const w = ok(typeof v === "string" ? v : null);
      if (w) return w;
    }
  }
  const labelled = html.match(/href=["']([^"']+)["'][^>]*>(?:[^<]|<(?!\/a>))*?\b(website|visit (our|their) site|official site)\b/i)?.[1];
  return ok(labelled);
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
  const places = parsePlaces(html, pageUrl);
  const raw = places.find((p) => p.name) || places[0];
  if (!raw) return null;
  return toCandidate(src, raw, pageUrl, ownWebsite(html, pageUrl));
}

export type DirectoryRun = { source: string; listed: number; fetched: number; parsed: number; withWebsite: number; outsideMarket: number; candidates: DirectoryCandidate[]; failed: string[] };

/**
 * Read up to `max` business pages from one directory, starting after `skip` (so successive runs walk the
 * whole sitemap a slice at a time). Businesses outside the US and Canada are counted and dropped.
 */
export async function runDirectory(src: DirectorySource, opts: { max?: number; skip?: number; log?: (m: string) => void } = {}): Promise<DirectoryRun> {
  const log = opts.log || (() => {});
  const max = Math.min(opts.max ?? src.max, 200);
  const out: DirectoryRun = { source: src.id, listed: 0, fetched: 0, parsed: 0, withWebsite: 0, outsideMarket: 0, candidates: [], failed: [] };
  const locs: string[] = [];
  for (const sm of src.sitemaps || []) locs.push(...(await sitemapLocs(sm, src.childMatch)));
  if (src.crawl) {
    // Index pages, two levels deep: a city's school index lists categories, a category lists schools.
    const seen = new Set<string>();
    let frontier = [...src.crawl.start];
    for (let depth = 0; depth < 2 && frontier.length; depth++) {
      const next: string[] = [];
      for (const url of frontier) {
        if (seen.has(url)) continue;
        seen.add(url);
        const page = await getPage(url);
        if (page.status !== 200) continue;
        for (const l of linksFrom(page.html, url, /^https?:\/\//)) {
          const clean = l.replace(/\/$/, "");
          if (src.crawl.leaf.test(clean)) locs.push(clean);
          else if (src.crawl.follow.test(clean) && !seen.has(clean)) next.push(clean);
        }
      }
      frontier = next;
    }
  }
  const pages = [...new Set(locs)].filter((l) => src.match.test(l)).sort();
  out.listed = pages.length;
  log(`${src.id}: ${pages.length} business pages in the sitemap, reading ${max} from #${opts.skip || 0}`);
  for (const url of pages.slice(opts.skip || 0, (opts.skip || 0) + max)) {
    const page = await getPage(url);
    out.fetched++;
    if (page.status !== 200 || !page.html) {
      out.failed.push(url + " (" + page.status + ")");
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
