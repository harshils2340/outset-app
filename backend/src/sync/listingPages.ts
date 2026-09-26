import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freeCancelBadge } from "../../../src/lib/cancellation.ts";
import { sayLength } from "../../../src/lib/duration.ts";
import { displayHours } from "../../../src/lib/hoursText.ts";
import { cleanDesc, splitIncluded, tidyLine } from "../../../src/lib/listingDerive.ts";
import { listingFacts } from "../../../src/lib/catalog.ts";
import { photoCandidates } from "../../../src/lib/samePhoto.ts";
import type { Unclaimed } from "../../../src/data/types.ts";
import { METROS } from "../taxonomy/catalog.ts";
import { REGION_NAME, countryOfArea, regionOfArea } from "../../../src/data/regions.ts";
import { KINDS, bookablePages, cardPhoto, fileFor, hasListingPage, pageFooter, placeName, priceOf, publicSite, socialCard, type Item, type Kind } from "./pages.ts";

/**
 * One static page per listing, /l/<id>.html: the business's own name, area, blurb, menu, hours, policies, FAQ
 * and photos, built only from facts the listing's own record holds. This is the second hop a search engine or a
 * shared link needs to reach a real listing: the app itself is a single empty div until its bundle runs, so a
 * crawler that only ever saw https://onoutset.com/#o=<id> read nothing. Landing pages (pages.ts) are the first
 * hop, browse and card grids; this is the second, one page per business.
 *
 * Scope: a listing gets a page only when it has a cover photo. `thin` (pages.ts's own "nothing a guest can act
 * on" flag, computed in sync/contacts.ts) requires no cover as one of its conditions, so a listing with a cover
 * is never thin; the two conditions the brief asks for ("has a cover photo and is not thin") collapse to one
 * check here, and there is no need to import or recompute `thin`. `unlisted` listings are expected to already be
 * filtered out of `items` before this runs, the same way sync/contacts.ts filters them before writeLandingPages.
 *
 * Every fact on the page comes from the item object passed in: no invented price, rating, review count, hours
 * or policy, and no "not published" filler where a fact is simply absent, that section is left out instead.
 */

const here = dirname(fileURLToPath(import.meta.url));
const defaultPublicDir = join(here, "../../../public");

const MAX_PHOTOS = 6;
const MAX_MENU_ROWS = 12;
const MAX_LIST_ITEMS = 6;
const MAX_FAQ = 6;
const SITEMAP_CHUNK = 40_000;

/**
 * `listingFacts` reads a full catalog record and walks `specs`, `extraNote`, `gap` and `options`. A page item
 * carries whichever of those the sync wrote, so the missing ones are filled with the empty value rather than
 * left undefined: `gap` in particular is split, and an absent one would throw mid-build.
 */
function unclaimedShape(item: unknown): Unclaimed {
  const raw = item as Partial<Unclaimed>;
  return { ...raw, specs: raw.specs || [], options: raw.options || [], gap: raw.gap || "" } as Unclaimed;
}

/** The app's own comparison for "this line is already printed above": letters and digits, nothing else. */
const factKey = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (n: number) => (Number.isInteger(n) ? "$" + n.toLocaleString("en-US") : "$" + n.toFixed(2));
// A business's own name or FAQ text, crawled from its site, can contain "</script>": JSON.stringify does not
// escape "<", so that string would close this tag early and let whatever follows run as HTML. < reads back
// as the same JSON, so nothing here is lossy.
const ldJson = (ld: unknown) => JSON.stringify(ld).replace(/</g, "\\u003c");

// The blurb cut this file used to own now serves every budget a guest's prose is cut to; see lib/clip.ts.
import { clip } from "../lib/clip.ts";
export { clip };


/**
 * schema.org type, where the activity implies a real one in the vocabulary and it stays a LocalBusiness (so
 * address, geo, telephone and aggregateRating all still apply). Everything else, including any kind whose own
 * text never confirmed it (`kindUnconfirmed`), stays the generic `LocalBusiness`: a specific type is itself a
 * fact about the business, and a guessed kind does not get to state one.
 */
const ART_SCHEMA_TYPE: Record<string, string> = {
  golf: "GolfCourse",
  bowling: "BowlingAlley",
  ski: "SkiResort",
  fitness: "ExerciseGym",
  climbing: "ExerciseGym",
  gymnastics: "ExerciseGym",
  martialarts: "ExerciseGym",
  tennis: "TennisComplex",
  swim: "PublicSwimmingPool",
  zoo: "Zoo",
  aquarium: "Aquarium",
  museum: "Museum",
  themepark: "AmusementPark",
  waterpark: "AmusementPark",
  spa: "DaySpa",
  sauna: "DaySpa",
  winery: "Winery",
  brewery: "Brewery",
  distillery: "Distillery",
  camping: "Campground",
};

function schemaType(item: Item): string {
  if ((item as { kindUnconfirmed?: boolean }).kindUnconfirmed) return "LocalBusiness";
  return ART_SCHEMA_TYPE[String(item.art)] || "LocalBusiness";
}

type Contact = { domain?: string; phone?: string; street?: string; city?: string; region?: string; postal?: string; hours?: string[] } | undefined;

/**
 * Every photo this page may show: the cover first, then the gallery, folded to one tile per photograph and
 * capped at MAX_PHOTOS.
 *
 * Folding is `photoCandidates`, the rule the hero and the lightbox already read, not a match on the exact URL.
 * A site links one photograph under both schemes, with and without `www.`, and at whatever size its resizing
 * CDN was asked for, and the crawl keeps every spelling it saw: matching on the string left 716 of these pages
 * printing the same picture two to four times inside a six tile grid, and naming it that many times over in
 * the JSON-LD a search engine reads. The scheme filter runs first, so the spelling a tile keeps is one a
 * browser can actually fetch.
 */
function photosOf(item: Item): string[] {
  const cover = typeof item.cover === "string" && /^https?:\/\//i.test(item.cover) ? item.cover : undefined;
  const gallery = ((item as { photos?: unknown[] }).photos || []).filter((p): p is string => typeof p === "string" && /^https?:\/\//i.test(p));
  return photoCandidates({ cover, photos: gallery }).slice(0, MAX_PHOTOS);
}

/** One menu row per bookable line: services with variants first (the richer read), falling back to plain options. */
function menuRows(item: Item): { name: string; detail: string; price: number | null }[] {
  const services = (item as { services?: { name: string; variants: { label: string; price: number | null }[] }[] }).services || [];
  if (services.length) {
    const rows: { name: string; detail: string; price: number | null }[] = [];
    for (const s of services) {
      for (const v of s.variants) {
        rows.push({ name: s.name, detail: v.label && v.label !== "Standard" ? v.label : "", price: v.price });
        if (rows.length >= MAX_MENU_ROWS) return rows;
      }
    }
    return rows;
  }
  const options = (item as { options?: { name: string; detail?: string; price: number | null }[] }).options || [];
  return options.slice(0, MAX_MENU_ROWS).map((o) => ({ name: o.name, detail: o.detail || "", price: o.price }));
}

function jsonLd(item: Item, canonical: string, photos: string[], menu: { name: string; detail: string; price: number | null }[]): Record<string, unknown> {
  const contact = (item as { contact?: Contact }).contact;
  const region = contact?.region || regionOfArea(String(item.area || ""));
  const address =
    contact?.street || contact?.city || region
      ? {
          "@type": "PostalAddress",
          ...(contact?.street ? { streetAddress: contact.street } : {}),
          ...(contact?.city ? { addressLocality: contact.city } : {}),
          ...(region ? { addressRegion: region } : {}),
          ...(contact?.postal ? { postalCode: contact.postal } : {}),
          addressCountry: countryOfArea(String(item.area || "")),
        }
      : undefined;
  // A partner's product is filed at the centre of the destination its API named, one coordinate for every
  // product in that city, so publishing it as this listing's own geo states a location nobody checked.
  const partner = !!(item as { affiliate?: unknown }).affiliate;
  const lat = !partner && typeof item.lat === "number" ? item.lat : undefined;
  const lon = !partner && typeof item.lon === "number" ? item.lon : undefined;
  const priced = menu.filter((m) => m.price != null);
  const currency = countryOfArea(String(item.area || "")) === "CA" ? "CAD" : "USD";
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": schemaType(item),
    name: item.title,
    url: canonical,
    ...(photos.length ? { image: photos } : {}),
    ...(address ? { address } : {}),
    ...(lat != null && lon != null ? { geo: { "@type": "GeoCoordinates", latitude: lat, longitude: lon } } : {}),
    ...(contact?.phone ? { telephone: contact.phone } : {}),
  };
  if (typeof item.rating === "number" && typeof item.reviews === "number" && item.reviews > 0) {
    ld.aggregateRating = { "@type": "AggregateRating", ratingValue: item.rating, reviewCount: item.reviews };
  }
  if (priced.length) {
    ld.offers = priced.slice(0, 10).map((m) => ({
      "@type": "Offer",
      name: m.detail ? `${m.name} (${m.detail})` : m.name,
      price: (m.price as number).toFixed(2),
      priceCurrency: currency,
      availability: "https://schema.org/InStock",
    }));
  }
  return ld;
}

const CSS =
  `:root{color-scheme:light}body{margin:0;font-family:Inter,"Helvetica Neue",Arial,sans-serif;color:#222;background:#fff}` +
  `a{color:inherit}.wrap{max-width:760px;margin:0 auto;padding:0 24px}` +
  `header{border-bottom:1px solid #ebebeb}.top{display:flex;justify-content:space-between;align-items:center;height:60px}` +
  `.logo{font-weight:700;font-size:19px;color:#495940;text-decoration:none}` +
  `.crumbs{margin:20px 0 0;font-size:13px;color:#717171}.crumbs a{text-decoration:none}.crumbs span{margin:0 6px}` +
  `h1{font-size:28px;letter-spacing:-.02em;margin:10px 0 4px}.area{color:#555;font-size:15px;margin:0 0 6px}` +
  `.rating{font-size:14px;color:#444;margin:0 0 16px}.blurb{font-size:16px;line-height:1.5;margin:0 0 22px;max-width:64ch}` +
  `.cta{display:inline-block;background:#495940;color:#fff;text-decoration:none;border-radius:999px;padding:12px 20px;font-weight:600;font-size:15px;margin:0 0 28px}` +
  `.photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin:0 0 26px}` +
  `.photos img{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:10px;display:block;background:#f3f3f3}` +
  `h2{font-size:19px;margin:30px 0 8px}` +
  `.menu{margin:0;padding:0;list-style:none;font-size:14.5px}.menu li{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid #f0f0f0}.menu small{display:block;color:#717171}` +
  `ul.plain{margin:0;padding:0 0 0 18px;font-size:14.5px;line-height:1.6;color:#333}` +
  `.faq h3{font-size:15.5px;margin:16px 0 4px}.faq p{margin:0;color:#444;line-height:1.5;font-size:14.5px}` +
  `.links{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}.links a{border:1px solid #ddd;border-radius:999px;padding:7px 12px;font-size:13px;text-decoration:none;color:#222}` +
  `footer{border-top:1px solid #ebebeb;padding:20px 0 40px;color:#717171;font-size:13px;margin-top:24px}footer p{margin:0 0 6px}footer .legal a{color:inherit}`;

function page(item: Item, opts: { landingHref: string | null; kindPageHref: string | null }): string {
  const site = publicSite();
  const canonical = `${site}l/${item.id}.html`;
  const hashUrl = `${site}#o=${esc(item.id)}`;
  // Through the same two steps both app surfaces read a blurb through, not the raw stored prose. Read raw, 977
  // of these pages printed a description the app prints differently for the same shop: the shop's own jargon
  // left short ("USCG licensed captain", "Venue is BYOB", "twin 550 HP engines"), the space the crawl left in
  // front of a comma or a full stop, and the button label swept up with the last sentence.
  const blurb = typeof item.blurb === "string" && item.blurb ? cleanDesc(item.blurb).replace(/\s+(Book|Learn more|Read more|Reserve)\.?$/i, "") : "";
  const area = String(item.area || "");
  const photos = photosOf(item);
  const menu = menuRows(item);
  const contact = (item as { contact?: Contact }).contact;
  // Through the same rule the app's listing reads, not the raw published lines. Read raw, 893 of these pages
  // printed an hour line the app prints differently, 41 of them in OpenStreetMap's own syntax ("Su off; Mo
  // \"by appointment\"; Tu-Fr 09:00-16:30"), and the rest with the quote marks, the zero width spaces, the
  // headings and the days glued onto the time before them that `displayHours` exists to take off.
  const hours = displayHours(((item as { hoursText?: string[] }).hoursText?.length ? (item as { hoursText?: string[] }).hoursText : contact?.hours) || []);
  // Through the badge rule every guest surface reads, not off the stored `fc`. Read raw, 171 of these pages
  // named a different window than the app did for the same shop, and one advertised free cancellation the app
  // strips because the shop only refunds a day it calls off itself.
  const cancellation = freeCancelBadge(item as { fc?: string; cancellation?: string; policies?: string[] }) || (item as { cancellation?: string }).cancellation || "";
  // Through the same rule the app's listing reads, not the raw published lines. Read raw, 5,263 of these pages
  // printed the shop's own "not included" lines under the heading "What's included": "Gratuities", "Lunch",
  // "Hotel pickup and drop-off" and "Alcoholic drinks" were all offered to a guest as things the price covers.
  const included = splitIncluded((item as { includes?: string[] }).includes || []);
  const includes = included.yes.slice(0, MAX_LIST_ITEMS);
  const notIncluded = included.no.slice(0, MAX_LIST_ITEMS);
  // Through the same split both app surfaces read, not the raw `specs`. Read raw, 2,369 of these pages headed
  // a shop's own selling lines "Requirements": "Beautiful gardens with bicycles hidden throughout the
  // property", "Award-winning beers such as Treachery and Soleil", "Located in downtown Anoka, MN". The app has
  // never done that, because `listingFacts` sorts a spec line by what it says: a rule about the guest goes
  // under "Who can go" and everything else leads the listing as a highlight. This page printed the first six
  // of the list whatever they were, and had no highlights section at all to put the rest in, so the 6,456
  // listings that publish their own highlights showed none of them here either.
  const facts = listingFacts(unclaimedShape(item));
  const stated = (item as { requirements?: string[] }).requirements || [];
  const requirements = (stated.length ? stated : facts.who.filter((l) => l.posted).map((l) => l.text)).slice(0, MAX_LIST_ITEMS);
  // The same guard the app uses: a line already printed as a rule is not repeated as a selling point.
  const reqKeys = new Set(requirements.map(factKey));
  const published = (item as { highlights?: string[] }).highlights || [];
  const highlights = (published.length ? published : facts.about)
    .filter((h) => !reqKeys.has(factKey(h)))
    .slice(0, MAX_LIST_ITEMS)
    .map(tidyLine);
  // Through the same rule both app surfaces read a question and its answer through. Read raw, 9 of the 72
  // shipped entries printed differently here: a question still shouting ("HOW MUCH TIME WILL I HAVE?"), the
  // Q&A page's own "A." label in front of the answer, and the bullet or dash the crawl swept up with it.
  const faq = ((item as { faq?: { q: string; a: string }[] }).faq || [])
    .slice(0, MAX_FAQ)
    .map((f) => ({ q: tidyLine(String(f.q || "")), a: tidyLine(String(f.a || "")) }));
  // The same rule the app's cards and sheets read, so the page a search engine lands on and the page the
  // app draws never state one shop's length two ways.
  const durRaw = (item as { dur?: string }).dur || "";
  const dur = durRaw ? sayLength(durRaw) : "";
  const rating = typeof item.rating === "number" ? item.rating : null;
  const reviews = typeof item.reviews === "number" ? item.reviews : null;
  const kind = KINDS.find((k) => k.art === item.art);
  const title = `${item.title}${area ? " in " + area : ""} · Outset`;
  const description = clip(blurb || `${item.title}, ${area || "a real local business"} on Outset.`, 300);
  const ld = jsonLd(item, canonical, photos, menu);
  // The partner licence (Viator's reads "you must not index any Viator unique content") means this page exists
  // for the app and for a shared link, never for a search engine: noindex here, and writeListingPages keeps it
  // out of the sitemap. The photos, title and description on it are the partner's.
  const partner = !!(item as { affiliate?: unknown }).affiliate;

  const photosHtml = photos.length
    ? `<div class="photos">${photos.map((p) => `<img src="${esc(cardPhoto(p, 480))}" alt="${esc(item.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`).join("")}</div>`
    : "";
  const menuHtml = menu.length
    ? `<h2>Menu</h2><ul class="menu">${menu
        .map((m) => `<li><span>${esc(m.name)}${m.detail ? `<small>${esc(m.detail)}</small>` : ""}</span><span>${m.price != null ? esc(money(m.price)) : "Price on request"}</span></li>`)
        .join("")}</ul>`
    : "";
  const factLine = [dur ? `<b>Duration:</b> ${esc(dur)}` : "", cancellation ? `<b>Cancellation:</b> ${esc(cancellation)}` : ""].filter(Boolean).join(" &nbsp; ");
  const factsHtml = factLine ? `<p class="blurb">${factLine}</p>` : "";
  const hoursHtml = hours.length ? `<h2>Hours</h2><ul class="plain">${hours.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>` : "";
  const includesHtml =
    (includes.length ? `<h2>What's included</h2><ul class="plain">${includes.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : "") +
    (notIncluded.length ? `<h2>Not included</h2><ul class="plain">${notIncluded.map((n) => `<li>${esc(n.text)}</li>`).join("")}</ul>` : "");
  const requirementsHtml = requirements.length ? `<h2>Requirements</h2><ul class="plain">${requirements.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : "";
  const highlightsHtml = highlights.length ? `<h2>Highlights</h2><ul class="plain">${highlights.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : "";
  const faqHtml = faq.length ? `<h2>Questions</h2><div class="faq">${faq.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join("")}</div>` : "";
  const ratingHtml = rating != null ? `<p class="rating">★ ${rating.toFixed(1)}${reviews ? ` (${reviews.toLocaleString("en-US")} reviews)` : ""}</p>` : "";
  const links = [
    `<a href="${hashUrl}">Open on Outset</a>`,
    opts.landingHref ? `<a href="${opts.landingHref}">${esc(kind ? kind.search : "More like this")}${area ? " near " + esc(area.split(",")[0]) : ""}</a>` : "",
    `<a href="${site}p/index.html">Browse every activity by city</a>`,
  ]
    .filter(Boolean)
    .join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${partner ? '<meta name="robots" content="noindex">\n' : ""}<link rel="canonical" href="${canonical}">
${socialCard({ title, description, url: canonical, photo: photos[0] })}
<script type="application/ld+json">${ldJson(ld)}</script>
<style>${CSS}</style></head><body>
<header><div class="wrap top"><a class="logo" href="${site}">Outset</a></div></header>
<main class="wrap">
<nav class="crumbs"><a href="${site}">Outset</a><span>›</span><a href="${site}p/index.html">By activity and city</a>${kind && opts.kindPageHref ? `<span>›</span><a href="${opts.kindPageHref}">${esc(kind.search)}</a>` : ""}</nav>
<h1>${esc(item.title)}</h1>
${area ? `<p class="area">${esc(area)}</p>` : ""}
${ratingHtml}
${blurb ? `<p class="blurb">${esc(blurb)}</p>` : ""}
${factsHtml}
${(() => {
    // A partner's product books on the partner's site, on our attributed link, and the page says so: the FTC's
    // endorsement guides ask for the disclosure, and rel="sponsored" is what search engines ask of paid links.
    const aff = (item as { affiliate?: { label: string; url: string } }).affiliate;
    return aff
      ? `<a class="cta" href="${esc(aff.url)}" rel="sponsored noopener noreferrer">Book on ${esc(aff.label)}</a><p class="blurb">Dates, prices and payment are on ${esc(aff.label)}. Outset earns a commission if you book there, at no extra cost to you.</p>`
      : `<a class="cta" href="${hashUrl}">Request a time on Outset</a>`;
  })()}
${photosHtml}
${highlightsHtml}
${menuHtml}
${hoursHtml}
${includesHtml}
${requirementsHtml}
${faqHtml}
<div class="links">${links}</div>
</main>
${pageFooter()}
</body></html>`;
}

export type ListingPagesResult = { pages: number; totalBytes: number; avgBytes: number; urls: string[] };

/**
 * `landingPages` is the `existingPages` set writeLandingPages (pages.ts) returned for this same run: the only
 * reliable way to know whether "<art> in <metro>" actually got a page, since a metro under MIN_METRO_LISTINGS or
 * an all-guessed kind gets none. Call writeLandingPages first and pass its result straight through.
 */
export function writeListingPages(rawItems: Item[], landingPages: { existingPages: Set<string> }, opts: { publicDir?: string } = {}): ListingPagesResult {
  // Same menu the app shows and the city pages quote: see bookablePages in pages.ts.
  const items = bookablePages(rawItems);
  const publicDir = opts.publicDir || defaultPublicDir;
  const dir = join(publicDir, "l");
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (f.endsWith(".html")) unlinkSync(join(dir, f));

  // One rule for a page to exist, shared with the city pages that link here: see hasListingPage in pages.ts.
  const eligible = items.filter(hasListingPage);

  const urls: string[] = [];
  let totalBytes = 0;
  for (const item of eligible) {
    const kindUnconfirmed = !!(item as { kindUnconfirmed?: boolean }).kindUnconfirmed;
    let landingHref: string | null = null;
    let kindPageHref: string | null = null;
    if (!kindUnconfirmed && item.art) {
      if (landingPages.existingPages.has(String(item.art))) kindPageHref = `${publicSite()}p/${fileFor(String(item.art), null)}`;
      const metroKey = item.metroId ? `${item.art}|${item.metroId}` : null;
      landingHref = metroKey && landingPages.existingPages.has(metroKey) ? `${publicSite()}p/${fileFor(String(item.art), item.metroId as string)}` : kindPageHref;
    }
    const html = page(item, { landingHref, kindPageHref });
    const file = `${item.id}.html`;
    writeFileSync(join(dir, file), html);
    // A partner page is noindex (see page()), so it is not offered to search engines here either.
    if (!(item as { affiliate?: unknown }).affiliate) urls.push(`${publicSite()}l/${file}`);
    totalBytes += Buffer.byteLength(html, "utf8");
  }

  const sitemapFiles: string[] = [];
  for (let i = 0; i < urls.length; i += SITEMAP_CHUNK) {
    const chunk = urls.slice(i, i + SITEMAP_CHUNK);
    const n = sitemapFiles.length + 1;
    const name = `sitemap-listings-${n}.xml`;
    writeFileSync(
      join(publicDir, name),
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${chunk.map((u) => `<url><loc>${u}</loc></url>`).join("")}</urlset>`,
    );
    sitemapFiles.push(name);
  }
  // Clear a stale chunk left behind by a run that produced more listing pages than this one did.
  for (const f of readdirSync(publicDir)) {
    if (/^sitemap-listings-\d+\.xml$/.test(f) && !sitemapFiles.includes(f)) unlinkSync(join(publicDir, f));
  }

  // The sitemap index: at most 50,000 URLs per file means the pages sitemap and the listing sitemaps cannot be
  // one file once the listing pages exist at all, so this is the one robots.txt points at (pages.ts still writes
  // that line unchanged) and the pages and listing sitemaps are its children.
  writeFileSync(
    join(publicDir, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${["sitemap-pages.xml", ...sitemapFiles]
      .map((f) => `<sitemap><loc>${publicSite()}${f}</loc></sitemap>`)
      .join("")}</sitemapindex>`,
  );

  return { pages: urls.length, totalBytes, avgBytes: urls.length ? Math.round(totalBytes / urls.length) : 0, urls };
}
