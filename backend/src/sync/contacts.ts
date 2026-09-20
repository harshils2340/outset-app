import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CITIES } from "../discover/cities.ts";
import { db } from "../db/client.ts";
import { writeLandingPages } from "./pages.ts";
import { writeListingPages } from "./listingPages.ts";
import { encodeWeek, isTradingHoursLine } from "./hours.ts";
import { claimKeyHash } from "../lib/claim.ts";
import { crawledPhotoStats, crawledPhotosFor } from "./photoSidecar.ts";
import { crawledStructureFor, crawledStructureStats, crawledHoursFor } from "./structureSidecar.ts";
import { cleanImageUrl } from "../enrich/srcset.ts";
import { isChallengeImage } from "../enrich/imagescrape.ts";
import { artFromName, reconcileArt } from "./artEvidence.ts";
import { LOCATION_FACT, brandId, isChainLocation } from "./brandShare.ts";
import { fullSize } from "./imageUrl.ts";
import { quotesFromFacts } from "./quotes.ts";
import { METROS, familyForArt, nearestMetro } from "../taxonomy/catalog.ts";
import { rankForCover } from "../enrich/photorelevance.ts";
import { existsSync, readFileSync as readFileSyncFs } from "node:fs";
import { STANDARD, isEventSchedule, plainLabel, plainName, plainServices, type RawService } from "./plainServices.ts";
import { consolidateDeals } from "./dealText.ts";
import { buildLiteShard, type LiteRow } from "./liteShard.ts";
import { durationFrom } from "../../../src/lib/duration.ts";
import { onlyOperatorCancels } from "../../../src/lib/cancellation.ts";
import { bookableRow, tidyRowName } from "../../../src/lib/menuRow.ts";
import { ownWords } from "../../../src/lib/ownWords.ts";
import { dialPhone } from "../../../src/lib/phone.ts";
import { contactEmail } from "../../../src/lib/email.ts";
import { postalOf, streetOf } from "../../../src/lib/address.ts";
import { REGION_NAME } from "../../../src/data/regions.ts";

type Overlay = { published: boolean; patch: Record<string, unknown> };
/** Claimed operators' saved edits, keyed by listing id. Filled by loadProfileOverlays before a sync. */
const overlays = new Map<string, Overlay>();

/**
 * Load every claimed listing's edits so the catalog bakes them in. Straight from Postgres when this process has
 * DATABASE_URL, else from the live API, which serves the same rows. With neither the catalog is built from the
 * crawl alone, and says so. Nothing is read from the repository: operator edits never go there.
 */
export async function loadProfileOverlays(): Promise<{ count: number; source: string }> {
  overlays.clear();
  const put = (e: { id: string; published?: boolean; patch?: Record<string, unknown> }) => overlays.set(e.id, { published: e.published !== false, patch: e.patch || {} });
  if ((process.env.DATABASE_URL || "").trim()) {
    const { listProfileEdits } = await import("../lib/repo.ts");
    const { closePg } = await import("../db/pg.ts");
    try {
      for (const e of await listProfileEdits()) put(e);
      return { count: overlays.size, source: "postgres" };
    } finally {
      await closePg().catch(() => undefined);
    }
  }
  const api = (process.env.API_URL || "https://outset-api.onrender.com").replace(/\/$/, "");
  try {
    const res = await fetch(api + "/listing-edits", { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const j = (await res.json()) as { edits?: { id: string; published?: boolean; patch?: Record<string, unknown> }[] };
    for (const e of j.edits || []) put(e);
    return { count: overlays.size, source: api };
  } catch (e) {
    console.warn("[sync] operator edits could not be loaded (" + (e as Error).message + "); the catalog is built from the crawl alone this time");
    return { count: 0, source: "none" };
  }
}

/** A claimed operator's saved edits win over what the crawl found. */
function profileOverlay(id: string): Overlay | null {
  return overlays.get(id) || null;
}

const here = dirname(fileURLToPath(import.meta.url));
const appDataDir = join(here, "../../../src/data");

/** Public contact facts for one operator. Every field is null when the site did not publish it. */
export type OperatorContact = {
  domain: string;
  website: string | null;
  phone: string | null;
  email: string | null;
  street: string | null;
  city: string | null;
  region: string | null;
  postal: string | null;
  hours: string[];
  bookingVendor: string | null;
  fetchedAt: string | null;
};

type Row = {
  domain: string;
  website: string | null;
  phone: string | null;
  email: string | null;
  street: string | null;
  city: string | null;
  region: string | null;
  postal: string | null;
  hours: string | null;
  hours_text: string | null;
  calendar_vendor: string | null;
  fetched_at: string | null;
};

export function contactFor(domain: string): OperatorContact | null {
  const row = db
    .prepare(
      `SELECT o.domain, o.website, o.phone, o.email, o.street, o.city, o.region, o.postal, o.hours, o.calendar_vendor,
              (SELECT MAX(fetched_at) FROM sources s WHERE s.operator_id = o.id AND s.http_status = 200) AS fetched_at
       FROM operators o WHERE o.domain = ?`,
    )
    .get(domain) as Row | undefined;
  return row ? toContact(row) : null;
}

export function allContacts(): OperatorContact[] {
  const rows = db
    .prepare(
      `SELECT o.domain, o.website, o.phone, o.email, o.street, o.city, o.region, o.postal, o.hours, o.calendar_vendor,
              (SELECT fact_value FROM facts f WHERE f.operator_id = o.id AND f.fact_key = 'hours_text' LIMIT 1) AS hours_text,
              (SELECT MAX(fetched_at) FROM sources s WHERE s.operator_id = o.id AND s.http_status = 200) AS fetched_at
       FROM operators o WHERE o.origin != 'demo' ORDER BY o.domain`,
    )
    .all() as Row[];
  return rows.map(toContact);
}

/**
 * The two-letter code the rest of the app reads a state by. 47 operators publish the name spelled out, so
 * their area line is "West Union, Ohio", and every reader of a state asks for a code: `regionOfArea` answers
 * nothing for them, which costs those listings the right clock, the currency their booking is charged in, the
 * state row a search offers and the state page that row opens.
 */
const REGION_CODE = new Map(Object.entries(REGION_NAME).map(([code, name]) => [name.toLowerCase(), code]));
export function regionCode(region: string | null): string | null {
  const r = (region || "").trim();
  if (!r) return null;
  if (/^[A-Za-z]{2}$/.test(r)) return r.toUpperCase();
  return REGION_CODE.get(r.toLowerCase()) || r;
}

function toContact(r: Row): OperatorContact {
  return {
    domain: r.domain,
    website: r.website,
    // The crawl refuses a field that is not a number as it reads a page, and the sync refuses it again, because
    // the ones already stored are only cleared by a rule that runs when the catalog is written.
    phone: dialPhone(silent(r.phone)),
    // The same rule the claim gate reads the address by: an address still percent-encoded, a site template's
    // own inbox or a name masked with asterisks is not one an owner could be written to at.
    email: contactEmail(r.email),
    // A town, a bare house number or the shop's phone is not a street, and the page prints whatever is here.
    street: streetOf(r) || null,
    city: r.city,
    region: regionCode(r.region),
    postal: postalOf(r.postal) || null,
    hours: tidyHours(r.hours ? r.hours.split(" | ") : r.hours_text ? [r.hours_text] : []),
    bookingVendor: r.calendar_vendor,
    fetchedAt: r.fetched_at,
  };
}

/**
 * Write src/data/contacts.ts for the hand-verified seed operators only. Everything else ships in public/catalog.json,
 * which the app fetches at startup, so the bundled file stays small.
 */
export function syncContactsToApp(): { path: string; count: number } {
  const seedDomains = new Set(
    (db.prepare("SELECT domain FROM operators WHERE origin IN ('seed', 'public_site')").all() as { domain: string }[]).map((r) => r.domain),
  );
  const contacts = allContacts().filter((c) => seedDomains.has(c.domain));
  const body = contacts
    .map((c) => "  " + JSON.stringify(c.domain) + ": " + JSON.stringify(c) + ",")
    .join("\n");
  const src = `import type { OperatorContact } from "./types";

/**
 * GENERATED by \`npm run backend:sync\`. Do not edit by hand.
 * Public contact facts per operator domain, copied from each company's own site by the backend scraper.
 * A null field means the site did not publish it. Do not fill gaps by hand.
 */
export const CONTACTS: Record<string, OperatorContact> = {
${body}
};
`;
  const path = join(appDataDir, "contacts.ts");
  writeFileSync(path, src);
  return { path, count: contacts.length };
}

/* ---------- Full catalog export for the guest app ---------- */

type CatalogRow = {
  id: string;
  domain: string;
  name: string;
  legal_name?: string | null;
  website: string | null;
  city: string | null;
  region: string | null;
  metro_id: string | null;
  family: string | null;
  icon_key: string;
  rating: number | null;
  review_count: number | null;
  origin: string;
  lat: number | null;
  lon: number | null;
};

/** Marketplaces and directories are not operators. They never belong in the catalog. */
/** Names the discovery net caught that are not something a guest books: car rentals, retail, festivals, museums, clubs, public piers. */
export const NOT_EXPERIENCE = /\bmurals?\b|\bcar rentals?\b|\brent-?a-?car\b|\b(thrifty|hertz|avis|enterprise|budget) \b|u-haul|\bauto rentals?\b|\bsports? shop\b|\bski sports\b|\bsporting goods\b|\bfestival\b|\bfair\b(?! ?winds)|\browing club\b|\byacht club\b|\bmunicipal pier\b|\bcommunity boathouse\b|\bboat ramp\b|\bpublic launch\b|\bstate park\b|\bcounty park\b/i;
export const MARKETPLACES = /(^|\.)(sailo|getmyboat|boatsetter|viator|tripadvisor|airbnb|expedia|groupon|yelp|peek|fareharbor|getyourguide|klook|eventbrite|meetup|facebook|instagram|booking|hotels|vrbo|kayak|tours4fun|musement|headout|goldstar|boatbound|clickandboat|samboat|fishingbooker|fishanywhere|guidesly)\.(com|net|co|io|ca)$/i;

/**
 * Hosts that answer a search for an activity but never run one, at any depth: a booking vendor's own hosted
 * pages, an app store, a marketplace or reseller, a retailer, a social network, a search engine, a business
 * directory, a state registry. `src/discover/websearch.ts` already refuses these when it discovers operators,
 * but rows reach the operators table from other sources too (OpenStreetMap website tags, chain locators, the
 * Places lookups), so the catalog has to refuse them again or they ship as listings: Amazon.com was published
 * as a hot air balloon ride in Fort Myers, youtube.com as a guide service in San Antonio, apps.apple.com as a
 * fishing charter, and app.squareup.com, book.squareup.com and a Rezdy booking widget as jet ski rentals.
 *
 * A site builder is deliberately absent. `squarespace.com` is Squarespace, but `hide-away-cove.squarespace.com`
 * is a campground's own website, and so are the 250 odd operators on wordpress.com, weebly.com, business.site
 * and the rest. The hosts below carry no operator's own site on any subdomain.
 */
export const NOT_OPERATOR_HOST =
  /(^|\.)(amazon|apple|google|youtube|wikipedia|craigslist|foursquare|indeed|glassdoor|ziprecruiter|zoominfo|linkedin|pinterest|tiktok|twitter|reddit|quora|nextdoor|mapquest|yellowpages|superpages|whitepages|manta|hotfrog|cylex|chamberofcommerce|bbb|apartments|roomies|zillow|trulia|realtor|redfin|sunbiz|opencorporates|bizapedia|almanac|affordabletours|livability|tagvenue|sightseeing|squareup|rezdy|bookeo|vagaro|fresha|mindbodyonline|booksy|xola|classpass|coursehorse|cozymeal|classbento|thumbtack|bark|angi|homeadvisor|tiqets|isango|bookmundi|toursbylocals|withlocals|guruwalk|freetour|citypass|gocity|sightseeingpass|tripoutside|friendwitha|captainexperiences|hipcamp|massagebook)\.(com|net|org|co|io|ca|me|us|gov)$/i;

/**
 * Opening hours worth showing: a weekly pattern with times, or "closed". Snapshots like "Open today 9am-5pm" and
 * "Hours This Week Thursday 2:00 PM-4:00 PM" describe one day the crawler happened to visit, so they are dropped.
 */
export function tidyHours(lines: string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    let h = raw.replace(/^\s*hours(?: of operation| & admission)?\s*:?\s*/i, "").replace(/\s+/g, " ").trim();
    if (!h || SILENT.test(h)) continue;
    if (/\b(today|tonight|tomorrow|this week|open now|closed now|closes? (at|in)|opens? (at|in)|until \d)\b/i.test(h)) continue;
    if (/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d/i.test(h)) continue;
    const hasDay = /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b|\b(daily|every ?day|7 days|weekdays?|weekends?|seasonal|year[- ]round)\b/i.test(h);
    const hasTime = /\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.)|\d{1,2}:\d{2}|\bclosed\b|\b24 hours\b|dawn|dusk|sunrise|sunset/i.test(h);
    if (!(hasDay && hasTime) && !/\b(by appointment|reservation only|on request)\b/i.test(h)) continue;
    if (h.length > 140) h = h.slice(0, 140).replace(/\s+\S*$/, "");
    if (!out.includes(h)) out.push(h);
    if (out.length >= 7) break;
  }
  return out;
}

const DEFAULT_GAP = "Prices, hours and eligibility are not copied here yet. We will ask when you request.";

/** A chain's other venues, for nearest-location distance. Empty for the usual single-site operator. */
function extraLocations(operatorId: string): { city?: string; region?: string; lat: number; lon: number; street?: string }[] | undefined {
  const rows = db
    .prepare("SELECT city, region, street, lat, lon FROM locations WHERE operator_id = ? ORDER BY city LIMIT 60")
    .all(operatorId) as { city: string | null; region: string | null; street: string | null; lat: number; lon: number }[];
  if (!rows.length) return undefined;
  // A venue whose town the crawl never found keeps the honest gap. This used to write "Nearby", which became
  // the commonest town in the whole catalog: 64 venues, read by the app as a place name.
  return rows.map((l) => ({ city: l.city || undefined, region: l.region || undefined, lat: Math.round(l.lat * 1e4) / 1e4, lon: Math.round(l.lon * 1e4) / 1e4, street: l.street || undefined }));
}

/** "Deer Harbor Charters" and "DEER HARBOR CHARTERS LLC" are one business. */
function titleKey(t: string): string {
  return t.toLowerCase().replace(/\b(llc|inc|ltd|co|corp|company)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

/**
 * How many other operator domains publish the same image file. A theme's own placeholder, a parked-domain banner
 * and a photo library's sailboat all turn up on sites that have nothing to do with each other, and a photo like
 * that is the one thing we can prove is not this operator's. Counted once per process, over the whole catalog.
 */
let reuseByUrl: Map<string, number> | null = null;
function photoReuse(): Map<string, number> {
  if (!reuseByUrl) {
    reuseByUrl = new Map();
    const rows = db
      .prepare(
        `SELECT f.fact_value AS url, COUNT(DISTINCT o.domain) AS n FROM facts f
         JOIN operators o ON o.id = f.operator_id
         WHERE f.fact_key IN ('photo', 'cover') GROUP BY f.fact_value HAVING n > 1`,
      )
      .all() as { url: string; n: number }[];
    for (const row of rows) reuseByUrl.set(row.url, row.n - 1);
  }
  return reuseByUrl;
}

/** One operator in the shape the guest app's Unclaimed type expects. Facts only, nothing invented. */
export function toCatalogItem(r: CatalogRow): Record<string, unknown> {
  const dbOfferings = db
    .prepare("SELECT name, detail, duration, price_cents, price_unit, source_url, confidence FROM offerings WHERE operator_id = ? ORDER BY price_cents IS NULL, price_cents")
    .all(r.id) as { name: string; detail: string | null; duration: string | null; price_cents: number | null; price_unit: string | null; source_url: string | null; confidence: string }[];
  // The booking widget's own text (confidence 'widget') comes first: pick(k)[0] is then the operator's cancellation
  // policy, check-in note or requirement as their booking system states it, ahead of what a page scrape or a model read.
  const factRank = (c: string | null) => (c === "widget" ? 0 : c === "site" ? 1 : 2);
  const dbFacts = (db.prepare("SELECT fact_key, fact_value, source_url, confidence FROM facts WHERE operator_id = ?").all(r.id) as { fact_key: string; fact_value: string; source_url: string | null; confidence: string | null }[])
    .sort((a, b) => factRank(a.confidence) - factRank(b.confidence));
  // What the cloud structure crawl read off this operator's site. It runs on GitHub Actions, where there is no
  // database, so its rows reach a listing only here. Added, never substituted: a machine that already imported
  // the same work has these rows in SQLite, so the merge drops duplicates by name and by key rather than
  // printing every service twice, and a menu that came from a booking widget or an extraction still wins.
  // A chain location reads its brand's crawl: menu and descriptive facts are the brand's, location facts its own.
  const ownCrawl = crawledStructureFor(r.id);
  const crawled = ownCrawl.offerings.length || ownCrawl.facts.length || !isChainLocation(r.domain)
    ? ownCrawl
    : (() => {
        const b = crawledStructureFor(brandId(r.website));
        return { offerings: b.offerings, facts: b.facts.filter((f) => !LOCATION_FACT.test(f.fact_key)) };
      })();
  // A menu read from the operator's booking widget is the whole menu at today's prices. Rows a model or a page scrape
  // produced earlier ("ATV Premium Tour $20" beside the widget's "$108") are stale or wrong next to it, so they go.
  const widgetRows = dbOfferings.filter((o) => o.confidence === "widget");
  const menuRows = widgetRows.length ? widgetRows : dbOfferings;
  const hasDbPrice = menuRows.some((o) => o.price_cents != null);
  const seenOffering = new Set(menuRows.map((o) => (o.name + "|" + (o.detail || "") + "|" + (o.price_cents ?? "")).toLowerCase()));
  const rawOfferings = [
    ...menuRows,
    ...(hasDbPrice ? [] : crawled.offerings.filter((o) => !seenOffering.has((o.name + "|" + (o.detail || "") + "|" + (o.price_cents ?? "")).toLowerCase())).map((o) => ({ ...o, confidence: "crawl" }))),
  ].sort((a, b) => Number(a.price_cents == null) - Number(b.price_cents == null) || (a.price_cents ?? 0) - (b.price_cents ?? 0));
  const seenFact = new Set(dbFacts.map((f) => (f.fact_key + "|" + f.fact_value).toLowerCase()));
  const rawFacts = [...dbFacts, ...crawled.facts.filter((f) => !seenFact.has((f.fact_key + "|" + f.fact_value).toLowerCase()))];
  // Once any fact the crawl read off this operator's own pages is hacked-page spam, in any form isCompromisedText
  // knows, the whole page was hacked and nothing else the crawl read off it is trusted for this sync either, not
  // only the field that tripped the screen: a plain "banner.jpg" from a throwaway host next to a spam sentence is
  // just as much the hack's as the sentence itself, and an offering's own name ("MAXSLOT88 Tour · $0") can carry
  // the same injected text a blurb does. The operator's row (and so its claim link) is untouched; only what this
  // sync would have published from the crawl is withheld.
  const MEDIA_FACT_KEY = /^(photo|cover|video|video_embed|service_photo)$/;
  // A run of a script a fact has no business carrying (FOREIGN_SCRIPT_RUN) only counts toward the compromise
  // decision when it is isolated to one place. A hacked page injects spam into one field while the rest of the
  // operator's own facts stay in the site's real language; a genuinely bilingual listing (a Hawaii tour desk
  // that states every option's name in Japanese too, a dojo whose instructor bio repeats in Japanese) carries
  // the same script across more than one of its own facts or offerings, which is a deliberate feature of the
  // whole listing, not an anomaly. Found by the 16 September 2026 catalog scan: three real Hawaii operators
  // whose bilingual listings this exact rule was written to stop from being wrongly quarantined.
  const foreignScriptHits = [
    ...rawFacts.filter((f) => TEXT_KEYS.test(f.fact_key) && FOREIGN_SCRIPT_RUN.test(f.fact_value)),
    ...rawOfferings.filter((o) => FOREIGN_SCRIPT_RUN.test(o.name + " " + (o.detail || ""))),
  ];
  const isolatedForeignScript = foreignScriptHits.length === 1;
  const hasSpamText =
    rawFacts.some((f) => (TEXT_KEYS.test(f.fact_key) || MEDIA_FACT_KEY.test(f.fact_key)) && isCompromisedText(f.fact_value)) ||
    // The narrower phrase check, not the full one: a compact rate card can legitimately repeat a short phrase
    // across most of its own length, which is exactly the shape isKeywordStuffed looks for.
    rawOfferings.some((o) => isCompromisedPhrase(o.name + " " + (o.detail || "")));
  const spamCompromised = hasSpamText || isolatedForeignScript;
  if (spamCompromised) {
    const reason = hasSpamText ? "hacked-page spam in a crawled fact or offering" : "an isolated run of a script the rest of the listing never uses";
    console.warn(`[sync] quarantined ${r.domain} (o-${slug(r.domain)}): ${reason}`);
    cleanupLog?.quarantined.push({ id: r.domain, reason });
  }
  // The operator's own pages: the catalog domain, the website field's host (sister brand or a second domain),
  // and site-builder hosts they publish on (mammothpack.wixsite.com is still mammothpack).
  const trusted = (url: string | null) => sourceIsOwn(url, r.domain) || (r.website ? sourceIsOwn(url, hostOf(r.website)) : false) || sameBrand(url, r.domain);
  const offCity = (url: string | null) => sourceIsAnotherTown(url, r.city, r.metro_id);
  // Rows the audit showed to be noise: another business's page, another town's branch, merch, "not stated" filler, stale or junk lines.
  // A chain's pricing page often sits under another branch's path (/vaughan/hours-pricing on the Mississauga record).
  // Same-branch rows win; other-branch rows fill in only when this branch has none, since chain menus are shared.
  // A quarantined operator publishes no crawled offering either: a spam page's own menu names are as much the hack's as its blurb.
  const own = (spamCompromised ? [] : rawOfferings).filter((o) => trusted(o.source_url));
  const onSite = own.some((o) => !offCity(o.source_url)) ? own.filter((o) => !offCity(o.source_url)) : own;
  const isMerch = (o: { name: string; detail: string | null; source_url?: string | null }) => MERCH.test(o.name + " " + (o.detail || "")) || /\/(merch|shop|apparel)(\/|$)/i.test((o.source_url || "").replace(/^https?:\/\/[^/]+/, "")) || (SPIRITS.test(o.name) && !/tasting|tour|flight|class|experience|pairing|session/i.test(o.name + " " + (o.detail || "")));
  const merchCount = onSite.filter(isMerch).length;
  // A menu that is nothing but products is a shop, not an experience menu. Otherwise keep the bookable rows and drop the merch.
  const offerings = (merchCount > 0 && merchCount === onSite.length ? [] : onSite.filter((o) => !isMerch(o)))
    .filter((o) => !RESELLER.test(o.name + " " + (o.detail || "")))
    .filter((o) => !FILTER_LABEL.test(o.name))
    // A taproom's "Food $4" or "Beer $7.50" is a menu category, not something a guest books a time for.
    .filter((o) => !(MENU_CATEGORY.test(o.name) && (o.price_cents == null || o.price_cents < 3000)))
    // A $1 line is a deposit, a token or a placeholder; a $19,995 line is a boat for sale. Neither is a price a guest pays here.
    .filter((o) => !isForSale(o))
    // "May 8, 2026, 9 a.m. check-in, 10:30 a.m. shotgun start" is one event's timetable, not a tier a guest books.
    .filter((o) => !isEventSchedule(silent(o.duration) || silent(o.detail) || ""))
    .map((o) => ({ ...o, name: collapseRepeats(fixShouting(trimWords(o.name, 70))), price_cents: o.price_cents != null && o.price_cents < 200 ? null : o.price_cents }))
    // A half-day trip does not cost four dollars: keep the line, drop the number, let the page say "Price on request".
    .map((o) => {
      const why = implausiblePrice(o);
      if (!why) return o;
      if (cleanupLog) cleanupLog.priceNulled.push({ id: r.domain, name: o.name, oldPrice: o.price_cents! / 100, why });
      return { ...o, price_cents: null };
    })
    // One line per service and tier. The AI pass and the booking widget both describe "Seakart Adventure · 1 hour",
    // one with the price and one without; rows are sorted priced-first and cheapest-first, so the first twin is the
    // one a guest should see and the unpriced or dearer repeat goes. Until 2026-09-14 the price was part of the
    // key, so a listing showed "1 hour $219" and "1 hour Price on request" side by side.
    // Two rows are the same option when name and label match; the label is the detail, and the duration only when there is none.
    .filter((o, i, a) => a.findIndex((x) => x.name.toLowerCase() === o.name.toLowerCase() && (x.detail || x.duration || "").toLowerCase() === (o.detail || o.duration || "").toLowerCase()) === i)
    .map((o) => ({ ...o, price_unit: fixUnit(o) }));
  const title = cleanTitle(decodeEntities(r.name), { city: r.city, region: r.region, legalName: r.legal_name });
  const keysWithOwnBranch = new Set(rawFacts.filter((f) => trusted(f.source_url) && !offCity(f.source_url)).map((f) => f.fact_key));
  // A quarantined operator's record stays (its title, domain, category and location all come from the operators
  // table, not the crawl, so the listing still exists to browse and its claim link still works), but nothing the
  // crawl read off its site publishes: no text fact, no offering, no photo. See spamCompromised above.
  const facts = spamCompromised
    ? []
    : rawFacts.filter((f) => {
        if (!trusted(f.source_url)) return false;
        if (offCity(f.source_url) && keysWithOwnBranch.has(f.fact_key)) return false;
        if (TEXT_KEYS.test(f.fact_key)) {
          const v = f.fact_value;
          if (GAP_LINE.test(v) || JUNK_LINE.test(v) || RETAIL_LINE.test(v) || STALE_LINE.test(v)) return false;
        }
        return true;
      });
  const pick = (k: string) => facts.filter((f) => f.fact_key === k).map((f) => (/^(photo|video|yt_video|social:)/.test(k) ? f.fact_value : decodeEntities(f.fact_value)));
  // Booking-widget item photos are the operator's own curated product shots. They beat whatever the crawl scored highest.
  const widgetPhotos = uniq(facts.filter((f) => f.fact_key === "photo" && /fareharbor|xola|filestack/i.test((f.source_url || "") + " " + f.fact_value)).map((f) => f.fact_value));
  // Discovery filed map-search results under the query's kind, so a surf shop found by "jet ski rental" became a
  // jet ski rental. Settle the kind from the listing's own words; see artEvidence.ts.
  const kindText = [r.domain, ...rawOfferings.map((o) => o.name), ...rawFacts.filter((f) => /^(service|tag|description|site_desc|one_line|service_desc)$/.test(f.fact_key)).map((f) => f.fact_value)].join(" \n ");
  const kind = reconcileArt(artFromName(r.name, r.icon_key), r.name, kindText);
  const art = kind.art;
  // A service that has a price never also says "Price on request". When one source read the price and another
  // did not, the unpriced twin is the weaker read of the same menu, and a guest should see one line, priced.
  // Likewise a source that read no price at all (an extraction that missed the pricing page, a widget whose
  // prices sit behind its calendar) read the menu worse than the source that did, so its unpriced lines go too.
  const pricedNames = new Set(offerings.filter((o) => o.price_cents != null).map((o) => plainName(o.name, art).toLowerCase()));
  const pricedSources = new Set(offerings.filter((o) => o.price_cents != null).map((o) => o.confidence));
  // A bare name with no tier ("Package · Standard · Price on request") next to priced tiers is noise, not a menu line.
  const menu = offerings.filter((o) => o.price_cents != null || !pricedSources.size || (pricedSources.has(o.confidence) && !pricedNames.has(plainName(o.name, art).toLowerCase()) && !!(silent(o.duration) || silent(o.detail))));
  // One unit per service: the tiers of a rate card are priced the same way, so the cheapest priced tier's unit is the
  // service's. Without this a $650 eight-hour tier read as "/group" beside hourly tiers that said nothing.
  const unitByService = new Map<string, string | undefined>();
  for (const o of menu) {
    const k = plainName(o.name, art).toLowerCase();
    if (o.price_cents != null && !unitByService.has(k)) unitByService.set(k, o.price_unit && o.price_unit.startsWith("/") ? o.price_unit : undefined);
  }
  const perOf = (o: { name: string; price_unit: string | null }) => {
    const k = plainName(o.name, art).toLowerCase();
    return unitByService.has(k) ? unitByService.get(k) : o.price_unit && o.price_unit.startsWith("/") ? o.price_unit : undefined;
  };
  const { optionIdxOf, menuRowOf } = bookableOptions(menu, art);
  // The family is the tab a guest browses under (`inCat` in src/data/categories.ts), and the kind is the chip
  // inside it, so the two have to agree. Following discovery's family unless `reconcileArt` moved the kind left
  // 529 listings in a tab their own kind is not in, because a name settles the kind too: 119 parasail operators
  // were under Water rather than Air, and 198 airboat and swamp tours were under Water rather than Outdoor.
  const family = familyForArt(art, r.family);
  /**
   * Cover choice, re-derived from facts we already hold. The order below is the order this function used to
   * publish, so the widget shots still lead and a tie changes nothing; `rankForCover` only moves a photo up when
   * its file name, the page it came from or the booking item it illustrates says more about this business than the
   * one above it. The alt text is the one signal the facts table does not keep, so the crawl scores that itself.
   * Nothing is dropped: the rest stay in the gallery. This is why a better cover does not need a re-crawl.
   */
  const photoPage = new Map<string, string>();
  for (const f of facts) if ((f.fact_key === "photo" || f.fact_key === "cover") && f.source_url && !photoPage.has(f.fact_value)) photoPage.set(f.fact_value, f.source_url);
  const photoItem = new Map<string, string>();
  for (const raw of pick("service_photo")) {
    try {
      const d = JSON.parse(raw) as { name: string; url: string };
      if (d.url && !photoItem.has(d.url)) photoItem.set(d.url, d.name);
    } catch {
      /* ignore */
    }
  }
  // Every other photo from a booking widget came off one item's page, so that item names it too.
  const itemByPage = new Map<string, string>();
  for (const o of rawOfferings) if (o.source_url && !itemByPage.has(o.source_url)) itemByPage.set(o.source_url, o.name);
  const ranked = rankForCover(
    // Photos the cloud crawl found go in behind the operator's own crawled set: when this machine has never
    // fetched the site, they are all there is, and when it has, the older harvest already earned its order.
    // cleanImageUrl first: crawls before 14 September 2026 split srcset on every comma and stored pieces of
    // Wix and Cloudinary transform URLs, which resolve to pages that do not exist.
    keepScreened(uniq([...widgetPhotos, ...pick("cover"), ...pick("photo"), ...crawledPhotosFor(r.id).photos, ...(isChainLocation(r.domain) ? crawledPhotosFor(brandId(r.website)).photos : [])].map(cleanImageUrl).filter((u): u is string => !!u).filter(isPhotoName))).map((url) => ({
      url,
      page: photoPage.get(url) || null,
      item: photoItem.get(url) || itemByPage.get(photoPage.get(url) || "") || null,
      curated: WIDGET_HOSTS.test(url),
      reuse: photoReuse().get(url) || 0,
    })),
    { title, art, family: r.family || "water" },
  ).map((p) => fullSize(p.url) || "");
  // The screen judges the address the site publishes, which is after fullSize rewrites a Wix or Squarespace
  // transform. Checking before that rewrite never found the verdict, so rejected logos came straight back.
  const screenedRanked = keepScreened(ranked.filter(Boolean));
  const region = regionCode(r.region);
  const area = r.city ? (region && !r.city.includes(region) ? r.city + ", " + region : r.city) : region || "";
  const item: Record<string, unknown> = {
    id: "o-" + slug(r.domain),
    claimKey: claimKeyHash("o-" + slug(r.domain)),
    title,
    cat: family || "water",
    // The test listing (origin 'test') is published like any other shop, in every list, search, rail and landing
    // page, so the founder can use it as a real business end to end. Only outreach skips it. The `unlisted` flag
    // stays supported for a listing that should exist without being seen. See backend/scripts/test-listing.mts.
    // True when nothing in the listing's own text confirms its kind yet; rails put these after confirmed ones.
    ...(kind.confirmed ? {} : { kindUnconfirmed: true }),
    art,
    area,
    metroId: metroFor(r),
    src: r.domain,
    // Discovery's rating wins. When discovery had none, the operator's own published AggregateRating stands in, the
    // one the site crawl read from its structured data; the cloud crawl only reaches listings through its facts.
    ...(() => {
      if (r.rating != null) return { rating: r.rating, reviews: r.review_count ?? undefined };
      try {
        const a = JSON.parse(pick("aggregate_rating")[0] || "null") as { rating?: number; count?: number; ratingValue?: number; reviewCount?: number } | null;
        const rating = Number(a?.rating ?? a?.ratingValue);
        const count = Number(a?.count ?? a?.reviewCount);
        return rating >= 1 && rating <= 5 && count >= 1 ? { rating: Math.round(rating * 10) / 10, reviews: count } : { rating: undefined, reviews: r.review_count ?? undefined };
      } catch {
        return { rating: undefined, reviews: r.review_count ?? undefined };
      }
    })(),
    specs: uniq([...pick("spec"), ...pick("requirement"), ...pick("group")].map((s) => tidyDashes(cleanLine(s)))).filter(isTidyLine).slice(0, 10),
    // Names and details in plain words (plainServices.ts): the same cleaning the services below get, so the booking
    // picker's sub-line and a service's tier label never disagree. A membership or a gift card is not an experience
    // a guest books a slot for, and the services list below already knows that; this row feeds a card's "from"
    // price too, so a $10 membership tier was quoting a charter's price as a season pass, not a trip out.
    options: menu.filter((_o, idx) => optionIdxOf.has(idx)).map((o) => {
      const name = tidyRowName(plainName(o.name, art));
      const price = o.price_cents == null ? null : o.price_cents / 100;
      return {
        name,
        // The label a guest picks is the row's own detail ("Adult", "Single Rider", "Two Hour Rental"); the duration
        // only stands in when there is none. Duration first collapsed five jet ski tiers into one "1 to 3 hours" row.
        detail: plainLabel(silent(o.detail) || silent(o.duration) || "", { service: name, kind: art, price }) || "",
        price,
        per: perOf(o),
      };
    }),
    services: (() => {
      const descs = new Map<string, string>();
      for (const raw of pick("service_desc")) {
        try {
          const d = JSON.parse(raw) as { name: string; desc: string };
          descs.set(d.name.toLowerCase(), scrubDesc(d.name, d.desc));
        } catch {
          /* ignore */
        }
      }
      const photos = new Map<string, string>();
      for (const raw of pick("service_photo")) {
        try {
          const d = JSON.parse(raw) as { name: string; url: string };
          // A service thumbnail from the old comma-splitting parser points at a page that does not exist.
          const url = cleanImageUrl(d.url);
          if (url) photos.set(d.name.toLowerCase(), url);
        } catch {
          /* ignore */
        }
      }
      // A booking-widget item page ("fareharbor.com/.../items/538950/") is about one service, and the photos read off
      // it are that item's own product shots. When a service has no thumbnail and every menu row on such a page is
      // this service, its first screened photo becomes the service's picture. Nothing else is guessed.
      const screenedSet = new Set(screenedRanked);
      const photosByItemPage = new Map<string, string[]>();
      for (const f of facts) {
        if ((f.fact_key !== "photo" && f.fact_key !== "cover") || !f.source_url || !WIDGET_HOSTS.test(f.source_url) || !/\/items?\/\d+|\/products?\/\d+/i.test(f.source_url)) continue;
        const url = fullSize(cleanImageUrl(f.fact_value) || "") || "";
        if (!url || !screenedSet.has(url)) continue;
        const list = photosByItemPage.get(f.source_url) || [];
        if (!list.includes(url)) list.push(url);
        photosByItemPage.set(f.source_url, list);
      }
      const namesByPage = new Map<string, Set<string>>();
      for (const o of menu) if (o.source_url) namesByPage.set(o.source_url, (namesByPage.get(o.source_url) || new Set()).add(o.name.toLowerCase()));
      const groups = new Map<string, RawService & { pages: Set<string> }>();
      menu.forEach((o, idx) => {
        const optionIdx = optionIdxOf.get(idx);
        if (optionIdx == null) return;
        const rawKey = o.name.toLowerCase();
        // Grouped by the plain name, so "4 Hr Charter" and "4 Hour Charter" are one service.
        const name = tidyRowName(plainName(o.name, art));
        const key = name.toLowerCase();
        // A service thumbnail goes through the same screen: a logo or a dead link on a menu row is as broken as one in the gallery.
        const svcPhoto = fullSize(photos.get(rawKey) || "") || undefined;
        const g = groups.get(key) || { name, desc: descs.get(rawKey) || null, photo: svcPhoto && keepScreened([svcPhoto]).length ? svcPhoto : undefined, variants: [], pages: new Set<string>() };
        if (!g.desc && descs.get(rawKey)) g.desc = descs.get(rawKey)!;
        if (o.source_url) g.pages.add(o.source_url);
        g.variants.push({
          label: silent(o.duration) || silent(o.detail) || STANDARD,
          price: o.price_cents == null ? null : o.price_cents / 100,
          per: perOf(o),
          optionIdx,
        });
        groups.set(key, g);
      });
      for (const g of groups.values()) {
        if (g.photo) continue;
        for (const page of g.pages) {
          const names = namesByPage.get(page);
          const pics = photosByItemPage.get(page);
          if (pics?.length && names && [...names].every((n) => plainName(n, art).toLowerCase() === g.name.toLowerCase())) {
            g.photo = pics[0];
            break;
          }
        }
      }
      // Plain labels, jargon explained, long size or count runs folded (plainServices.ts). Tiers that were event timetables are gone.
      const plain = plainServices([...groups.values()].map(({ pages: _p, ...g }) => g), art);
      // Plain labels fold "2.5 hrs" and "2.5 hours" into one wording, so twins can only be seen now: the same tier at
      // the same price (or one unpriced) is one line, and the same tier at two prices keeps each raw name in front.
      for (const g of plain) {
        const kept: typeof g.variants = [];
        for (const v of g.variants) {
          const twin = kept.find((k) => k.label.toLowerCase() === v.label.toLowerCase());
          if (!twin) {
            kept.push(v);
            continue;
          }
          if (twin.price == null || v.price == null || twin.price === v.price) {
            if (twin.price == null && v.price != null) Object.assign(twin, { price: v.price, per: v.per, optionIdx: v.optionIdx });
            continue;
          }
          const rawT = menu[menuRowOf[twin.optionIdx]]?.name || "";
          const rawV = menu[menuRowOf[v.optionIdx]]?.name || "";
          if (rawT && rawV && rawT.toLowerCase() !== rawV.toLowerCase()) {
            if (!twin.label.toLowerCase().startsWith(rawT.toLowerCase())) twin.label = rawT + " · " + twin.label;
            kept.push({ ...v, label: rawV + " · " + v.label });
          } else if (v.price < twin.price) {
            Object.assign(twin, { price: v.price, per: v.per, optionIdx: v.optionIdx });
          }
        }
        g.variants = kept;
      }
      return plain.filter((g) => !/gift ?cards?|gift certificate|deposit|membership|season pass/i.test(g.name)).slice(0, 14);
    })(),
    // "Private Ride for Two: up to 1 guests per booking" is a group cap, and "What to Bring: ..." belongs under bring.
    includes: uniq(pick("includes").map(cleanLine)).filter(isTidyLine).filter((l) => !/gift ?card|gift certificate|will be provided upon|directions will|upon purchas|up to \d+ guests? per booking|minimum \d+ guests? per booking|^what to bring\b/i.test(l)).slice(0, 10),
    addons: pick("addon")
      .map((a) => {
        const m = a.match(/^(.*?)\s*\$(\d+(?:\.\d+)?)$/);
        return m ? { name: m[1].trim().replace(/\s+(for|at|only|just|from|is)$/i, ""), detail: "", price: Number(m[2]) } : null;
      })
      .filter((a): a is { name: string; detail: string; price: number } => !!a)
      // "An additional $35" is a fee sentence, not something a guest adds to a cart.
      .filter((a) => a.name.length >= 3 && !/^(an?|the|plus|extra|additional|only|just|from|starting|starts|add|adds|is|are|and|or|for)\b/i.test(a.name) && !/\b(fee|surcharge|deposit|tax|gratuity|tip|per person|per hour)\b/i.test(a.name))
      .slice(0, 6),
    // The honest gap line. Once the widget or crawl gave real rules and policies, say those instead of "not copied yet".
    // "Exact prices not stated" was written by an extraction that never saw the pricing page; once a menu line has a price, that gap is stale.
    gap: pick("published_gap").filter((g) => !(menu.some((o) => o.price_cents != null) && /\b(price|prices|pricing|rates?|costs?)\b/i.test(g)))[0] || pick("cancellation")[0] || (pick("policy").length || pick("requirement").length ? [...pick("policy")].slice(0, 3).join(" ") || "Ask the operator about cancellations." : DEFAULT_GAP),
    blurb: (() => {
      // The first source whose text survives cleaning wins: a description that is all headings falls through to the meta line.
      const b = [pick("description")[0], pick("site_desc")[0], pick("one_line")[0]].map((raw) => cleanBlurb(raw || "", { title, city: r.city, region: r.region })).find(Boolean) || "";
      return b && !/\b(purchase|shop|buy) (boards|paddles|gear|apparel|merch)/i.test(b) ? b : undefined;
    })(),
    cover: screenedRanked.find(Boolean) || undefined,
    photos: uniq(screenedRanked).slice(0, 10),
    ytVideos: pick("yt_video")
      .map((raw) => {
        try {
          const v = JSON.parse(raw) as { id: string; title: string; views: number };
          return { id: v.id, title: v.title, views: v.views };
        } catch {
          return null;
        }
      })
      .filter((v): v is { id: string; title: string; views: number } => !!v)
      .slice(0, 3),
    tiktok: pick("tiktok_profile")[0] || undefined,
    instagram: pick("social:instagram")[0] || undefined,
    // The clip leads the hero, in front of every photo and under a "Video" badge, and it was the one image on a
    // listing that no screen ever looked at: photos pass cleanImageUrl, isPhotoName, the photo screen's verdicts
    // and fullSize, and the video fact passed none of them. So 1,062 listings led with whatever the crawl found,
    // among them a WordPress.com beacon reading "site-not-found", four CleanTalk spam-filter pixels, a PayPal
    // Buy Now button, a Facebook login button, a TripAdvisor badge, a Google Maps close icon, a scorecard, a
    // course map, a registrar's required-field icon and eleven spacer GIFs. Hold it to the same screens: what
    // survives is the shop's own moving cover, and what does not falls back to the cover the photo screen chose.
    // Every candidate is screened, not only the best-scoring one, so a beacon in front of a real clip costs the
    // clip nothing. A GIF is judged as the picture it is, by the same name rules as a photo; a real video file
    // is judged only on whether a guest can load it, because those rules read a file name for a scanned page
    // and a brewery's own hero clip is called 7-Seas-Home-Page-1-1.mp4.
    video: keepScreened(pick("video").filter((u) => (/\.gif(\?|$)/i.test(u) ? isPhotoName(u) : true)).filter((u) => !!fullSize(u)))[0] || undefined,
    videoEmbed: pick("video_embed")[0] || undefined,
    lat: r.lat ?? undefined,
    lon: r.lon ?? undefined,
    locations: extraLocations(r.id),
    tags: uniq([...pick("google_category"), ...pick("service"), ...offerings.map((o) => o.name)].map((t) => collapseRepeats(fixShouting(t)))).filter((t) => !NOT_A_SERVICE.test(t) && !NAV_LABEL.test(t)).slice(0, 12),
    extraNote: [...pick("extra").slice(0, 1), ...pick("policy"), ...pick("checkin"), ...pick("meeting_point"), ...pick("season")].filter((l) => !SILENT.test(l)).join(" · ").slice(0, 700) || undefined,
    // Viator-shaped sections. Each only appears when the site said it.
    highlights: collapseRules(uniq(pick("spec").map((s) => tidyDashes(cleanLine(s)))).filter(isTidyLine).filter((l) => !/^what to bring\b|you are required to bring/i.test(l))).slice(0, 8),
    requirements: collapseRules(uniq(pick("requirement").map(cleanLine)).filter(isTidyLine)).slice(0, 10),
    groupInfo: uniq(pick("group").map(cleanLine)).filter(isTidyLine).slice(0, 5),
    bring: uniq([...pick("bring"), ...[...pick("spec"), ...pick("includes")].filter((l) => /^what to bring\b/i.test(l)).map((l) => l.replace(/^what to bring[:\s-]*/i, ""))].map(cleanLine)).filter(isTidyLine).slice(0, 8),
    season: silent(cleanLine(pick("season")[0] || "")) || undefined,
    meetingPoint: cleanLine(pick("meeting_point")[0] || "") || undefined,
    checkin: cleanPara(pick("checkin")[0] || "") || undefined,
    cancellation: dropSilent(cleanPara(pick("cancellation")[0] || "")) || dropSilent(cleanPara(pick("policy").filter((l) => /cancel|refund/i.test(l)).join(" "))) || undefined,
    policies: uniq(pick("policy").map(cleanLine)).filter(isTidyLine).filter((l) => !/gift ?card|gift certificate/i.test(l)).slice(0, 8),
    waiverUrl: pick("waiver_url").find((u) => /^https?:\/\/\S+$/.test(u) && !/\/w\/?$/.test(u)) || undefined,
    hoursText: uniq([...pick("hours_text"), ...pick("hours")].flatMap((h) => h.split(/\s*\|\s*/)).map((h) => cleanLine(h.replace(/^hours(?: & admission)?\s*/i, ""))).filter((h) => h.length > 3 && !/not stated/i.test(h) && HAS_TIME.test(h) && !/[ap]m[A-Za-z]/.test(h) && isTradingHoursLine(h))).slice(0, 7),
    faq: uniqBy(pick("faq").flatMap(parseFaqs), (f) => f.q.toLowerCase()).slice(0, 8),
    // Reviews read off the operator's own pages, in either stored shape; see quotes.ts and reviews.ts for the rules.
    quotes: quotesFromFacts(facts.filter((f) => f.fact_key === "review").map((f) => ({ value: decodeEntities(f.fact_value), sourceUrl: f.source_url }))),
    dur: durationOf(offerings.map((o) => o.duration || o.detail || "")) || undefined,
    // Judged against every line the shop publishes about cancelling, not just the first, because the promise
    // to a guest who cancels and the promise about a trip the shop calls off are often in different lines.
    fc:
      freeCancel(
        cleanPara(pick("cancellation")[0] || "") || pick("policy").filter((l) => /cancel|refund/i.test(l)).join(" "),
        [cleanPara(pick("cancellation")[0] || ""), ...pick("policy").filter((l) => /cancel|refund/i.test(l))].join(" "),
      ) || undefined,
    // Day-specific deals the site states (scripts/promo-crawl.mts), consolidated into at most three clear offers by
    // dealText.ts: one title, the operator's most complete sentence, the stated days and code. Never invented.
    // `text` stays for older readers of the detail file and carries the detail sentence (or the title when there is none).
    promos: (() => {
      const deals = consolidateDeals(
        facts
          .filter((f) => f.fact_key === "promo")
          .map((f): { text: string; days: number[]; start?: string; end?: string } | null => {
            try {
              const p = JSON.parse(f.fact_value) as { text: string; days: number[]; start?: string; end?: string };
              return typeof p.text === "string" && Array.isArray(p.days) ? { text: decodeEntities(p.text), days: p.days, start: p.start, end: p.end } : null;
            } catch {
              return null;
            }
          })
          .filter((p): p is { text: string; days: number[]; start?: string; end?: string } => !!p && p.text.length <= 160)
          .filter((p, i, a) => a.findIndex((x) => x.text.toLowerCase() === p.text.toLowerCase()) === i),
      );
      return deals.length ? deals.map((d) => ({ text: d.detail || d.title, ...d })) : undefined;
    })(),
  };
  return tidyItem(item, r.domain);
}

/**
 * "2 hours", "90 min", "1 to 4 hours": the first duration the menu states, and the `dur` every guest surface
 * prints. The rule moved to `src/lib/duration.ts` so that the guest page, which derives one when this wrote
 * none, and Otto, who answers "how long is it?", cannot read the same menu line differently. The line-wide
 * test this used to run also threw away a "4-hour experience with priority scheduling", because "priority"
 * carries "prior"; only the span a notice rule governs goes now.
 */
function durationOf(texts: string[]): string | null {
  return durationFrom(texts);
}

/**
 * "Free cancellation up to 48 hours before", only when the operator's own words promise a full refund, and
 * only when that promise is one they make to a guest who cancels. A shop that refunds a trip it calls off
 * itself for weather is not offering free cancellation, and 31 shipped listings carried the badge on the
 * strength of exactly that sentence. The rule is `src/lib/cancellation.ts`, which every guest surface reads
 * too, so a claimed shop's own policy text is judged the same way.
 */
function freeCancel(text: string, corpus?: string): string | null {
  if (!text || !/full refund|free cancellation|100% refund|fully refundable/i.test(text)) return null;
  if (/non-?refundable|no refunds?\b/i.test(text) && !/full refund/i.test(text)) return null;
  if (onlyOperatorCancels(corpus || text)) return null;
  const m = text.match(/(\d+)\s*(hours?|hrs?|days?)/i);
  if (!m) return "Free cancellation";
  const n = Number(m[1]);
  const unit = /day/i.test(m[2]) ? (n === 1 ? "day" : "days") : n === 1 ? "hour" : "hours";
  return "Free cancellation up to " + n + " " + unit + " before";
}

/* ---------- audit-driven filters (9 Sept 2026 data QA) ---------- */

const WIDGET_HOSTS = /fareharbor|xola|peek\.com|bookeo|rezdy|checkfront|filestack|resova|fareharbor/i;
const TEXT_KEYS = /^(requirement|policy|bring|meeting_point|group|includes|spec|cancellation|checkin|faq|hours_text|season|description|one_line|site_desc)$/;
const GAP_LINE = /\b(not (stated|specified|mentioned|listed|published|provided|available on)|no specific .* (stated|listed|mentioned)|^not stated$|no information (available|provided))\b/i;
const JUNK_LINE = /\b(call|contact|phone|email)( us)? (for|to)\b|\bsee (the |our )?faq|\bclick here|\bprint and color|\bsubscribe|\bnewsletter|\bfollow us|\bcookie|\bprivacy policy|\bterms (of|and) (service|use|conditions)|all rights reserved|©|\bcopyright\b|\bconsent to (the use|cookies|tracking)|\benable javascript|\bjavascript\b|\baccept all\b|\bopt[- ]?out\b|\bpowered by\b|\bwebsite by\b|\bskip to (main )?content|\btoggle (menu|navigation)/i;
const RETAIL_LINE = /\b(restocking|rma\b|return shipping|return merchandise|free shipping|ships? within|shipping (cost|rate|polic)|in-?store pickup|wholesale)\b/i;
/**
 * A hacked WordPress page: SEO spam injected into a fact an operator never wrote. 97 published listings
 * carried gambling spam as their blurb, a museum's or a golf course's cover photo a "slot gacor" banner from a
 * throwaway domain. "Book your slot online" is a real sentence a booking page writes, so a bare "slot" plus
 * "online" is not enough; every phrase here is a spam term on its own, whichever category or language the
 * injected page used, not something an English, French or Spanish tour operator's page would write about its
 * own business. Categories: gambling and betting, counterfeit pharmacy, essay mills, crypto/forex pump
 * schemes, adult content, replica goods, payday-loan spam. `\b` only delimits correctly around scripts where
 * JS treats the letters as "word" characters (Latin, including Vietnamese's diacritics, since a phrase like
 * "cờ bạc" still starts and ends on a plain ASCII letter); CJK and Cyrillic spam terms are matched as a plain
 * substring instead, in `HACKED_SCRIPT_SPAM` below, since wrapping them in `\b` would silently never match.
 */
export const SPAM_LINE =
  /\b(slot\s?(?:gacor|777|88|demo|jackpot)|situs\s+(?:slot|judi)|judi\s+(?:online|slot|bola)|togel|maxwin|rtp\s?(?:live|slot)|bandar\s?(?:slot|judi|togel)|agen\s?(?:slot|judi)|link\s?slot|jackpot\s?slot|deposit\s?(?:pulsa|dana|ovo|gopay|qris)|pg\s?soft|pragmatic\s?play|daftar\s?(?:slot|situs)\s?(?:online|resmi)|casino\s?en\s?ligne\s?(?:gratuit|argent\s?r[ée]el)|paris\s?sportifs?\s?en\s?ligne|casino\s?online\s?(?:gratis|dinero\s?real)|apuestas\s?deportivas\s?online|tragamonedas\s?online|cờ\s?bạc\s?trực\s?tuyến|casino\s?trực\s?tuyến|nhà\s?cái\s?uy\s?tín|cá\s?cược\s?bóng\s?đá|đánh\s?bạc\s?online|buy\s?(?:viagra|cialis|xanax|valium|oxycontin|vicodin|percocet|adderall|tramadol|ambien|klonopin|phentermine)\s?(?:online|no\s?prescription)|(?:viagra|cialis)\s?(?:online|without\s?a?\s?prescription)|generic\s?viagra\s?online|order\s?xanax\s?online|xanax\s?(?:online|without\s?(?:a\s?)?prescription|for\s?sale)|oxycontin\s?(?:online|for\s?sale)|oxycodone\s?(?:online|for\s?sale|no\s?prescription)|vicodin\s?(?:online|for\s?sale)|percocet\s?(?:online|for\s?sale)|adderall\s?(?:online|without\s?prescription|for\s?sale)|tramadol\s?(?:online|for\s?sale|no\s?prescription)|buy\s?painkillers?\s?online|buy\s?(?:an?\s?)?essays?\s?online|write\s?my\s?(?:essay|paper|assignment)\s?(?:for\s?me|online|cheap)|essay\s?writing\s?service|paper\s?writing\s?service|dissertation\s?writing\s?service|homework\s?help\s?online|coursework\s?writing\s?service|plagiarism[- ]free\s?essays?|custom\s?essays?\s?(?:online|cheap)|pay\s?(?:someone|for)\s?to\s?write\s?my\s?(?:essay|paper)|forex\s?trading\s?signals?|forex\s?robot\s?(?:ea)?|binary\s?options?\s?(?:trading|broker|signals?)|crypto(?:currency)?\s?trading\s?bot|bitcoin\s?(?:mining|investment)\s?(?:platform|program)|guaranteed\s?(?:daily|weekly|monthly)\s?(?:profit|returns?|roi)|double\s?your\s?(?:bitcoin|investment)\s?(?:in|within)|pip\s?signals?\s?service|xxx\s?(?:videos?|cams?|tube|movies?)|live\s?sex\s?cams?|nude\s?cams?\s?(?:free|online)|adult\s?dating\s?(?:site|online)|escorts?\s?(?:in|near)\s?(?:you|me)\b|hardcore\s?porn(?:hub)?|free\s?porn\s?(?:videos?|tube)|replica\s?(?:watches?|handbags?|designer\s?bags?|sneakers?)|aaa\s?replica\s?(?:watches?|bags?)|fake\s?(?:rolex|designer)\s?(?:watches?|bags?)|knockoff\s?designer\s?(?:bags?|watches?)|super\s?clone\s?(?:watches?|rolex)|payday\s?loans?\s?(?:online|no\s?credit\s?check|instant\s?approval)|instant\s?cash\s?loans?\s?no\s?credit\s?check|bad\s?credit\s?loans?\s?guaranteed\s?approval|same[- ]day\s?loan\s?approval|no\s?credit\s?check\s?loans?\s?online)\b/i;
/** The same categories, in scripts `\b` does not delimit: matched as a plain substring, not word-wrapped. */
const HACKED_SCRIPT_SPAM =
  /казино\s?онлайн|игровые\s?автоматы|ставки\s?на\s?спорт|букмекерск(?:ая|ой|ую|ий)?\s?контор|займ\s?онлайн\s?без\s?отказа|オンラインカジノ|パチスロ|賭博サイト|スロットオンライン|出会い系サイト|澳门赌场|在线赌场|网络赌场|老虎机游戏|博彩公司|六合彩开奖|正规代写|论文代写/i;
/**
 * A run of 8 or more CJK, Hangul, Cyrillic, Thai or Arabic characters in a fact the crawl expects to be
 * English, French or Spanish text (this catalog is US and Canada operators, `AGENTS.md`). A real operator's
 * page does not carry a paragraph in a script the rest of its own site never uses; a hacked page injecting
 * spam in the attacker's own language does. A short foreign word (a dish name, a loanword) is not enough to
 * flag on its own; a run this long is not something the extractor would otherwise pull off an English page.
 */
export const FOREIGN_SCRIPT_RUN = /[぀-ヿ㐀-鿿가-힯Ѐ-ӿ฀-๿؀-ۿ]{8,}/;
/**
 * The same three-word (ten character or longer) phrase repeated five or more times, AND making up over a
 * third of the whole field by character count: a spam generator's signature, not something a person writes.
 * Both bars matter. A rate card naming five boat tiers repeats "Hour Private Charter" as many times as a spam
 * page repeats a phrase, but that repeat is a fifth of a much longer price list, not most of the text; a real
 * multi-offering page's shared cancellation sentence turns up three or four times across the page, not five.
 * Checked once against every field this run flagged on the published catalog (script scan, 16 Sept 2026,
 * see the security review report): at these two bars together, zero of the sixty-odd genuine boat-rate-card,
 * event-calendar and repeated-disclaimer fields it originally caught still trip it.
 */
function isKeywordStuffed(text: string): boolean {
  const words = text.toLowerCase().match(/[a-z0-9']+/g);
  if (!words || words.length < 16) return false;
  const counts = new Map<string, number>();
  for (let i = 0; i + 2 < words.length; i++) {
    const phrase = words[i] + " " + words[i + 1] + " " + words[i + 2];
    if (phrase.length < 10) continue;
    counts.set(phrase, (counts.get(phrase) || 0) + 1);
  }
  let top = 0;
  let topPhrase = "";
  for (const [phrase, count] of counts) {
    if (count > top) {
      top = count;
      topPhrase = phrase;
    }
  }
  return top >= 5 && (top * topPhrase.length) / text.length >= 0.35;
}
/**
 * A handful of single words real gambling spam repeats far more than any legitimate business copy would, but
 * only when the same word keeps turning up right next to itself: "casino pin up casino pin up casino" repeats
 * within a few words every time, where a real business that happens to be named for, or sit next to, a casino
 * ("Casino Parties LLC", the "4 Way Casino" next to an RV park) says the word occasionally across a whole
 * paragraph, never twice within a handful of words of each other more than once or twice. Three such tight
 * repeats is not something ordinary prose produces. "slot" is deliberately not in this list: a real booking
 * page can legitimately say it several times ("Slot 1: 9am, Slot 2: 11am..."); `SPAM_LINE` already covers
 * "slot" paired with a betting word. Checked against every "casino"-adjacent listing the 16 September 2026
 * catalog scan turned up (the security review report): this version no longer catches either.
 */
const SUSPECT_WORDS = new Set(["casino", "jackpot", "bettor", "judi", "togel", "taruhan", "paito"]);
function hasRepeatedSuspectWord(text: string): boolean {
  const words = text.toLowerCase().match(/[a-z']+/g);
  if (!words) return false;
  let tight = 0;
  for (let i = 0; i < words.length; i++) {
    if (!SUSPECT_WORDS.has(words[i])) continue;
    for (let j = i + 1; j <= Math.min(i + 4, words.length - 1); j++) {
      if (words[j] === words[i]) {
        tight++;
        break;
      }
    }
  }
  return tight >= 3;
}
/**
 * A phrase-based spam category, in either script family, or the same suspect word packed tightly together.
 * No stuffing check: a compact rate card ("Reserve, 1 hour $140, plus tax and gas included, Reserve, 2
 * hours...") can legitimately repeat a short phrase across most of its own length, the same shape
 * `isKeywordStuffed` looks for, so offerings (see below) are screened with this narrower check instead of the
 * full one.
 */
export function isCompromisedPhrase(value: string): boolean {
  return SPAM_LINE.test(value) || HACKED_SCRIPT_SPAM.test(value) || hasRepeatedSuspectWord(value);
}
/**
 * Everything this sync treats as a sign one fact came off a hacked page: everything `isCompromisedPhrase`
 * catches, plus phrase-stuffing. Used on every text fact and, since the 16 Sept 2026 bug bash, on every photo,
 * cover and video fact too, not only the blurb, because a hack that spam-writes the page's words also
 * spam-writes its images. `FOREIGN_SCRIPT_RUN` is deliberately not folded in here: whether a script mismatch
 * is a hacked page or a real bilingual listing (a Hawaii tour desk's Japanese menu line, a dojo's bilingual
 * instructor bio) depends on whether the same script turns up in more than one of the operator's own facts,
 * which only the caller in `toCatalogItem` can see; see spamCompromised there.
 */
export function isCompromisedText(value: string): boolean {
  return isCompromisedPhrase(value) || isKeywordStuffed(value);
}
const STALE_LINE = /\b20(1\d|2[0-5])\b|\bcovid|\bcoronavirus|\bpandemic/i;
/** Menu headings a taproom or restaurant page lists with a starting price. */
const MENU_CATEGORY = /^(?:food|foods|beer|beers|drafts?|draught|on tap|wine|wines|cocktails?|drinks?|beverages?|snacks?|appetizers?|starters?|small plates|shareables?|entrees?|mains?|desserts?|sides?|salads?|sandwiches?|burgers?|pizzas?|tacos?|brunch|lunch|dinner|breakfast|coffee|tea|kids menu|happy hour|cans?|bottles?|growlers?|crowlers?|flights?|pints?|merch|retail)$/i;
/** Site filter chips scraped as products: "Most Immersive", "Hardest", "Biggest Game", "Best Sellers", "All". */
const FILTER_LABEL = /^(?:(?:the )?(?:most|least|second|third) \w+|hardest|easiest|scariest|biggest|smallest|newest|oldest|thrilling|abstract|immersive|popular|featured|trending|best ?sellers?|top ?rated|all|other|more|filter|sort|view all|see all|\d+ floor \w+)$/i;

/** Things sold through the operator's site that are someone else's product: theme-park tickets, tool rentals, package deals. */
const RESELLER = /\b(park (child|adult|hopper)|day hopper|\bhopper\b|park tickets?|disney|universal studios|seaworld|legoland|busch gardens|pole pruner|chainsaw|generator|excavator|lawn ?mower|tiller|pressure washer|storage unit|u-?haul)\b/i;

/**
 * The metro a listing shows under. Discovery assigned metros by name match or a 160 km radius, which put Montreal, VT
 * in Montreal, Sheffield, PA in Niagara and a Charlotte pub crawl in Austin. Now: the nearest metro within 80 km of the
 * pin (100 km when it is the one discovery chose); a pin far from the address city is ignored; with no pin, the stored
 * metro stays unless the address state has metros of its own and this one is nowhere near them. Otherwise none.
 */
const METRO_KM = 80;
const METRO_KM_KEEP = 100;
/**
 * Metros whose market is wider than 80 km from the pin. Detroit covers Windsor and Ann Arbor, Niagara covers Buffalo,
 * St. Catharines and Hamilton on both sides of the border; the flat radius cut each by a third.
 */
const METRO_REACH: Record<string, number> = { detroit: 130, niagara: 130 };
const reachOf = (id: string) => METRO_REACH[id] || METRO_KM;
const keepOf = (id: string) => Math.max(METRO_KM_KEEP, METRO_REACH[id] || 0);
function kmBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const d = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * d) / 2) ** 2 + Math.cos(lat1 * d) * Math.cos(lat2 * d) * Math.sin(((lon2 - lon1) * d) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}
function metroFor(r: { metro_id: string | null; region: string | null; city: string | null; lat: number | null; lon: number | null }): string {
  const stored = r.metro_id ? METROS.find((m) => m.id === r.metro_id) : null;
  const region = r.region && r.region.length === 2 ? r.region.toUpperCase() : null;
  if (r.lat != null && r.lon != null) {
    // K1 Speed Tampa is pinned at head office in California: when we know where the address city is and the pin is
    // nowhere near it, the pin is wrong and the address decides. Arlington, VA under DC keeps its pin.
    const known = r.city && region ? CITIES.find((c) => c.region === region && c.name.toLowerCase() === r.city!.toLowerCase()) : null;
    const pinFitsAddress = !known || kmBetween(r.lat, r.lon, known.lat, known.lon) <= METRO_KM;
    if (!pinFitsAddress) return known && stored && kmBetween(known.lat, known.lon, stored.lat, stored.lon) <= METRO_KM ? stored.id : "";
    const near = nearestMetro(r.lat, r.lon, Math.max(...Object.values(METRO_REACH), METRO_KM));
    if (near && kmBetween(r.lat, r.lon, near.lat, near.lon) <= reachOf(near.id)) return near.id;
    // Outer suburbs (Newport, RI under Boston at 87 km) stay; Montreal, VT at 119 km from Montreal, QC does not.
    if (stored && kmBetween(r.lat, r.lon, stored.lat, stored.lon) <= keepOf(stored.id)) return stored.id;
    return "";
  }
  // No pin: trust discovery unless the address state is clearly somewhere else (a metro of that state exists, none near this one).
  if (!stored) return "";
  if (!region || stored.region === region) return stored.id;
  const stateMetros = METROS.filter((m) => m.region === region);
  return !stateMetros.length || stateMetros.some((m) => kmBetween(stored.lat, stored.lon, m.lat, m.lon) <= 2.5 * METRO_KM) ? stored.id : "";
}

/** US states, DC and territories, and Canadian provinces. Anything else is outside the market. */
const NA_REGION = /^(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC|PR|VI|GU|AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)$/;
/** A pin inside the US or Canada: the mainland box, Alaska, or Hawaii. Cappadocia, Cairns and Vilnius fall outside. */
function inNorthAmerica(lat: number, lon: number): boolean {
  if (lat >= 24 && lat <= 50 && lon >= -125.5 && lon <= -66) return true; // contiguous US and southern Canada
  if (lat >= 41 && lat <= 84 && lon >= -141 && lon <= -52) return true; // Canada
  if (lat >= 51 && lat <= 72 && lon >= -180 && lon <= -129) return true; // Alaska
  if (lat >= 18.5 && lat <= 22.5 && lon >= -160.5 && lon <= -154.5) return true; // Hawaii
  if (lat >= 17.5 && lat <= 18.6 && lon >= -67.5 && lon <= -64.5) return true; // Puerto Rico and the Virgin Islands
  return false;
}
/** Titles that name the activity and nothing else: "Axe Throwing", "The Studio", "Garage". A guest cannot tell who it is. */
const GENERIC_TITLE = /^(?:the studio|(?:axe throwing|escape rooms?|bowling|bowl|golf(?: course| club)?|spa|yoga|pottery|cooking class(?:es)?|brewery|winery|paintball|go[- ]?karts?|mini ?golf|arcade|trampoline park|laser tag|garage|studio|gym|fitness|dance studio|museum|gallery|theat(?:re|er)|campground|marina|park|club|lounge|bar|pub|range|rink|pool|lake|beach|tours?|rentals?|charters?|adventures?|experiences?))$/i;

/** Words that are a site's navigation, not something a guest books: they never belong in a menu, a tag or a title. */
const NAV_LABEL = /^(?:home|homepage|welcome|contact(?: us)?|book(?: now| online)?|about(?: us)?|menu|reviews?|faqs?|gallery|photos|blog|news|events?|shop|store|login|sign ?in|cart|checkout|search|learn more|read more|more info|click here|call(?: us)?|email(?: us)?|directions|locations?|hours|pricing|prices|rates|specials|careers|jobs|employment|privacy policy|terms|terms of service|sitemap|donate|membership|subscribe|newsletter|reserve|reservations?|get tickets|buy tickets|tickets|gift ?cards?|gift certificates?)$/i;

/** A published opening line must carry a time, a "closed", or an appointment note; "Monday –" alone is a fragment. */
const HAS_TIME = /\d{1,2}(:\d{2})?\s*(a|p)\.?m\b|\d{1,2}:\d{2}|\bclosed\b|\b24 hours\b|\bnoon\b|\bmidnight\b|dawn|dusk|sunrise|sunset|by appointment|reservation only|on request/i;

/**
 * Photo file names that are documents, not photographs: scanned booklet pages (pg01.jpg, p2.png), screen shots,
 * schedules, menus, price lists, can mockups, logos and wordmarks, theme placeholders (dummy.png, og-default.jpg,
 * 700x400.png) and page chrome. Mirrors the harvest-time BAD_NAME in enrich/images.ts so a sync cleans photos the
 * crawl already stored. Widget photos (filestack, fareharbor) have opaque names and pass through.
 */
const DOC_PHOTO = /(?:^|[\/_\-. ])(?:pg|page|scan|doc)[-_]?\d{1,4}(?=[_\-.]|$)|^p\d{1,2}\.|\bpage[-_]?\d|booklet|\bscan(?:ned|s)?\b|document|\bpdf\b|certificate|\bcert\b|brochure|flyer|\bposter|infographic|(?:^|[\/_\-. ])menus?\d*(?=[\/_\-. (]|$)|menu-board|price[-_]?list|\brates?[-_.]|schedule|screen[-_ ]?shot|dummy|placeholder|og-default|^default[-_.]|^\d{3,4}x\d{3,4}(?:[-_]\d+)?\.(?:jpe?g|png|webp)$|mock-?ups?|mask[-_]?group|wordmark|lettermark|lockup|(?:^|[\/_\-. ])logo|newsletter|cartoon|clip-?art|illustration|graphics?\b|floor[-_]?plan|course[-_]?layout|(?:^|[\/_\-. ])layout(?=[\/_\-.]|$)|removebg|divider|spacer|qr[-_]?code|(?:^|[\/_\-. ])qr(?=[\/_\-. ]|$)|thank[-_ ]?you|(?:^|[\/_\-. ])sorry(?=[\/_\-. ]|$)|\bcoupon|voucher|sitemap|(?:^|[\/_\-. ])maps?(?=[\/_\-. ]|$)|favicon|apple-touch/i;
/**
 * What the cloud photo screen made of each image, keyed by url: `{ kind, page }`. `kind` is the pixel verdict
 * (photo, graphic, map, document, unknown) and `page` marks an image that scans like a printed page.
 *
 * A single page-like image is usually the operator's own marketing flyer or a photo shot against white, so it
 * stays; two or more in one listing is a scanned booklet, and a guest gallery of scorecard pages sells nothing.
 * That run rule is why this cannot be a per-url filter. Missing file, or an image the screen has not reached
 * yet, means keep: the screen runs every three hours and catches up.
 */
type PhotoVerdict = { kind?: string; page?: boolean };
let verdictCache: Map<string, PhotoVerdict> | null = null;
function photoVerdicts(): Map<string, PhotoVerdict> {
  if (verdictCache) return verdictCache;
  verdictCache = new Map();
  try {
    const raw = readFileSync(join(here, "../../data/photo-verdicts.json"), "utf8");
    for (const [url, v] of Object.entries(JSON.parse(raw) as Record<string, PhotoVerdict>)) verdictCache.set(url, v);
  } catch {
    /* the screen has not run here yet */
  }
  return verdictCache;
}

// "dead" is the screen saying the host answered 404 or 410: the picture no longer exists.
const UNUSABLE_KIND = /^(?:graphic|map|document|dead)$/;

/** One listing's photos with the screened-out ones removed, applying the two-page run rule. */
export function keepScreened(urls: string[]): string[] {
  const v = photoVerdicts();
  if (!v.size) return urls;
  const pages = urls.filter((u) => v.get(u)?.page);
  const booklet = pages.length >= 2 ? new Set(pages) : new Set<string>();
  return urls.filter((u) => {
    const verdict = v.get(u);
    if (!verdict) return true;
    return !UNUSABLE_KIND.test(verdict.kind || "") && !booklet.has(u);
  });
}

/**
 * A logo lives in a directory of its own as often as in the file's own name ("company/logo/id.png"), and a CDN's
 * own transform suffix can push the real name off the end of the path entirely ("logo biz.JPG/:/cr=t:0%,...",
 * an image proxy's "i=-LOGO(1).jpg" carried in its own query string). The word "logo" anywhere in the address a
 * guest's browser actually requests is still a logo, not only when it is the last thing before the extension.
 */
const LOGO_PATH = /(?:^|[/_\-. ?&=])logos?(?:[/_\-. (]|$)/i;

export function isPhotoName(url: string): boolean {
  if (!url) return false;
  let name = url.split("?")[0].split("/").slice(-1)[0];
  try {
    name = decodeURIComponent(name);
  } catch {
    /* keep the raw name */
  }
  if (DOC_PHOTO.test(name)) return false;
  // A bot check the crawl was served instead of a page. See isChallengeImage in enrich/imagescrape.ts.
  if (isChallengeImage(url)) return false;
  let full = url;
  try {
    full = decodeURIComponent(url);
  } catch {
    /* keep the raw address */
  }
  return !LOGO_PATH.test(full);
}

/** A boat, a cabin or a car with a sticker price was scraped from a dealer page on the operator's site. */
function isForSale(o: { name: string; detail: string | null; price_cents: number | null }): boolean {
  if (o.price_cents == null) return false;
  const text = (o.name + " " + (o.detail || "")).toLowerCase();
  if (o.price_cents > 2500000) return true;
  if (o.price_cents > 500000) return !/charter|yacht|private|group|wedding|event|package|week|weekend|multi|day|night|hour|tour|retreat|expedition|camp\b/.test(text);
  return /\b(for sale|msrp|sold|financing|dealer|pre-?owned|used boat|new boat|stock #|hull id|\d{4} (sea ?ray|yamaha|bayliner|tracker|bennington|malibu|mastercraft|lund|ranger|boston whaler))\b/i.test(text);
}

/**
 * What the listing cleanup changed, when a check script asks for it. Off in production: `startCleanupLog()` turns
 * it on for one process so scripts/_tampa-rules-check.mts can print every price nulled, paragraph un-shouted,
 * sentence deduped and duplicate operator dropped.
 */
export type CleanupLog = {
  priceNulled: { id: string; name: string; oldPrice: number; why: string }[];
  shouted: { id: string; field: string; before: string; after: string }[];
  deduped: { id: string; field: string; text: string }[];
  dupes: { kept: string; dropped: string; why: string; shared: string }[];
  quarantined: { id: string; reason: string }[];
};
let cleanupLog: CleanupLog | null = null;
export function startCleanupLog(): CleanupLog {
  cleanupLog = { priceNulled: [], shouted: [], deduped: [], dupes: [], quarantined: [] };
  return cleanupLog;
}

/** "2.5 hours", "6-7 hours", "90 min", "hourly", "Full Day": the smallest number of minutes the text commits to. */
function minutesOf(text: string): number | null {
  if (!text) return null;
  const m = text.match(/(\d+(?:\.\d+)?)\s*(?:-|\u2013|to)?\s*(?:\d+(?:\.\d+)?)?\s*(hours?|hrs?|minutes?|mins?)\b/i);
  if (m) {
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0) return null;
    return /^h/i.test(m[2]) ? n * 60 : n;
  }
  if (/\b(hourly|per hour|an hour)\b/i.test(text)) return 60;
  if (/\b(half[- ]day|full[- ]day|all[- ]day|overnight|multi-?day)\b/i.test(text)) return 240;
  return null;
}

/** Lines where a small number really is the price: gate fees, a kid's ticket, a launch or a parking spot. */
const CHEAP_BY_DESIGN = /\badmission\b|\bday pass\b|\bkids?\b|\bchild(?:ren)?\b|\bjunior\b|\bparking\b|\blaunch\b|\bper person\b|\bper hour\b|\bhourly\b|\bper head\b|\bpp\b/i;
/** Lines that are a booked experience, where a couple of dollars is never the whole price. */
const BOOKED_LINE = /\b(tours?|charters?|rentals?|trips?|cruises?|flights?|lessons?|sails?|excursions?|dives?|safaris?)\b/i;

/**
 * A price the site cannot have meant. "5 Hour Half Day Fishing Trip $10" and "44 Hour Full Moon Fishing Trip $4"
 * are the deposit, or digits the parser lifted out of the name. Half a day on the water is not four dollars, so the
 * number is dropped and the page says "Price on request" rather than telling a guest something false.
 */
function implausiblePrice(o: { name: string; detail: string | null; duration: string | null; price_cents: number | null }): string | null {
  if (o.price_cents == null || o.price_cents <= 0) return null;
  const text = o.name + " " + (o.detail || "");
  if (CHEAP_BY_DESIGN.test(text)) return null;
  const dollars = o.price_cents / 100;
  const mins = minutesOf(o.duration || "") ?? minutesOf(o.name);
  if (mins != null && mins >= 90 && dollars < 15) return "" + Math.round(mins) + " min for $" + dollars;
  if (dollars < 8 && BOOKED_LINE.test(o.name)) return "booked line at $" + dollars;
  return null;
}

/** Acronyms a guest reads as acronyms. Two and three letters, so sentence case must not smooth them into words. */
const KEEP_CAPS = new Set(["USCG", "ID", "FWC", "GPS", "ATV", "UTV", "PWC", "SUP", "BYOB", "AM", "PM", "FL", "US", "USA", "PFD"]);
/** Fields where a site shouts at guests, and where it repeats itself. */
const PARA_FIELDS = ["blurb", "cancellation", "checkin", "meetingPoint", "gap", "extraNote"];
const LIST_FIELDS = ["policies", "requirements", "bring", "includes", "hoursText", "highlights", "groupInfo", "specs"];

/** True when a run of text is written in capitals: more than 70% of its letters, over at least four words. */
function isShoutedText(t: string): boolean {
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length < 8) return false;
  if (t.trim().split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).length < 4) return false;
  return (t.match(/[A-Z]/g) || []).length / letters.length > 0.7;
}

/** Words that start a sentence, or a heading, without being anyone's name. Capitals on these mean nothing. */
const COMMON_WORD = /^(?:the|a|an|and|or|but|if|of|to|in|on|at|for|with|from|by|as|is|are|was|were|be|been|being|have|has|had|will|would|can|could|shall|should|must|may|might|do|does|did|not|no|nor|all|any|both|each|every|some|most|more|less|few|you|your|yours|we|our|ours|us|they|them|their|it|its|this|that|these|those|there|here|when|where|what|which|who|whom|whose|how|why|please|note|thank|thanks|welcome|before|after|during|until|while|about|above|below|over|under|up|down|out|off|per|than|then|also|only|just|very|much|many|one|two|three|four|five|six|ten|first|second|third|next|last|new|full|free|open|closed|late|early|call|calls|book|booking|bring|arrive|arrival|check|checkin|rental|rentals|tour|tours|trip|trips|cruise|cruises|guest|guests|customer|customers|reservation|reservations|refund|refunds|refundable|cancel|cancelled|cancellation|cancellations|policy|policies|weather|time|times|day|days|hour|hours|minute|minutes|age|ages|year|years|child|children|adult|adults|safety|waiver|waivers|require|required|requires|information|info|important|available|additional|due|prior|notice|reminder|reminders|deposit|payment|price|prices|rate|rates|rules|location|directions|questions|answers|yes|now|today|read|see|use|way|make|made|take|given|give|need|needed|allowed|include|included|includes)$/i;

/**
 * The words this listing capitalises when it is not shouting: its own name, its city, "Three Sisters Springs".
 * Sentence case gives those their capitals back. A word that also appears lowercase somewhere in the listing is a
 * plain word that happened to start a sentence, and so is anything on the common-word list; the business's own
 * name always counts, whatever else the page does with those words.
 */
function calmWords(texts: string[], title: string): Map<string, string> {
  const caps = new Map<string, string>();
  const lower = new Set<string>();
  for (const t of texts) {
    if (!t) continue;
    for (const sentence of t.split(/(?<=[.!?:])\s+|\n+/)) {
      const words = sentence.split(/[^A-Za-z'’]+/).filter(Boolean);
      words.forEach((w, i) => {
        if (w.length < 2) return;
        if (/^[a-z]/.test(w)) lower.add(w.toLowerCase());
        if (i === 0 || COMMON_WORD.test(w) || isShoutedText(sentence)) return;
        if (/^[A-Z][a-z'’]+$/.test(w) && !caps.has(w.toLowerCase())) caps.set(w.toLowerCase(), w);
      });
    }
  }
  for (const k of lower) caps.delete(k);
  // "Idle Speed Watersports" is the business; those words keep their capitals even where the page also writes them lowercase.
  for (const w of title.split(/[^A-Za-z'’]+/)) if (/^[A-Z][a-z'’]+$/.test(w) && w.length >= 2) caps.set(w.toLowerCase(), w);
  return caps;
}

/** www.parasaillowtide.com is an address, not a sentence: it is only ever lowercased. */
const WEB_ADDRESS = /(?:https?:\/\/|www\.)[^\s]+|\b[a-z0-9-]+\.(?:com|net|org|biz|co|us|ca|info)\b/gi;

/** Capitals down to sentence case: a capital after each sentence end, acronyms and this listing's own names kept. */
function sentenceCase(raw: string, calm: Map<string, string>, capFirst: boolean): string {
  let capNext = capFirst;
  const one = (text: string) =>
    text.replace(/[A-Za-z][A-Za-z'’]*|[^A-Za-z]+/g, (tok) => {
      if (!/^[A-Za-z]/.test(tok)) {
        // A period between letters is an abbreviation or an address, not the end of a sentence.
        if (/[.!?:](\s|$)|[•\n]/.test(tok)) capNext = true;
        return tok;
      }
      const upper = tok.toUpperCase();
      let out = upper === "I" ? "I" : KEEP_CAPS.has(upper) ? upper : calm.get(tok.toLowerCase()) ?? tok.toLowerCase();
      if (capNext) out = out.charAt(0).toUpperCase() + out.slice(1);
      capNext = false;
      return out;
    });
  const out: string[] = [];
  let at = 0;
  for (const m of raw.matchAll(WEB_ADDRESS)) {
    out.push(one(raw.slice(at, m.index)), m[0].toLowerCase());
    capNext = false;
    at = m.index + m[0].length;
  }
  out.push(one(raw.slice(at)));
  return out.join("");
}

/** A word written in capitals, with letters in it. "530PM" and "AND" count; "24" and "$10" are neither loud nor calm. */
function isLoudWord(w: string): boolean {
  const core = w.replace(/[^A-Za-z]/g, "");
  return core.length >= 2 && w === w.toUpperCase();
}

/**
 * Sentence-case the shouted runs, leaving the calm words around them exactly as the site wrote them. A block is
 * judged by the stated rule (more than 70% of its letters capital, four words or more); inside a block that fails
 * the eye test, only the unbroken run of shouted words is rewritten, so "Our Cancellation Policy ALL GUIDED TOURS
 * REQUIRE..." keeps its heading and loses its shouting.
 */
function deshout(t: string, calm: Map<string, string>): string {
  const blocks = t.split(/(\n+|(?<=[.!?])\s+)/);
  return blocks
    .map((block, bi) => {
      if (bi % 2 === 1 || !isShoutedText(block)) return block;
      const parts = block.split(/(\s+)/);
      const words = parts.filter((_, i) => i % 2 === 0);
      const hasLetters = (w: string) => /[A-Za-z]/.test(w);
      // Runs of shouted words, with "24" or "$10" between two of them counting as part of the same run.
      const runs: [number, number][] = [];
      for (let i = 0; i < words.length; i++) {
        if (!isLoudWord(words[i])) continue;
        let j = i;
        for (let k = i + 1; k < words.length; k++) {
          if (isLoudWord(words[k])) j = k;
          else if (hasLetters(words[k])) break;
        }
        runs.push([i, j]);
        i = j;
      }
      const out = parts.slice();
      for (const [a, b] of runs) {
        if (words.slice(a, b + 1).filter(hasLetters).length < 4) continue;
        const text = parts.slice(a * 2, b * 2 + 1).join("");
        const before = words.slice(0, a).filter(Boolean);
        const capFirst = !before.length || /[.!?:•]$/.test(before[before.length - 1]);
        const cased = sentenceCase(text, calm, capFirst).split(/(\s+)/);
        for (let i = 0; i < cased.length; i++) out[a * 2 + i] = cased[i];
      }
      return out.join("");
    })
    .join("");
}

function sentenceKey(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** The same sentence twice in one paragraph: keep the first. */
function dedupeSentences(t: string, onDrop: (s: string) => void): string {
  const parts = t.split(/(\n+|(?<=[.!?])\s+)/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const key = sentenceKey(parts[i]);
    if (key.length >= 12 && seen.has(key)) {
      onDrop(parts[i]);
      continue;
    }
    if (key) seen.add(key);
    out.push(parts[i] + (parts[i + 1] ?? ""));
  }
  return out.join("").trim();
}

/** Log entries are 80 characters, the length that fits a terminal line. CLEANUP_CLIP widens them while tuning. */
const CLIP = Number(process.env.CLEANUP_CLIP || 80);
function clip(t: string): string {
  return t.replace(/\s+/g, " ").trim().slice(0, CLIP);
}

/**
 * The last pass over one listing: shouted paragraphs down to sentence case, and a sentence or bullet the site
 * printed twice down to once. Names are left to `fixShouting`, which title-cases them; a paragraph in title case
 * would read like a headline, so paragraphs get sentence case instead.
 */
function tidyItem(item: Record<string, unknown>, id: string): Record<string, unknown> {
  const texts: string[] = [];
  const harvest = (v: unknown) => {
    if (typeof v === "string") texts.push(v);
    else if (Array.isArray(v)) for (const x of v) harvest(x);
    else if (v && typeof v === "object") for (const x of Object.values(v as Record<string, unknown>)) harvest(x);
  };
  harvest(item.title);
  for (const k of [...PARA_FIELDS, ...LIST_FIELDS, "faq", "options", "services", "tags", "area"]) harvest(item[k]);
  const calm = calmWords(texts, String(item.title || ""));
  const fix = (field: string, v: string, para: boolean): string => {
    const shouted = deshout(v, calm);
    if (shouted !== v && cleanupLog) cleanupLog.shouted.push({ id, field, before: clip(v), after: clip(shouted) });
    if (!para) return shouted;
    return dedupeSentences(shouted, (s) => cleanupLog?.deduped.push({ id, field, text: clip(s) }));
  };
  for (const k of PARA_FIELDS) if (typeof item[k] === "string") item[k] = fix(k, item[k] as string, true) || undefined;
  for (const k of LIST_FIELDS) {
    const list = item[k] as string[] | undefined;
    if (!Array.isArray(list)) continue;
    const seen = new Set<string>();
    item[k] = list
      .map((l) => fix(k, l, false))
      .filter((l) => {
        const key = sentenceKey(l);
        if (key && seen.has(key)) {
          cleanupLog?.deduped.push({ id, field: k, text: clip(l) });
          return false;
        }
        if (key) seen.add(key);
        return true;
      });
  }
  const faq = item.faq as { q: string; a: string }[] | undefined;
  if (Array.isArray(faq)) item.faq = faq.map((f) => ({ q: f.q, a: fix("faq", f.a, true) }));
  return item;
}

const SITE_WORDS = /^(?:home|homepage|welcome|official (?:site|website|home ?page)|website|site|online|book(?:ing)? online|book now|reservations?|home ?page|index|main)$/i;
/** Who a title belongs to, so a location tail ("at Clearwater Beach", "- Tampa Bay") can be told from a name ("The Legacy at Green Hills"). */
export type TitleContext = { city?: string | null; region?: string | null; legalName?: string | null };

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia",
  PR: "Puerto Rico", AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick", NL: "Newfoundland", NS: "Nova Scotia", NT: "Northwest Territories", NU: "Nunavut", ON: "Ontario",
  PE: "Prince Edward Island", QC: "Quebec", SK: "Saskatchewan", YT: "Yukon",
};
const STATE_BY_NAME: Map<string, string> = new Map(Object.entries(STATE_NAMES).map(([code, name]) => [name.toLowerCase(), code]));
const CITY_NAMES: Set<string> = new Set(CITIES.map((c) => c.name.toLowerCase()));
/** Words that turn a city into a place phrase rather than a brand: "Clearwater Beach", "Downtown Tampa", "Greater Toronto Area". */
const GEO_WORDS = /^(?:beach|beaches|bay|island|islands|key|keys|county|springs|harbor|harbour|lake|valley|coast|shores?|park|city|falls|heights|hills|point|cove|cape|river|pass|metro|area|downtown|greater|north|south|east|west|central|upper|lower|gulf|the|of|and|&|region|peninsula|sound|inlet|marina|pier|waterfront|resort)$/i;
/** Words a title keeps lower case unless they open it. */
const SMALL_WORDS = /^(?:a|an|and|at|by|for|from|in|of|on|or|the|to|with|de|du|le|del|von|van|y|n|o)$/i;
/** Upper-case tokens of four or more letters that are acronyms or brands, not shouting. Two- and three-letter tokens always stay as written. */
/** Short English words a shouted menu writes in capitals ("WING IT!", "11 PEOPLE PER BOAT", "TIKI BUS"). Anything else of two or three capitals is an acronym. */
const COMMON_SHORT = new Set("try st mt ft dr mr mrs jr sr ave blvd rd hwy hr hrs min mins it per for you our all new fun day sea sun bar big hot top old one two six ten and the of at in on to by or up go do we us me my an as is are was get has had can may not no off out own see set way who why how its his her him she he so if but yet any few lot low mid min max age bay hub ice ski spa gym art car cat dog fly jet rod run fit fee kid pet bus van ram raw red dry wet air fog ice hay bag box tub hat pit map mix pro pop pub inn bay cay key zip kit tip cup tap tee par pin ace ale ipa rum gin egg pie ham jam tea hop dip dye axe gun bow bat net web log".split(" "));
const CAPS_TOKENS = new Set(["YMCA", "EMTB", "BIPOC", "BWCA", "YWCA", "PADI", "NAUI", "USPA", "NASCAR", "IMAX", "NASA", "UNESCO", "HVAC", "LPGA", "USGA", "IFLY", "GOLFTEC", "SEAL", "UTVS", "ATVS", "SUPS", "PWCS", "JCC", "MMA", "BJJ", "FPV", "IFR", "VFR", "SCCA", "NHRA", "AMA", "USBC", "NCAA", "USTA", "NAUI", "SDI", "TDI", "AAU", "USAG", "FIFA", "NHL", "MLB", "NFL", "NBA", "PBR", "DIY", "ROTC", "NRA", "USCG", "TSA", "FAA", "BLM", "NPS", "NYPD", "LGBTQ", "AOPA"]);

/** "O'BRIEN" to "O'Brien", "PUTT-PUTT" to "Putt-Putt", "BILL'S" to "Bill's". */
function capWord(w: string): string {
  return w
    .split(/([-'’./])/)
    .map((part, i, all) => {
      if (i % 2) return part;
      if (!part) return part;
      const afterApos = i > 0 && /['’]/.test(all[i - 1]);
      if (afterApos && part.length <= 2) return part.toLowerCase(); // Bill's, catch'em, we'll
      return part.replace(/^([^\p{L}]*)(\p{L})(.*)$/u, (_m, pre: string, ch: string, rest: string) => pre + ch.toUpperCase() + rest.toLowerCase());
    })
    .join("");
}

/** "USPA-A", "SUP-YOGA", "PUTT-PUTT", "ST. PETE": each hyphen or slash part keeps its capitals only when it is an acronym. */
function capShouted(w: string, loneCaps: boolean): string {
  const keepLone = loneCaps && w.replace(/[^\p{L}]/gu, "").length <= 5;
  return w
    .split(/([-/])/)
    .map((part, i) => {
      if (i % 2 || !part) return part;
      const letters = part.replace(/[^\p{L}]/gu, "");
      if (!letters) return part;
      if (COMMON_SHORT.has(letters.toLowerCase())) return capWord(part);
      if (letters.length <= 3 || CAPS_TOKENS.has(letters) || !/[AEIOUY]/.test(letters) || keepLone) return part;
      return capWord(part);
    })
    .join("");
}

/** A word of four or more capitals, or an all-capitals string: the site is shouting. */
const SHOUT = /(?:^|[^A-Za-z])[A-Z][A-Z'’]{3,}(?=$|[^A-Za-z])/;
function isShouting(t: string): boolean {
  return SHOUT.test(t) || (t === t.toUpperCase() && (t.match(/[A-Z]/g) || []).length >= 4);
}

/**
 * Title-case a shouted name and nothing else. "CLEARWATER Jet ski RENTAL" reads "Clearwater Jet Ski Rental";
 * "iFLY Indoor Skydiving", "K1 Speed" and "SUP Tampa" are left exactly as written because nothing in them shouts.
 * Inside a shouted name, tokens of two or three capitals (BAE, ATX, LLC, ATV), tokens with digits (K1, 4x4)
 * and known acronyms keep their capitals; mixed-case tokens (McDonald) are never touched.
 */
export function fixShouting(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t || !isShouting(t)) return t;
  const words = t.split(" ");
  const shoutedCount = words.filter((w) => /\p{Lu}/u.test(w) && w === w.toUpperCase() && /\p{L}{2}/u.test(w)).length;
  // "ROTAK Helicopter Services", "Complete BWCA Outfitting Package": one short capitalised token among cased words is a brand or an acronym.
  const loneCaps = shoutedCount === 1 && words.length >= 2;
  if (loneCaps && !words.some((w) => /\p{Lu}/u.test(w) && w === w.toUpperCase() && w.replace(/[^\p{L}]/gu, "").length > 5)) return t;
  const out = words.map((w, i) => {
    const core = w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (/^\d+(?:ST|ND|RD|TH)$/.test(core)) return w.toLowerCase(); // "JULY 4TH"
    if (!core || /\d/.test(core)) return w;
    const first = i === 0;
    const last = i === words.length - 1;
    if (SMALL_WORDS.test(core)) {
      const lower = w.toLowerCase();
      return first || last ? capWord(lower) : lower;
    }
    // "SUNSET IN LA" is Los Angeles; "LA JOLLA KAYAK" is not.
    if (core === "LA") return last || /^(?:in|of|to|from|near)$/i.test(words[i - 1] || "") ? w : capWord(w);
    if (core === core.toUpperCase()) return capShouted(w, loneCaps);
    if (core === core.toLowerCase()) return capWord(w);
    return w; // McDonald, iFLY, LaBarre: already cased on purpose
  });
  return out.join(" ");
}

/** Names that really do say a word twice. */
const REDUPLICATED = /^(?:chi|bora|walla|pago|baden|sing|duran|yo|tik|bang|cha|kai|tuk|mahi|hula|coco|boo|bling|aye|yum|hush|wiki|choo|pom|go|mau|ta|bye|la|dum|chow|lala|ping|bon|tam|kum|wagga|kaka|foo|mo|no|so|do|ha|ho|tok|cou|puka|lomi|poke|nam|bam|ra|ba|da)$/;
/** "Jet ski Jet Ski Rental" and "Bounce Bounce Trampoline Park": a word or a pair repeated back to back. "Chi Chi Rodriguez" and "Walla Walla" stay. */
export function collapseRepeats(t: string): string {
  const words = t.split(" ");
  const out: string[] = [];
  const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, "");
  const caps = (w: string) => (w.match(/\p{Lu}/gu) || []).length;
  for (const w of words) {
    const n = out.length;
    // Of two spellings ("Jet ski Jet Ski"), the better-cased one survives.
    if (n >= 1 && norm(out[n - 1]) === norm(w) && norm(w).length >= 4 && !REDUPLICATED.test(norm(w))) {
      if (caps(w) > caps(out[n - 1])) out[n - 1] = w;
      continue;
    }
    if (n >= 3 && norm(out[n - 3]) === norm(out[n - 1]) && norm(out[n - 2]) === norm(w)) {
      if (caps(out[n - 1]) > caps(out[n - 3])) out[n - 3] = out[n - 1];
      if (caps(w) > caps(out[n - 2])) out[n - 2] = w;
      out.pop();
      continue;
    }
    out.push(w);
  }
  return out.join(" ");
}

function normPlace(s: string): string {
  return s.toLowerCase().replace(/\bft\.?\s/g, "fort ").replace(/\bsaint\s/g, "st. ").replace(/\bst\s/g, "st. ").replace(/\bmt\.?\s/g, "mount ").replace(/[.,]+$/g, "").replace(/\s+/g, " ").trim();
}

/**
 * True when a tail is a place and not part of a brand. The row's own city (alone or with a geo word, "Clearwater
 * Beach", "Downtown Tampa"), a state or province by code or name, or "<place>, FL". With `anyCity`, any city in the
 * discovery grid counts too, which is right for "- St. Louis" taglines but wrong for "The Spa at Bally's"-style names.
 */
function isPlaceTail(tail: string, ctx: TitleContext, anyCity: boolean): boolean {
  const parts = tail.split(/\s*,\s*/).map(normPlace).filter(Boolean);
  if (!parts.length || parts.length > 2) return false;
  const region = ctx.region ? ctx.region.toUpperCase() : "";
  const isState = (x: string) => (x.length === 2 && x.toUpperCase() === region) || STATE_BY_NAME.has(x) || (region && STATE_NAMES[region]?.toLowerCase() === x);
  if (parts.length === 2 && !isState(parts[1])) return false;
  const head = parts[0];
  if (isState(head)) return parts.length === 1;
  const city = ctx.city ? normPlace(ctx.city) : "";
  const words = head.split(" ");
  const cityWords = new Set(city.split(" ").filter(Boolean));
  const gridCity = anyCity && CITY_NAMES.has(head);
  const rest = words.filter((w) => !cityWords.has(w) && !GEO_WORDS.test(w));
  const hasCity = city ? words.some((w) => cityWords.has(w) && w.length > 2) : false;
  if (hasCity && rest.length === 0) return true;
  if (gridCity) return true;
  // "Clearwater Beach, FL" with no city on the row: a state after the comma settles it when every word is a geo word.
  if (parts.length === 2 && rest.length <= 1) return true;
  return false;
}

/** Activity words. A remainder made only of these ("Jet Ski Adventures", "Boat Rentals") needs its place to be a name at all. */
const ACTIVITY_WORD = /^(?:jet|ski|skis|boat|boats|pontoon|kayak|kayaks|canoe|paddle|board|boards|sup|bike|bikes|e-bike|ebike|scooter|scooters|fishing|fish|parasail|parasailing|dolphin|dolphins|sunset|airboat|atv|utv|helicopter|zipline|zip|line|axe|throwing|escape|room|rooms|golf|cart|carts|surf|surfing|dive|diving|scuba|snorkel|snorkeling|sailing|sail|yacht|yachts|charter|charters|rental|rentals|tour|tours|adventure|adventures|excursion|excursions|experience|experiences|lesson|lessons|class|classes|cruise|cruises|trip|trips|ride|rides|flight|flights|session|sessions|the|and|&|of|water|sports|watersports|watersport|fun|beach|island|bay|family|private|luxury|premier|best|deep|sea|inshore|offshore|eco|manatee|shelling|sightseeing|balloon|skydiving|skydive|jetski|jetskis|wave|runner|runners|waverunner|waverunners|pedal|tiki|party|day|half|full|hour|hourly|guided|self|spa|massage|yoga|pottery|cooking|painting|wine|beer|brewery|winery|distillery|tasting|tastings|bowling|arcade|trampoline|laser|tag|karting|karts|paintball|archery|shooting|range|climbing|rock|horseback|riding|trail|trails|hiking|camping|glamping|rafting|tubing|boating|swim|swimming|snowmobile|snowmobiles|ski|snowboard|sled|dog|wildlife|nature|bird|birding|photography|ghost|food|walking|segway|trolley|bus|hop|carriage|horse|cable|gondola|train|scenic|aerial|air|glider|hang|paraglide|paragliding|skydive|tandem|indoor|outdoor|mini|putt|disc|driving|tennis|pickleball|ice|skating|rink|roller|pool|waterpark|park|zoo|aquarium|museum)$/i;
const isGenericName = (x: string) => x.split(/\s+/).every((w) => ACTIVITY_WORD.test(w.replace(/[^A-Za-z&-]/g, "")));

/** Drop " at Clearwater Beach", " in Tampa, FL", " - Tampa Bay", ", Florida" from the end when the rest is still a name. */
function stripPlaceTail(t: string, ctx: TitleContext): string {
  const twoWords = (x: string) => x.trim().split(/\s+/).length >= 2 && !isGenericName(x);
  for (let i = 0; i < 2; i++) {
    let m = t.match(/^(.*\S)\s+(?:at|in|near)\s+(?:the\s+)?([A-Za-z.'’&\s]{2,40}(?:,\s*[A-Za-z. ]{2,25})?)\s*$/i);
    if (m && twoWords(m[1]) && isPlaceTail(m[2], ctx, false)) {
      t = m[1];
      continue;
    }
    m = t.match(/^(.*\S)\s*(?:\s-\s|-\s+|\s[–—]\s?|,\s*|\|\s*)([A-Za-z.'’&\s]{2,40}(?:,\s*[A-Za-z. ]{2,25})?)\s*$/);
    if (m && twoWords(m[1]) && isPlaceTail(m[2], ctx, true)) {
      t = m[1];
      continue;
    }
    break;
  }
  return t.replace(/[\s,\-–—|:]+$/, "");
}

/** A crawled page title, not a business name: "Foo | Tampa", "JET SKI RENTAL AT CLEARWATER BEACH", all caps, or a city named twice in a long string. */
function looksSeo(raw: string, ctx: TitleContext): boolean {
  if (/\s\|\s/.test(raw)) return true;
  if (/\bAT [A-Z]{3,}/.test(raw)) return true;
  if (raw === raw.toUpperCase() && (raw.match(/[A-Z]/g) || []).length >= 4) return true;
  const words = raw.split(/\s+/);
  if (words.length >= 6 && ctx.city) {
    const c = ctx.city.toLowerCase();
    const hits = words.filter((w) => w.toLowerCase().replace(/[^a-z]/g, "") === c.replace(/[^a-z]/g, "")).length;
    if (hits >= 2) return true;
  }
  return false;
}

/**
 * Things a shop puts in its page title that are never part of its name: the phone number, the price, the
 * licence number, "by appointment only", and the ellipsis a listing site leaves when it cuts a title short.
 *
 * All five ship today. "Beverly Hills Day Spa (850) 714-4459" and "Wet Willy's WaterSports 609-972-1730" are
 * two of the 12 names carrying a phone number, "Jasmine Day Spa (561) 557-3748 By appointment only Lic#
 * MM32019" carries four of these at once, "Orlando Fishing for $99" is one of 7 quoting a price we do not
 * otherwise stand behind and that goes stale on its own, and "GGs Spa ..." is one of 15 ending in an ellipsis.
 * A guest reads the name on the card, the hero, the page title, the landing pages and the confirmation.
 */
function stripContactCruft(t: string): string {
  return t
    // (850) 714-4459, 910-705-6253, (239) 765.8500. A separator or brackets are required, so a name's own
    // digits ("Hangar 45 1000 Islands") are not read as a number.
    .replace(/(?:\+?1[\s.-])?(?:\(\d{3}\)\s*|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?!\d)/g, " ")
    // "Lic# MM32019". A "#", "no." or "number" is required, so "Licensed Captain" keeps its word.
    .replace(/\blic(?:ense|ence)?\.?\s*(?:#|no\.?|number)\s*[A-Za-z0-9-]{2,}\b/gi, " ")
    .replace(/\bby appointment(?:s)?(?: only)?\b\.?/gi, " ")
    // The figure and whatever introduces it: "Starting at $45", "from $143.05", "for $99", "$10 off".
    .replace(/\b(?:starting|starts|start)?\s*(?:at|from|for|only|just)?\s*\$\s?\d[\d,]*(?:\.\d{2})?\s*(?:off\b)?/gi, " ")
    // "GGs Spa ...", "Dillies Jet Ski Rentals LLC...": a listing site's own truncation, not a name.
    .replace(/\s*(?:\.{2,}|…)\s*$/, "")
    // "Boat Rentals & More(by appointment only)" must not be left holding an empty bracket.
    .replace(/\(\s*\)|\[\s*\]|\{\s*\}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The name a guest sees. Sites publish "Sky Combat Ace | San Diego", "Welcome to the Official Axe & Ale Website",
 * "FISH AND SONS KENAI CHARTERS", "CLEARWATER Jet ski RENTAL AT CLEARWATER BEACH" and "[Alchemy]". Keep the business,
 * drop the tagline, the site words, the location tail and the shouting. With a context, the operator's legal name
 * wins over a title that is plainly an SEO string.
 */
export function cleanTitle(raw: string, ctx: TitleContext = {}): string {
  const legal = (ctx.legalName || "").replace(/\s+/g, " ").trim();
  if (legal.split(" ").length >= 2 && looksSeo(raw, ctx)) return cleanTitle(legal);
  // Zero-width joiners and bidi marks came through the crawl inside four names and print as nothing at all.
  let t = raw.replace(/[​-‏‪-‮⁠﻿]/g, "").replace(/\s+/g, " ").trim();
  t = t.replace(/^\[(.+)\]$/, "$1").replace(/\s*\[(.*?)\]\s*$/, (_m, x: string) => (x.length <= 12 ? " " + x : "")).trim();
  t = t.replace(/^(?:welcome to|welcome)\s+(?:the\s+)?(?:official\s+)?/i, "").replace(/\s*[-–—|:]?\s*(?:official )?(?:web ?site|home ?page)\s*$/i, "").trim();
  t = stripContactCruft(t);
  // "A | B" and "A – B" are name plus tagline: keep the part that is a name (the first, unless it is a site word).
  // "A - B" with a plain hyphen is often one name ("Fifty - Fifty Water Sports"), so it stays whole when short.
  const isName = (x: string) => !SITE_WORDS.test(x) && !/^(?:book|reserve|call|save|best|top|#1|\d+%|free|official|voted|your|premier|the best|the #1|the premier)\b/i.test(x);
  if (/\s*(?:\||–|—)\s*/.test(t)) {
    const parts = t.split(/\s*(?:\||–|—)\s*/).map((x) => x.trim()).filter(Boolean);
    t = parts.find(isName) || parts[0];
  }
  if (/ - /.test(t)) {
    const parts = t.split(/ - /).map((x) => x.trim()).filter(Boolean);
    const named = parts.filter(isName);
    t = named.length < parts.length ? named[0] || parts[0] : t.length <= 40 ? t : parts[0];
  }
  // "Foo Charters: Best Jet Ski Rental in Tampa": an SEO clause after a colon.
  t = t.replace(/^(.{3,}?\S)\s*:\s*(?:the\s+)?(?:best|top|#\s?1|premier|your|official|voted|book|reserve)\b.*$/i, "$1");
  t = stripPlaceTail(t, ctx);
  t = collapseRepeats(fixShouting(t));
  // "labarre", "bfunk": a name typed in lower case reads as a slug. Capitalise each word; brands with inner caps are left alone.
  if (t === t.toLowerCase() && /^[a-z]/.test(t)) t = t.replace(/(^|\s)([a-z])/g, (_m, sp: string, ch: string) => sp + ch.toUpperCase());
  t = t.replace(/^[\s\-–—|:]+|[\s\-–—|:,]+$/g, "").trim();
  /**
   * Cut to length first, then drop the dangling word, because cutting at a word boundary makes one of its own.
   * 15 published names ended on a preposition for exactly that reason: "Balloon Delivery & Balloon Decor by",
   * "Day Trip Adventure with Boat, Snorkel in", "Zip Line, Kayak, Rock Climb, And". The rule below was written
   * for "Midwest Powered Paragliding In" and ran before the 70 character trim, so it never saw them.
   */
  t = t.length > 70 ? trimWords(t, 70) : t;
  // "Midwest Powered Paragliding In", "Paint, Sip Wine, have fun at our": a page title cut mid-sentence.
  t = t.replace(/(?:\s+(?:of|for|with|and|or|to|our|your|at our|by|at|in)\b)+\s*$/i, "").trim();
  t = t.replace(/[\s\-–—|:,]+$/g, "");
  // Never a stub or a bare domain: fall back to the legal name, then to the raw title.
  if (t.length < 3 || /^(?:https?:\/\/|www\.)|^[a-z0-9-]+\.[a-z]{2,}$/i.test(t)) return legal.length >= 3 ? legal : raw.trim();
  return t;
}

/** Cut at a word boundary, no ellipsis, so a name never ends mid-word. */
function trimWords(t: string, max: number): string {
  if (t.length <= max) return t;
  return t.slice(0, max).replace(/\s+\S*$/, "").trim();
}

/** Cut at the last sentence end inside the limit, so a blurb never stops mid-thought. */
function endAtSentence(t: string, max: number): string {
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const i = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return (i > max * 0.4 ? cut.slice(0, i + 1) : trimWords(cut, max)).trim();
}

/** A line the crawl took from a heading, a nav bar or a banner: no sentence end, short, and mostly capitals. */
function isHeadingLine(l: string): boolean {
  if (/[.!?]["”’)]?$/.test(l)) return false;
  const words = l.split(" ");
  if (words.length > 10) return false;
  if (/:$/.test(l) && words.length <= 6) return true;
  const letters = l.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 3 && letters === letters.toUpperCase()) return true;
  const caps = words.filter((w) => /^[A-Z0-9$#&]/.test(w) || SMALL_WORDS.test(w)).length;
  return caps / words.length >= 0.7;
}

const STATE_CODE = /^(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC|AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)$/;
const PHONE = /\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g;
const NAV_WORD = /\b(?:home|about(?: us)?|contact(?: us)?|book now|gift cards?|faqs?|menu|login|sign in|cart)\b/gi;

/**
 * Cut the keyword-stuffed run that opens "Clearwater Jet Ski Dolphin Tours CLEARWATER JET SKI RENTAL AT CLEARWATER
 * BEACH, FL The premier jet ski rental company in Clearwater, Florida." A run of capitalised words is only cut at a
 * clear seam (two or more shouted words, or a state after a comma) and only when a real sentence follows; "Indian
 * Rocks Beach Boat Rental offers a variety of boats" has no seam and is kept whole.
 */
function cutLeadingFragment(t: string): string {
  const first = t.match(/^[^.!?]*(?:[.!?]|$)/)?.[0] ?? t;
  const words = first.split(" ");
  let runEnd = 0;
  while (runEnd < words.length) {
    const w = words[runEnd];
    const core = w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
    if (!core || /^[A-Z0-9$#&]/.test(core) || SMALL_WORDS.test(core)) runEnd++;
    else break;
  }
  if (runEnd < 3) return t;
  let cut = 0;
  let capsRun = 0;
  for (let i = 0; i < runEnd; i++) {
    const w = words[i];
    const core = w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
    const shouted = core.length >= 2 && /[A-Z]/.test(core) && core === core.toUpperCase() && !/\d/.test(core);
    if (shouted && SMALL_WORDS.test(core)) {
      // "THE BEER THE SNACKS EVENTS AND MORE": a shouted "and" is part of the banner, not a break in it.
      if (capsRun) capsRun++;
      if (capsRun >= 2) cut = i + 1;
    } else if (shouted && !STATE_CODE.test(core)) {
      capsRun++;
      if (capsRun >= 2) cut = i + 1;
    } else if (shouted && STATE_CODE.test(core) && i > 0 && /,$/.test(words[i - 1])) {
      cut = i + 1;
      capsRun = 0;
    } else if (i > 0 && /,$/.test(words[i - 1]) && STATE_BY_NAME.has(core.toLowerCase())) {
      cut = i + 1;
      capsRun = 0;
    } else capsRun = 0;
  }
  if (!cut || cut >= words.length) return t;
  const rest = words.slice(cut).join(" ").replace(/^[\s,.:;|–-]+/, "");
  const restAll = rest + t.slice(first.length);
  if (!/^[A-Z"“]/.test(restAll) || rest.length < 30 || !/\s[a-z]{2,}\s/.test(rest)) return t;
  return restAll;
}

/**
 * The paragraph a guest reads under the title. It must open on a real sentence: heading lines, a leading repeat of
 * the name or the city, keyword runs, "Welcome to X!" (when more follows) and phone numbers go; the first letter is
 * upper case, sentences sit one space apart, and the text ends on a sentence inside 600 characters. Navigation text
 * and anything under 40 characters come back empty, since an empty blurb beats junk.
 */
export function cleanBlurb(rawText: string, ctx: { title?: string; city?: string | null; region?: string | null } = {}): string {
  // A theme's Latin filler and a PDF read as text both come through every check below: "Lorem ipsum dolor sit
  // amet, consectetur adipiscing elit." is 56 characters of well-formed prose ending on a full stop, and 26
  // shipped listings publish it. An empty blurb beats junk, and it beats filler for the same reason.
  const raw = ownWords(rawText);
  if (!raw) return "";
  const lines = raw.split(/\r?\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const body = lines.length > 1 ? lines.filter((l) => !isHeadingLine(l)) : lines;
  // cleanPara strips markdown "#"; "#1 dolphin tour" is copy, so the hash before a digit is parked and restored.
  let t = cleanPara(body.join(" ").replace(/#(?=\d)/g, "\u0001")).replace(/\u0001/g, "#").replace(PHONE, " ").replace(/\s+/g, " ").trim();
  // A case-insensitive literal without the i flag, so the "next word is capitalised" lookahead stays case-sensitive.
  const esc = (s: string) =>
    s
      .trim()
      .split(/\s+/)
      .map((word) => [...word].map((ch) => (/\p{L}/u.test(ch) && ch.toLowerCase() !== ch.toUpperCase() ? "[" + ch.toLowerCase() + ch.toUpperCase() + "]" : ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join(""))
      .join("\\s+");
  const region = ctx.region ? ctx.region.toUpperCase() : "";
  const stateAlt = (region ? "(?:" + esc(STATE_NAMES[region] || region) + "|" + region + ")" : "[A-Z]{2}") + "\\b";
  for (let i = 0; i < 4; i++) {
    const before = t;
    // "Welcome to Makin' Waves! We are ..." keeps the second sentence.
    t = t.replace(/^welcome (?:to|aboard)\b[^.!?]{0,80}[.!?]["”]?\s+(?=\S)/i, "");
    // A leading repeat of the name as a label ("Siesta Dolphin Tours - Siesta Key's #1 ...", "Makin Waves: We are ..."), never the name as a subject ("Allure Boat Rentals offers ...").
    if (ctx.title) t = t.replace(new RegExp("^" + esc(ctx.title) + "(?:\\s*[-–—|:]+\\s*|[.!]\\s+)(?=[A-Z\"“(])"), "");
    // "Tampa, FL The premier ..." and "Clearwater Beach FL - We rent ...": a city with its state or a separator, never "Whistler Paintball offers ...".
    if (ctx.city) t = t.replace(new RegExp("^" + esc(ctx.city) + "(?:\\s+(?:[Bb]each|[Bb]ay|[Ii]sland|[Aa]rea))?(?:,?\\s+" + stateAlt + "\\s*[,.:|–—-]*\\s*|\\s*[,.:|–—-]+\\s*(?!" + stateAlt + "))(?=[A-Z\"“(])"), "");
    t = cutLeadingFragment(t);
    // "... in Clearwater, Florida. RENT BY THE HOUR As Low as $85" keeps a shouted banner between sentences.
    t = t.replace(/(^|[.!?]["”]?\s+)(?:[A-Z][A-Z'’&-]+\s+){3,}(?=[A-Z][a-z])/g, "$1");
    t = t.replace(/^[\s,.:;|–—-]+/, "");
    if (t === before) break;
  }
  // "iFLY", "i Tour Puerto Rico" and "barre3" are brands; any other opener gets its capital.
  if (!/^(?:\p{Ll}\p{Lu}|\p{Ll}\s+\p{Lu}|\p{Ll}+\d)/u.test(t)) t = t.charAt(0).toUpperCase() + t.slice(1);
  t = endAtSentence(t, 600);
  if (t.length < 40) return "";
  if ((t.match(NAV_WORD) || []).length >= 3) return "";
  // A blurb that is mostly capitals is a banner or a policy line, not copy.
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length && (t.replace(/[^A-Z]/g, "").length / letters.length) >= 0.5) return "";
  // No sentence end: a meta description the crawler cut short ("... beauty of Earth's amazing"), a keyword list
  // ("surf surfboard stand up paddle SUP kayak") or a comma-chain of tags. Real prose is closed at its last clause
  // when that keeps most of it; the rest is dropped, since an empty blurb beats a line that stops mid-thought.
  if (!/[.!?]["”’)]?$/.test(t)) {
    // "... in the state of", "... selecting the perfect": a line that stops on a function word was cut mid-phrase.
    const DANGLING = /(?:\s+(?:and|or|the|a|an|of|with|for|to|in|at|by|from|&|your|our|their|its|his|her|my|as|that|which|is|are|was|be|been|has|have|will|can|near|over|into|on|s|perfect|best|great|new|ultimate|unique|most|very|more|all|every|each|this|these|those|some|any|such|own|next|first|last|only|no))+[\s,;:–—-]*$/i;
    const commas = (t.match(/,/g) || []).length;
    // "... redfish, trout, grouper, snapper, snook and": a list missing only its last item closes as it stands.
    const openList = commas >= 2 && /,\s+\S+\s+(?:and|or|&)$/i.test(t);
    // "... to meet all your boating": a determiner one word from the end was mid-phrase too.
    const cutShort = !openList && (DANGLING.test(t) || /\s(?:the|your|our|all|its|their|his|her|my|a|an)\s+\S+$/i.test(t) || t.length >= 140);
    t = t.replace(DANGLING, "");
    const words = t.split(" ").length;
    // Prose carries function words; "surf surfboard stand up paddle SUP kayak windsurf" and "Basic / Rental / Group Packages" carry none.
    const functionWords = (t.match(/\b(?:the|a|an|and|of|to|in|is|are|we|our|you|your|with|for|on|at|by|from|it|its|this|that|or|as|be)\b/gi) || []).length;
    if (words < 8 || functionWords < words / 8 || commas >= 6) return "";
    if ((t.match(/\b[A-Z][a-z]+:\s/g) || []).length >= 3) return ""; // "Elevation: 1,516 feet Area Code: 530 Zip Code:"
    if (cutShort) {
      // Crawlers cut meta descriptions near 160 characters. The text can only be closed before a trailing modifier
      // clause (", offering ...", ", which ...", " – ...") that leaves most of the words and no half-finished list.
      let best = -1;
      for (const m of t.matchAll(/,\s(?=(?:[a-z]+ing\s+[a-z]|(?:and|which|where|while|but|so|plus|including)\b))|\s(?:while|whether)\s|\s[–—]\s/g)) {
        const head = t.slice(0, m.index);
        const keep = head.split(" ").length;
        if (keep >= 8 && keep >= words * 0.55 && !/,\s+\S+(?:\s+\S+){0,2}$/.test(head)) best = m.index!;
      }
      if (best < 0) return "";
      t = t.slice(0, best).replace(/[\s,;:–—-]+$/, "") + ".";
    } else t = t.replace(/[\s,;:–—-]+$/, "") + ".";
  }
  return t;
}

/** "Ultimate Tour (ULT) Rates For 3 or more passengers ..." starts with the title and widget labels. Keep the copy. */
function scrubDesc(name: string, desc: string): string {
  // The same screen the blurb gets: o-elgintexas-gov and o-hallcounty-org read a PDF as a service description,
  // and 20 more ship a page theme's "Lorem ipsum" under a real service.
  let d = ownWords(desc).replace(/\s+/g, " ").trim();
  const n = name.replace(/\s+/g, " ").trim();
  if (n && d.toLowerCase().startsWith(n.toLowerCase())) d = d.slice(n.length).replace(/^[\s:\-–|]+/, "");
  d = d.replace(/^(?:(?:rates?|pricing|prices?|duration|about(?: this)?|flight distance|(?:\w+ )?details?|overview|description|read more|learn more)\s*:?\s*)+/i, "");
  d = d.replace(/\b(?:Duration|Meeting Location|Rates?|About This|Flight Distance)\s*:?\s*(?=[A-Z0-9$])/g, "");
  return d.trim();
}

const SPIRITS = /\b(brandy|whiskey|whisky|bourbon|rye|gin|vodka|rum|tequila|mezcal|liqueur|mead|cider|ipa|lager|stout|ale|pinot|cabernet|chardonnay|merlot|rosé|rose wine|reserve|barrel|cask|vintage)\b/i;
const MERCH = /\b(t-?shirts?|hoodies?|sweatshirts?|hats?|caps?|stickers?|mugs?|koozies?|\d{3}\s?ml|bottles?|6-?pack|case of|gift ?cards?|gift certificates?|crossbows?|bows?\b|arrows?|broadheads?|quiver|scopes?|ammo\b|ammunition|merch(andise)?|apparel|decals?|posters?|dvd|membership dues|donation|sponsor(ship)?|field trip|school group)\b/i;

function hostOf(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : "https://" + url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return url.toLowerCase();
  }
}

/** graylinetoronto.tours and graylinetoronto.com are one brand; so is mammothpack.wixsite.com for mammothpack.com. */
function sameBrand(url: string | null, domain: string): boolean {
  if (!url) return false;
  const host = hostOf(url);
  const label = (d: string) => d.replace(/^www\./, "").split(".")[0];
  const own = label(domain);
  if (own.length < 5) return false;
  if (/\.(wixsite|squarespace|weebly|godaddysites|wordpress|webflow\.io|myshopify|square\.site|business\.site)\b/.test(host)) return host.startsWith(own) || host.includes(own);
  return label(host) === own;
}

/** True when the page belongs to the operator (or a booking widget acting for them). Another business's site never counts. */
function sourceIsOwn(url: string | null, domain: string): boolean {
  if (!url) return true;
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return true;
  }
  const own = domain.toLowerCase().replace(/^www\./, "");
  if (host === own || host.endsWith("." + own)) return true;
  return WIDGET_HOSTS.test(host);
}

const CITY_SLUGS: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const c of CITIES) m.set(slug(c.name), c.name.toLowerCase());
  return m;
})();

/** A page under /locations/greensboro or /birthdays/anderson belongs to a branch in another town, not to this listing. */
function sourceIsAnotherTown(url: string | null, city: string | null, metroId: string | null): boolean {
  if (!url || !city) return false;
  let path = "";
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return false;
  }
  const own = new Set([slug(city), metroId ? slug(metroId) : ""]);
  for (const seg of path.split("/")) {
    if (seg.length < 5) continue;
    const hit = CITY_SLUGS.get(seg) || (seg.replace(/-(location|branch|park|store)$/, "") !== seg ? CITY_SLUGS.get(seg.replace(/-(location|branch|park|store)$/, "")) : undefined);
    if (hit && !own.has(seg) && !own.has(slug(hit)) && !slug(city).includes(seg) && !seg.includes(slug(city))) return true;
  }
  return false;
}

/** "$35 per lane" is a lane, not a boat; "$1,200 each" on a charter is the whole trip, not a seat. */
function fixUnit(o: { name: string; detail: string | null; price_cents: number | null; price_unit: string | null }): string | null {
  const text = (o.name + " " + (o.detail || "")).toLowerCase();
  if (/per (lane|room|cart|bay|court|table|booth|cabana|pod|suite)\b/.test(text)) return "/group";
  if (/per (boat|charter|vessel|yacht)\b/.test(text)) return "/boat";
  if (/per (person|adult|child|guest|rider|passenger|player|jumper|diver|student)\b|\bpp\b/.test(text)) return "each";
  if ((o.price_unit == null || o.price_unit === "each") && (o.price_cents || 0) >= 60000) return "/group";
  return o.price_unit;
}

/** One clean statement: not a question, not a mashed paragraph, not a scraped aside. */
/** "Must be 21 with ID" and "All participants must be age 21 or older with a valid ID" say one thing. Keep the shortest per topic. */
function collapseRules(lines: string[]): string[] {
  const byKey = new Map<string, string>();
  const order: string[] = [];
  for (const l of lines) {
    const nums = (l.match(/\d+/g) || []).join(",");
    const tail = l.match(/:\s*(minimum \d+ (guests?|people|riders?|passengers?) per booking\.?)$/i);
    if (tail) {
      const key = "min:" + tail[1].toLowerCase();
      if (!byKey.has(key)) {
        byKey.set(key, tail[1].charAt(0).toUpperCase() + tail[1].slice(1));
        order.push(key);
      }
      continue;
    }
    const topic = /\b(age|years?|old|older|minor|child|kid|adult|\d+\s*\+)\b/i.test(l) ? "age" : /\b(weight|lbs?|pounds?|kg)\b/i.test(l) ? "weight" : /\b(height|tall|inches|cm)\b/i.test(l) ? "height" : /\b(licen[cs]e|permit|boater)\b/i.test(l) ? "license" : "";
    const key = topic && nums ? topic + ":" + nums : l.toLowerCase();
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, l);
      order.push(key);
    } else if (l.length < cur.length) byKey.set(key, l);
  }
  return order.map((k) => byKey.get(k)!);
}


const SILENT = /\b(not|no|none|nothing)\b[^.]{0,50}\b(stated|specified|listed|mentioned|provided|published|given|indicated)\b|\bnot (state|specify|mention|list)\b|\bunspecified\b|\bn\/a\b|\bno information\b/i;
/** A value that only says "not stated" is no value. */
function silent(v: string | null | undefined): string | null {
  return v && !SILENT.test(v) ? v : null;
}
/** Remove sentences that only say a policy is absent. */
function dropSilent(t: string): string {
  return t.split(/(?<=[.!?])\s+/).filter((x) => !SILENT.test(x)).join(" ").trim();
}

function isTidyLine(l: string): boolean {
  if (l.length < 6 || l.length > 150) return false;
  // "Deposit policy not stated" tells a guest nothing; the extractor writes these when a site is silent.
  if (SILENT.test(l)) return false;
  if (/\?\s*$/.test(l) || /\?\s+[A-Z]/.test(l)) return false;
  if (/^(and|but|or|so|also|please note|note:|p\.s\.)\b/i.test(l)) return false;
  if (/\b(duration|meeting location|rates?)\b.*\$\d/i.test(l)) return false;
  if (/not limited to|click|subscribe|newsletter|follow us/i.test(l)) return false;
  return true;
}

/** Things a site sells that a guest does not book a time for. */
export const NOT_A_SERVICE = /\b(gift ?cards?|gift certificates?|e-?gift|merch(andise)?|t-?shirts?|hats?|apparel|donation|membership|season pass|parking)\b/i;

/**
 * Which rows of a crawled menu become bookable options, and where each one lands in that shorter list.
 *
 * `options` and `services` are two views of one menu: every service tier carries an `optionIdx` that is a
 * position in `options`. They have to drop the same rows and count them the same way. They did not. The
 * options filter dropped a membership or a gift card and closed the gap, while the services loop went on
 * counting through the whole menu, so a shop whose menu opened with a gift card gave every tier after it an
 * index one too far: the last tier pointed past the end of the list and the ones before it at the wrong trip,
 * so picking "2.5 hours, $220" would have booked the row below it. Nothing shipped with this, because
 * `public/o` was written before the options filter existed. The next sync is what would have carried it.
 *
 * It is also where a row that is no kind of service comes out (`src/lib/menuRow.ts`): the archive of what a
 * museum used to show, and an FAQ heading with nothing priced under it.
 */
export function bookableOptions(menu: { name: string; price_cents: number | null }[], art: string): { optionIdxOf: Map<number, number>; menuRowOf: number[] } {
  const optionIdxOf = new Map<number, number>();
  /** The other way round: the menu row each published option came from, for the code that re-reads its raw name. */
  const menuRowOf: number[] = [];
  menu.forEach((o, idx) => {
    if (NOT_A_SERVICE.test(o.name)) return;
    if (!bookableRow(plainName(o.name, art), o.price_cents == null ? null : o.price_cents / 100)) return;
    optionIdxOf.set(idx, menuRowOf.length);
    menuRowOf.push(idx);
  });
  return { optionIdxOf, menuRowOf };
}

function uniq(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter((x) => x && !seen.has(x.toLowerCase()) && (seen.add(x.toLowerCase()), true));
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "\u2019", lsquo: "\u2018", ldquo: "\u201c", rdquo: "\u201d", ndash: "\u2013", mdash: "\u2014", hellip: "\u2026", copy: "\u00a9", reg: "\u00ae", trade: "\u2122", deg: "\u00b0", eacute: "\u00e9" };
/** Sites leave HTML entities in meta descriptions and menus. Guests should never see "&amp;". Runs twice for double-encoded text. */
export function decodeEntities(raw: string): string {
  const once = (t: string) =>
    t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
      if (code[0] === "#") {
        const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : m;
      }
      return NAMED[code.toLowerCase()] ?? m;
    });
  return once(once(raw));
}

/** Markdown, image tags and widget leftovers out; one clean sentence in. */
function cleanLine(raw: string): string {
  return raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#*_>`]+/g, " ")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^\s*(?:\(?\d{1,2}[.)]|[-–•·]|[a-z][.)]|[AQ]\s*[-–:])\s+/i, "")
    // "Additional Information: ...", ": Daytime only 9-5", "SUNDAY----10am-9PM": scraped labels and separators, not words.
    .replace(/^\s*(?:additional (?:information|info|details)|please note|note|important|(?:cruise|tour|trip|lesson|class|event|package) details)\s*[:\-–]\s*/i, "")
    .replace(/^[\s:;,.\-–—|]+/, "")
    .replace(/\s*-{2,}\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

/**
 * A menu's own em or en dash never survives to a guest. A number or month on each side ("2–15 years",
 * "May–October") is a range and reads as "to"; anything else was punctuation and reads as a comma, the
 * substitute AGENTS.md names for an em dash.
 */
const MONTH = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
export function tidyDashes(raw: string): string {
  return raw
    .replace(/(\d)\s*[–—]\s*(?=\d)/g, "$1 to ")
    .replace(new RegExp("\\b(" + MONTH + ")\\.?\\s*[\\u2013\\u2014]\\s*(?=[A-Za-z])", "gi"), "$1 to ")
    // What is left joined two clauses, not a range: a capital letter after it was its own sentence, else a comma.
    .replace(/\s*[–—]\s*(\S)/g, (_m, next: string) => (/[A-Z]/.test(next) ? ". " : ", ") + next)
    .replace(/\s+/g, " ")
    .trim();
}

function cleanPara(raw: string): string {
  const flat = raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#*_>`]+/g, " ")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // Sites repeat the same sentence in two places. Keep each once, and never cut mid-sentence.
  const seen = new Set<string>();
  const out: string[] = [];
  let len = 0;
  for (const sentence of flat.split(/(?<=[.!?])\s+(?=[A-Z0-9"(])/)) {
    const key = sentence.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    if (len + sentence.length > 700) break;
    seen.add(key);
    out.push(sentence);
    len += sentence.length + 1;
  }
  if (out.length > 1 && !/[.!?)"]$/.test(out[out.length - 1])) out.pop();
  return out.join(" ");
}

/** FAQ facts come as "Question? >Answer", "Q – Question? A – Answer", or several of those packed together. */
function parseFaqs(raw: string): { q: string; a: string }[] {
  const t = cleanPara(raw).replace(/\bA\s*[-–:]\s*/g, " ").trim();
  const chunks = t.split(/\bQ\s*[-–:.]\s*/).map((c) => c.trim()).filter(Boolean);
  const out: { q: string; a: string }[] = [];
  for (const c of chunks) {
    const i = c.indexOf("?");
    if (i < 8 || i > 160) continue;
    const before = c.slice(0, i + 1);
    const cut = Math.max(before.lastIndexOf(". "), before.lastIndexOf("! "));
    let q = before.slice(cut === -1 ? 0 : cut + 2).replace(/^[\s\-–—•·:]+/, "").trim();
    // "Ride the Boomerang Yacht Trips Can I buy a ticket at check-in?" carries a scraped heading before the question.
    if (q.split(" ").length > 9) {
      const m = q.match(/^(.*?\S)\s+((?:Can|Could|Do|Does|Did|Is|Are|Was|Were|What|How|Where|When|Why|Which|Will|Would|Should|May|Am|Who)\b.*\?)$/);
      if (m && m[1].split(" ").length >= 2) q = m[2];
    }
    // The answer ends where the next question begins.
    let a = c.slice(i + 1).replace(/^\s*>\s*/, "").trim();
    const next = a.search(/[.!]\s+[A-Z][^.!?]{8,120}\?/);
    if (next > 20) a = a.slice(0, next + 1);
    if (q.length < 8 || a.length < 12) continue;
    out.push({ q, a: a.slice(0, 500) });
  }
  return out;
}

function uniqBy<T>(list: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return list.filter((x) => !seen.has(key(x)) && (seen.add(key(x)), true));
}

/**
 * One business published on two domains. Hubbard's Marina and "Dolphin Quest Eco Tours" carry byte-identical photo
 * lists and the same menu, because the second domain is the same boats under another brand. Four shared photos or
 * five shared (name, price) lines is past coincidence. Keyed by photo URL and by menu line, so this walks the
 * catalog once rather than comparing 55,000 rows with each other; a URL or a line that a dozen listings share is a
 * stock photo or a generic label and proves nothing, so it is skipped.
 */
export type DuplicateSide = { claimed: boolean; canonical: boolean; reviews: number; domain: string };

/**
 * Two rows that share enough photos and priced menu lines to be one business. Which one keeps the page.
 *
 * Claimed first, and above everything else. The other three tests read the crawl, and the crawl has no opinion
 * on which of two rows a person actually signed in to and filled in: a shop that claimed its page could lose to
 * an unclaimed copy of itself on review count or on having a shorter domain, and its operator would find their
 * listing gone from the site with nothing on their dashboard to explain it. Their claim, their session, their
 * edits and the link in their claim email are all on the id that was dropped.
 *
 * After that: the row whose domain is the site's own canonical host, then the one with more reviews, then the
 * shorter domain.
 */
export function betterDuplicate(a: DuplicateSide, b: DuplicateSide): { keep: "a" | "b"; why: string } {
  const tests: { why: string; of: (s: DuplicateSide) => number }[] = [
    { why: "claimed by its operator", of: (s) => (s.claimed ? 1 : 0) },
    { why: "canonical host", of: (s) => (s.canonical ? 1 : 0) },
    { why: "more reviews", of: (s) => s.reviews },
    { why: "shorter domain", of: (s) => -s.domain.length },
  ];
  for (const t of tests) {
    const va = t.of(a);
    const vb = t.of(b);
    if (va !== vb) return { keep: vb > va ? "b" : "a", why: t.why };
  }
  return { keep: "a", why: "shorter domain" };
}

function dropDuplicateOperators(full: Record<string, unknown>[]): Record<string, unknown>[] {
  const index = (key: string, i: number, map: Map<string, number[]>) => {
    const at = map.get(key);
    if (at) at.push(i);
    else map.set(key, [i]);
  };
  const byPhoto = new Map<string, number[]>();
  const byOption = new Map<string, number[]>();
  full.forEach((item, i) => {
    for (const url of new Set((item.photos as string[] | undefined) || [])) if (url) index(url, i, byPhoto);
    const seen = new Set<string>();
    for (const o of (item.options as { name: string; price: number | null }[] | undefined) || []) {
      // A name with no price ("Private Boat Charters") is a label two rival shops both use. Only a name AND a price match.
      if (o.price == null) continue;
      const key = o.name.toLowerCase().trim() + "|" + o.price;
      if (o.name.trim().length >= 6 && !seen.has(key)) {
        seen.add(key);
        index(key, i, byOption);
      }
    }
  });
  const pairs = new Map<string, { photos: number; options: number }>();
  const tally = (map: Map<string, number[]>, field: "photos" | "options") => {
    for (const idxs of map.values()) {
      if (idxs.length < 2 || idxs.length > 12) continue;
      for (let a = 0; a < idxs.length; a++)
        for (let b = a + 1; b < idxs.length; b++) {
          const key = idxs[a] + ":" + idxs[b];
          const cur = pairs.get(key) || { photos: 0, options: 0 };
          cur[field]++;
          pairs.set(key, cur);
        }
    }
  };
  tally(byPhoto, "photos");
  tally(byOption, "options");
  const canonical = new Map<string, string>();
  const dropped = new Set<number>();
  for (const [key, n] of pairs) {
    if (n.photos < 4 && n.options < 5) continue;
    const [a, b] = key.split(":").map(Number);
    if (dropped.has(a) || dropped.has(b)) continue;
    for (const i of [a, b]) {
      const domain = String(full[i].src);
      if (canonical.has(domain)) continue;
      const row = db.prepare("SELECT website FROM operators WHERE domain = ? LIMIT 1").get(domain) as { website: string | null } | undefined;
      canonical.set(domain, row?.website ? hostOf(row.website) : "");
    }
    const side = (i: number): DuplicateSide => {
      const domain = String(full[i].src);
      return { claimed: !!full[i].claimed, canonical: canonical.get(domain) === domain, reviews: Number(full[i].reviews) || 0, domain };
    };
    const verdict = betterDuplicate(side(a), side(b));
    const keep = verdict.keep === "a" ? a : b;
    const drop = verdict.keep === "a" ? b : a;
    const why = verdict.why;
    dropped.add(drop);
    const shared = n.photos + " photos, " + n.options + " menu lines";
    cleanupLog?.dupes.push({ kept: String(full[keep].src), dropped: String(full[drop].src), why, shared });
    console.log("Duplicate operator: kept " + full[keep].src + ", dropped " + full[drop].src + " (" + shared + ", " + why + ")");
  }
  return full.filter((_, i) => !dropped.has(i));
}

/**
 * Whether a crawled row is worth a page on the site.
 *
 * Three rules, all of them reading the crawl and nothing else: the domain we found the business on, the name we
 * scraped off it, the pin OpenStreetMap gave it, and whether any crawler has ever read a photo, a service or an
 * hours line from its own site (that last one is `dead`, worked out by the caller against the facts table and
 * the JSON shards).
 *
 * And one rule above all three: a listing its operator has claimed is never refused. A claim is a person
 * answering by hand every question these rules ask of a crawler, and their answers are merged in further down,
 * after these filters have already decided the row gets no page. Without this, a shop that claimed its listing,
 * typed in its menu, its hours and its photos and pressed Publish loses its page on the next sync for the sole
 * reason that no crawler ever reached its website. Pausing a listing is a separate, later filter on
 * `published`, and stays the operator's own choice.
 */
export function passesCatalogFilters(
  r: Pick<CatalogRow, "id" | "domain" | "name" | "legal_name" | "city" | "region" | "lat" | "lon">,
  opts: { dead: Set<string> | ReadonlySet<string>; claimed: (id: string) => boolean },
): boolean {
  if (opts.claimed(r.id)) return true;
  if (MARKETPLACES.test(r.domain) || NOT_OPERATOR_HOST.test(r.domain)) return false;
  if (opts.dead.has(r.id)) return false;
  if (NOT_EXPERIENCE.test(r.name) || /^\s*\$?\d+(\.\d+)?\s*$/.test(r.name)) return false;
  // "Home", "Welcome" and a bare domain are page titles, not business names. A guest cannot tell what they are.
  const t = cleanTitle(decodeEntities(r.name), { city: r.city, region: r.region, legalName: r.legal_name });
  if (t.length < 3 || SITE_WORDS.test(t) || NAV_LABEL.test(t) || GENERIC_TITLE.test(t) || /^(?:https?:\/\/|www\.)/i.test(t)) return false;
  // Outside the US and Canada, by pin or by address, is outside the market (a Cairns balloon flight tagged HI).
  if (r.lat != null && r.lon != null && !inNorthAmerica(r.lat, r.lon)) return false;
  if (r.region && r.region.length === 2 && !NA_REGION.test(r.region.toUpperCase())) return false;
  return true;
}

/**
 * Every catalog listing, built and cleaned, writing nothing. `syncCatalogToApp` writes what this returns; a check
 * script can call it with a filter (one metro, say) to read the same items the site would publish.
 */
export function buildCatalogItems(where?: (r: CatalogRow) => boolean): Record<string, unknown>[] {
  const rows = db
    .prepare(
      `SELECT id, domain, name, legal_name, website, city, region, metro_id, family, icon_key, rating, review_count, origin, lat, lon
       FROM operators WHERE origin != 'demo' AND name IS NOT NULL AND length(name) >= 3
       ORDER BY completeness DESC, name ASC`,
    )
    .all() as CatalogRow[];
  /**
   * A listing reaches guests once we have read something off its own site: a photo, a service, or its hours.
   * A name, a website and a phone number is a lead, not a page worth opening, and it is what discovery hands
   * us before any crawl has run.
   *
   * This became load-bearing on 18 September 2026, when open place data took the catalog from 142,628
   * operators to 423,380 overnight. The old rule published anything with a website or a phone, which would
   * have put 350,258 listings on the site: a 136 MB catalog.json fetched by every visitor at startup, against
   * 23 MB today, and 350,258 files under public/o. The crawl fills these in over about three days, and each
   * listing publishes itself on the sync after it is read, so the catalog grows as fast as we learn something
   * real and never faster.
   */
  const dead = new Set(
    (db.prepare(
      `SELECT o.id FROM operators o
        WHERE NOT EXISTS (SELECT 1 FROM facts f WHERE f.operator_id = o.id AND f.fact_key IN ('cover', 'photo'))
          AND NOT EXISTS (SELECT 1 FROM offerings x WHERE x.operator_id = o.id)
          AND o.hours IS NULL
          AND NOT EXISTS (SELECT 1 FROM facts h WHERE h.operator_id = o.id AND h.fact_key = 'hours_text')`,
    ).all() as { id: string }[]).map((r) => r.id),
  );
  // Photos from the cloud crawl live in JSON shards, not in facts, so the query above cannot see them. Without
  // this, every listing whose only photo came from that crawl would be treated as having nothing to show and
  // would drop off the site: 25,000 of the 37,841 published with a cover.
  for (const id of Array.from(dead)) {
    if (crawledPhotosFor(id).photos.length) dead.delete(id);
    else if (crawledStructureFor(id).offerings.length || crawledHoursFor(id)) dead.delete(id);
  }
  /**
   * A listing an operator has claimed is never dropped by any of this.
   *
   * Every filter below reads the crawl: the name we scraped, the domain we found it on, the pin OpenStreetMap
   * gave it, and whether a crawler has ever read a photo, a service or an hours line off its site. A claim is a
   * person answering all of that by hand, and their edits are applied further down, after these filters have
   * already decided the row is not worth a page. So a shop that claimed its listing, typed in its menu, its
   * hours and its photos and pressed Publish would have had its page deleted by the next sync for the sole
   * reason that no crawler ever reached its website. The gate above went in on 18 September 2026 and drops
   * 12,332 listings on its first run; every claimed one among them is an operator we asked to sign up.
   *
   * `published: false` is a different question and is still honoured below: pausing a listing is the
   * operator's own choice, and this does not undo it.
   */
  const claimed = (id: string) => overlays.has(id);
  for (const id of Array.from(dead)) if (claimed(id)) dead.delete(id);
  const full = rows
    .filter((r) => (where ? where(r) : true))
    .filter((r) => passesCatalogFilters(r, { dead, claimed }))
    .map(toCatalogItem)
    .map((item) => {
      const ov = profileOverlay(String(item.id));
      if (!ov) return item;
      const base = item as unknown as Record<string, unknown>;
      const merged: Record<string, unknown> = { ...base, ...ov.patch, id: base.id, claimKey: base.claimKey, claimed: true, published: ov.published };
      return merged as unknown as typeof item;
    })
    .filter((item) => (item as unknown as { published?: boolean }).published !== false);
  // A map pin and the operator's own site for the same business in the same metro: keep the site row, drop the pin.
  const siteKeys = new Set(full.filter((i) => !String(i.id).startsWith("o-osm-")).map((i) => titleKey(String(i.title)) + "|" + (i.metroId || i.area)));
  // Not one an operator has claimed: the claim is on this id, the dashboard edits this id, and the link in
  // their claim email opens this id. Dropping it in favour of an unclaimed row of the same business takes the
  // page they filled in off the site and leaves them signed in to a listing no guest can reach.
  const pinDupes = full.filter((i) => String(i.id).startsWith("o-osm-") && !i.claimed && siteKeys.has(titleKey(String(i.title)) + "|" + (i.metroId || i.area)));
  for (const d of pinDupes) full.splice(full.indexOf(d), 1);
  console.log("Left out " + dead.size + " map-only rows with nothing a guest can use and " + pinDupes.length + " map pins that duplicate a site row.");
  return dropDuplicateOperators(full as Record<string, unknown>[]);
}

/**
 * A card's compact deal badge ("2|Half-price Tuesdays"): the first day-specific promo, its title cut on a word so
 * a card never shows "rentals on Sund", and never left ending on a connector a card cannot finish ("Monday to").
 */
export function compactDeal(promos: { text: string; title?: string; days: number[] }[]): string | undefined {
  const p = promos.find((x) => x.days.length);
  if (!p) return undefined;
  const words = (p.title || p.text || "").split(/\s+/);
  let label = "";
  for (const w of words) {
    if ((label + " " + w).trim().length > 48) break;
    label = (label + " " + w).trim();
  }
  label = label.replace(/(?:\s+(?:and|or|to|on|at|in|of|for|with|the|a|an|from|by|&))+$/i, "").replace(/,\s*$/, "");
  return p.days.join(",") + "|" + (label || (p.title || p.text).slice(0, 48));
}

/** Write public/catalog.json: every real operator plus its contact facts. The app fetches it at startup. */
export function syncCatalogToApp(): { path: string; count: number } {
  const full = buildCatalogItems();
  const contactByDomain: Record<string, OperatorContact> = {};
  for (const c of allContacts()) contactByDomain[c.domain] = c;

  // One small file per operator with everything: services, photos, videos, facts, contact.
  const dir = join(appDataDir, "../../public/o");
  mkdirSync(dir, { recursive: true });
  const keep = new Set<string>();
  for (const item of full) {
    const c = contactByDomain[String(item.src)];
    const contact = c
      ? { domain: c.domain, phone: c.phone, street: c.street, city: c.city, region: c.region, postal: c.postal, hours: c.hours }
      : undefined;
    const file = item.id + ".json";
    keep.add(file);
    writeFileSync(join(dir, file), JSON.stringify({ ...item, contact }));
  }
  for (const f of readdirSync(dir)) if (!keep.has(f)) unlinkSync(join(dir, f));

  // The browse catalog carries only what cards, rails and search need. Details load per listing.
  const operators = full.map((item) => {
    const options = (item.options as { price: number | null }[]) || [];
    const priced = options.map((o) => o.price).filter((n): n is number => n != null && n > 0);
    return {
      id: item.id, title: item.title, cat: item.cat, art: item.art, area: item.area, metroId: item.metroId, src: item.src,
      rating: item.rating, reviews: item.reviews, lat: item.lat, lon: item.lon, cover: item.cover, video: item.video,
      locations: item.locations,
      tags: ((item.tags as string[]) || []).slice(0, 6),
      from: priced.length ? Math.min(...priced) : undefined,
      dur: item.dur, fc: item.fc, kindUnconfirmed: item.kindUnconfirmed,
      // First day-specific deal, compact ("2|Half-price Tuesdays"), so cards can badge "Deal today" without the detail file.
      // The consolidated title, not a raw fragment, so the card and the listing's Deals section say the same thing.
      deal: compactDeal((item.promos as { text: string; title?: string; days: number[] }[] | undefined) || []),
      // Compact week from the published hours, so the home page can say "open now" without a detail file.
      hrs: (() => {
        const own = (item.hoursText as string[] | undefined) || [];
        const c = contactByDomain[String(item.src)];
        const lines = own.length ? own : c?.hours || [];
        return lines.length ? encodeWeek(lines) || undefined : undefined;
      })(),
      options: [], specs: [], includes: [], gap: "", lite: true, unlisted: (item as { unlisted?: boolean }).unlisted || undefined,
      /**
       * Nothing here a guest can act on: no photo, no price, no hours, no services, no description. Most of
       * these are map pins whose website has not been crawled yet, so the flag clears itself as the crawl
       * reaches them. Browse and the rails leave them out rather than filling a grid with identical
       * placeholders; searching the business by name still finds it, and its own page still opens, because
       * every claim email links straight to one.
       */
      thin:
        !item.cover &&
        !priced.length &&
        !options.length &&
        // hoursText is always an array, and an empty array is truthy, so this has to ask for its length.
        !(item.hoursText as string[] | undefined)?.length &&
        !(item.tags as string[] | undefined)?.length &&
        !item.blurb
          ? (true as const)
          : undefined,
    };
  });
  // Published hours can come from the contact record rather than the listing, so the flag is settled here.
  for (const o of operators) if (o.thin && o.hrs) (o as { thin?: true }).thin = undefined;
  const crawl = crawledPhotoStats();
  if (crawl.operators) console.log(`Cloud photo crawl has reached ${crawl.operators.toLocaleString()} operators; ${crawl.withPhotos.toLocaleString()} of them have photos now.`);
  const structure = crawledStructureStats();
  if (structure.operators) console.log(`Cloud structure crawl has read ${structure.operators.toLocaleString()} sites; ${structure.withServices.toLocaleString()} have services and ${structure.withPrices.toLocaleString()} have a price.`);
  const thin = operators.filter((o) => o.thin).length;
  console.log(`${operators.length} listings, ${thin} with nothing a guest can act on yet (${Math.round((100 * thin) / operators.length)}%), left out of browse.`);
  const path = join(appDataDir, "../../public/catalog.json");
  writeFileSync(path, JSON.stringify({ generatedAt: new Date().toISOString(), operators, contacts: {} }));
  // A scale model of the browsable catalog, so the first paint shows the mix the finished page shows.
  const lite = buildLiteShard(operators as LiteRow[]);
  writeFileSync(join(appDataDir, "../../public/catalog-lite.json"), JSON.stringify({ generatedAt: new Date().toISOString(), operators: lite, contacts: {} }));
  // Live times need each vendor-backed listing's booking link, and the API host has no facts table: the link is
  // published here, keyed by catalog id, for the API to read (bookingUrlFor in enrich/availability.ts). These are
  // FareHarbor, Peek and Xola pages, public by nature; the guest page itself still never shows them.
  const published = new Set((operators as { id: string }[]).map((o) => o.id));
  const liveUrls: Record<string, string> = {};
  for (const row of db.prepare("SELECT o.domain AS domain, f.fact_value AS url FROM operators o JOIN facts f ON f.operator_id = o.id AND f.fact_key = 'booking_url' WHERE f.fact_value LIKE '%fareharbor.com/%' OR f.fact_value LIKE '%peek.com/s/%' OR f.fact_value LIKE '%xola.%'").all() as { domain: string; url: string }[]) {
    const id = "o-" + slug(row.domain);
    if (published.has(id) && !liveUrls[id]) liveUrls[id] = row.url;
  }
  writeFileSync(join(appDataDir, "../../public/live-index.json"), JSON.stringify({ generatedAt: new Date().toISOString(), urls: liveUrls }));
  console.log("Wrote live booking links for " + Object.keys(liveUrls).length + " listings to public/live-index.json");
  // The landing pages and the listing pages get the same listings browse gets. `thin` is decided above, on the
  // browse record, so it is carried across by id rather than worked out a second time from a different shape.
  const thinIds = new Set(operators.filter((o) => o.thin).map((o) => o.id as string));
  const listable = full
    .filter((i) => !(i as { unlisted?: boolean }).unlisted)
    .map((i) => (thinIds.has(i.id as string) ? { ...i, thin: true } : i)) as never;
  // The static pages a search engine reads, the activity-and-city ones and one per listing worth indexing, are
  // built into `dist` by scripts/build-pages.mts during the site build, not written here. There are about 14,500
  // of them and every sync rewrites most, so committing them put hundreds of megabytes a week of churn into a
  // repository already carrying the catalog. They are built from public/catalog.json and public/o, which this
  // sync does write, so the pages are reproducible from what it commits.
  void writeLandingPages;
  void writeListingPages;
  return { path, count: operators.length };
}
