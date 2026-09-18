import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { METROS } from "../taxonomy/catalog.ts";
import { GUIDES } from "../../../src/data/guides.ts";
import { REGION_NAME, regionOfArea } from "../../../src/data/regions.ts";

/**
 * Programmatic landing pages: one static page per activity and metro, "Escape rooms in Toronto, Ontario".
 * Real operators, real prices and photos, an FAQ made only of facts the listings hold, and links into the app.
 * These exist for search engines and shared links; the app itself stays the product.
 *
 * Rules:
 * - A listing reaches a page only if browse would show it and its kind is confirmed. A page is a browse surface
 *   with a Google result in front of it, so the catalog's own `thin` flag applies here exactly as it does to the
 *   rails, a guessed kind is not published as a fact, and the count in the h1, the lede, the FAQ, the pills and
 *   the JSON-LD counts what a guest can actually see.
 * - A metro page exists when the kind has at least MIN_METRO_LISTINGS listings in that metro. The all-metros page
 *   ("-in-anywhere") exists for every kind with a listing anywhere, metro or not. Nothing is published empty; the
 *   directory is cleared first so a page whose kind lost its listings disappears.
 * - The title and h1 use the phrasing people type into Google (`search`), which is one of the kind's aliases in
 *   src/data/synonyms.ts, plus the city and its state or province in full.
 * - Every page lands in sitemap.xml, and every internal link points at a page that was written in the same run.
 */

const here = dirname(fileURLToPath(import.meta.url));
const defaultPublicDir = join(here, "../../../public");
/**
 * The public home of these pages: what a canonical tag, a sitemap entry and every card link has to point at.
 *
 * SITE_URL is the address mail links use, and backend/AGENTS.md tells anyone testing claim mail from a laptop
 * to set it to `http://localhost:5173/`. Reading it straight meant one `npm run sync` on that laptop wrote
 * `<link rel="canonical" href="http://localhost:5173/...">` into every landing page, a sitemap of localhost
 * URLs and a robots.txt pointing at it, all of them committed files. A local address is ignored here.
 * PUBLIC_SITE_URL is the way to say the published site really does live somewhere else.
 */
const PUBLIC_SITE = "https://onoutset.com/";
const LOCAL_ADDRESS = /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/|$)/i;
export function publicSite(): string {
  const set = (process.env.PUBLIC_SITE_URL || process.env.SITE_URL || "").trim();
  if (!set || LOCAL_ADDRESS.test(set)) return PUBLIC_SITE;
  return set.endsWith("/") ? set : set + "/";
}

export const MIN_METRO_LISTINGS = 3;
const MAX_CARDS = 24;
const MAX_NEARBY = 12;

export type Kind = {
  art: string;
  /** How guests type it into Google, capitalised for a title: "Cooking classes", "Escape rooms". An alias in synonyms.ts. */
  search: string;
  /** Noun for counts: "18 escape rooms", "6 cooking classes". */
  plural: string;
  family: string;
};

export const KINDS: Kind[] = [
  { art: "jetski", search: "Jet ski rentals", plural: "jet ski rentals", family: "water" },
  { art: "kayak", search: "Kayak rentals", plural: "kayak rentals", family: "water" },
  { art: "paddleboard", search: "Paddleboard rentals", plural: "paddleboard rentals", family: "water" },
  { art: "fishing", search: "Fishing charters", plural: "fishing charters", family: "water" },
  { art: "cruise", search: "Boat tours", plural: "boat tours and cruises", family: "water" },
  { art: "pontoon", search: "Boat rentals", plural: "boat rentals", family: "water" },
  { art: "parasail", search: "Parasailing", plural: "parasailing operators", family: "air" },
  { art: "skydive", search: "Skydiving", plural: "skydiving centers", family: "air" },
  { art: "heli", search: "Helicopter tours", plural: "helicopter tours", family: "air" },
  { art: "balloon", search: "Hot air balloon rides", plural: "balloon rides", family: "air" },
  { art: "kart", search: "Go karting", plural: "go kart tracks", family: "motorsport" },
  { art: "escape", search: "Escape rooms", plural: "escape rooms", family: "indoor" },
  { art: "axe", search: "Axe throwing", plural: "axe throwing venues", family: "indoor" },
  { art: "paintball", search: "Paintball", plural: "paintball fields", family: "outdoor" },
  { art: "horse", search: "Horseback riding", plural: "horseback riding stables", family: "outdoor" },
  { art: "bowling", search: "Bowling alleys", plural: "bowling alleys", family: "play" },
  { art: "minigolf", search: "Mini golf", plural: "mini golf courses", family: "play" },
  { art: "arcade", search: "Arcades", plural: "arcades", family: "play" },
  { art: "trampoline", search: "Trampoline parks", plural: "trampoline parks", family: "play" },
  { art: "lasertag", search: "Laser tag", plural: "laser tag arenas", family: "play" },
  { art: "icerink", search: "Ice skating rinks", plural: "ice rinks", family: "play" },
  { art: "waterpark", search: "Water parks", plural: "water parks", family: "play" },
  { art: "themepark", search: "Theme parks", plural: "theme parks", family: "play" },
  { art: "zoo", search: "Zoos", plural: "zoos", family: "play" },
  { art: "aquarium", search: "Aquariums", plural: "aquariums", family: "play" },
  { art: "karaoke", search: "Karaoke bars", plural: "karaoke bars and rooms", family: "play" },
  { art: "climbing", search: "Climbing gyms", plural: "climbing gyms", family: "indoor" },
  { art: "range", search: "Shooting ranges", plural: "shooting ranges", family: "outdoor" },
  { art: "archery", search: "Archery ranges", plural: "archery ranges", family: "outdoor" },
  { art: "golf", search: "Golf courses", plural: "golf courses", family: "outdoor" },
  { art: "zipline", search: "Ziplines", plural: "ziplines", family: "outdoor" },
  { art: "ski", search: "Ski resorts", plural: "ski areas", family: "outdoor" },
  { art: "bike", search: "Bike rentals", plural: "bike rentals", family: "outdoor" },
  { art: "snowmobile", search: "Snowmobile tours", plural: "snowmobile tours", family: "outdoor" },
  { art: "rafting", search: "Whitewater rafting", plural: "rafting trips", family: "water" },
  { art: "scuba", search: "Scuba diving", plural: "dive shops", family: "water" },
  { art: "surf", search: "Surf lessons", plural: "surf schools", family: "water" },
  { art: "paragliding", search: "Paragliding", plural: "paragliding operators", family: "air" },
  { art: "gliding", search: "Glider rides", plural: "glider rides", family: "air" },
  { art: "brewery", search: "Breweries", plural: "breweries", family: "food" },
  { art: "winery", search: "Wineries", plural: "wineries", family: "food" },
  { art: "distillery", search: "Distilleries", plural: "distilleries", family: "food" },
  { art: "cooking", search: "Cooking classes", plural: "cooking classes", family: "food" },
  { art: "spa", search: "Spas", plural: "spas", family: "wellness" },
  { art: "yoga", search: "Yoga classes", plural: "yoga studios", family: "wellness" },
  { art: "dance", search: "Dance classes", plural: "dance studios", family: "wellness" },
  { art: "pottery", search: "Pottery classes", plural: "pottery and art studios", family: "wellness" },
  { art: "tour", search: "Guided tours", plural: "guided tours", family: "outdoor" },
  { art: "rage", search: "Rage rooms", plural: "rage rooms", family: "indoor" },
  { art: "theatre", search: "Live theatre", plural: "theatres and shows", family: "play" },
  { art: "museum", search: "Museums", plural: "museums and galleries", family: "play" },
  { art: "garden", search: "Botanical gardens", plural: "gardens and farms", family: "outdoor" },
  { art: "camping", search: "Campgrounds", plural: "campgrounds", family: "outdoor" },
  { art: "tennis", search: "Tennis courts", plural: "tennis and pickleball courts", family: "outdoor" },
  { art: "swim", search: "Swimming pools", plural: "pools and swim schools", family: "water" },
  { art: "martialarts", search: "Martial arts classes", plural: "martial arts gyms", family: "wellness" },
  { art: "gymnastics", search: "Gymnastics classes", plural: "gymnastics gyms", family: "play" },
  { art: "fitness", search: "Fitness classes", plural: "fitness studios", family: "wellness" },
  { art: "venue", search: "Event venues", plural: "party and event venues", family: "play" },
  { art: "sailing", search: "Sailing charters", plural: "sailing schools and charters", family: "water" },
  { art: "discgolf", search: "Disc golf courses", plural: "disc golf courses", family: "outdoor" },
  { art: "billiards", search: "Pool halls", plural: "pool halls and bar games", family: "play" },
  { art: "motorsport", search: "ATV tours", plural: "motorsport and off-road operators", family: "motorsport" },
  { art: "sauna", search: "Saunas", plural: "saunas and bathhouses", family: "wellness" },
];

export type Item = Record<string, unknown> & {
  id: string;
  title: string;
  art: string;
  area: string;
  metroId?: string | null;
  rating?: number | null;
  reviews?: number | null;
  cover?: string | null;
  /** The browse catalog carries the lowest published price as `from`; the full item carries it inside `options`. */
  from?: number | null;
  dur?: string | null;
  options?: { name: string; detail?: string; price: number | null; per?: string }[];
  services?: { name: string; desc: string | null; variants: { label: string; price: number | null }[] }[];
  hrs?: unknown[] | null;
  hoursText?: string[] | null;
  /**
   * Set in sync/contacts.ts when nothing in the listing's own text confirms its kind: the kind is a guess off
   * the business name. The rails already put these behind every confirmed listing.
   */
  kindUnconfirmed?: boolean;
  /**
   * The catalog's own "nothing a guest can act on" flag, set in sync/contacts.ts: no photo, no price, no hours,
   * no services, no tags, no description. Browse and the rails leave these out rather than filling a grid with
   * identical placeholders, and a landing page is the same grid with a search engine pointed at it.
   */
  thin?: boolean;
};

type Metro = (typeof METROS)[number];

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (n: number) => (Number.isInteger(n) ? "$" + n.toLocaleString("en-US") : "$" + n.toFixed(2));
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1]);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** The lowest price the operator publishes, from whichever shape the item arrived in. */
export function priceOf(i: Item): number | null {
  const prices = [
    ...(i.options || []).map((o) => o.price),
    ...(i.services || []).flatMap((s) => s.variants.map((v) => v.price)),
    i.from,
  ].filter((n): n is number => typeof n === "number" && n > 0);
  return prices.length ? Math.min(...prices) : null;
}

const hasHours = (i: Item) => (Array.isArray(i.hrs) && i.hrs.some((h) => h != null)) || !!(i.hoursText && i.hoursText.length);

/** "Toronto, Ontario", "Tampa Bay, Florida", and "Washington DC" when the name already says where it is. */
export function placeName(metro: Metro): string {
  const region = REGION_NAME[metro.region] || metro.region;
  return metro.name.includes(metro.region) || metro.name.includes(region.split(",")[0]) ? metro.name : `${metro.name}, ${region}`;
}

export const pageTitle = (kind: Kind, metro: Metro | null) => `${kind.search} in ${metro ? placeName(metro) : "the US and Canada"}`;
const fileFor = (art: string, metroId: string | null) => `${art}-in-${metroId || "anywhere"}.html`;

function kmBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const d = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * d) / 2) ** 2 + Math.cos(a.lat * d) * Math.cos(b.lat * d) * Math.sin(((b.lon - a.lon) * d) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Photo and price first, then the most reviewed. What a guest can act on leads the page. */
const rank = (a: Item, b: Item) => {
  const s = (i: Item) => (i.cover ? 2 : 0) + (priceOf(i) != null ? 1 : 0);
  return s(b) - s(a) || (Number(b.reviews) || 0) - (Number(a.reviews) || 0) || String(a.title).localeCompare(String(b.title));
};

const CSS = `
:root{color-scheme:light}body{margin:0;font-family:Inter,"Helvetica Neue",Arial,sans-serif;color:#222;background:#fff}
a{color:inherit}.wrap{max-width:1180px;margin:0 auto;padding:0 24px}
header{border-bottom:1px solid #ebebeb}.top{display:flex;justify-content:space-between;align-items:center;height:64px}
.logo{font-weight:700;font-size:20px;color:#495940;text-decoration:none}.cta{background:#495940;color:#fff;text-decoration:none;border-radius:999px;padding:10px 16px;font-weight:600;font-size:14px}
.crumbs{margin:22px 0 0;font-size:13px;color:#717171}.crumbs a{text-decoration:none}.crumbs span{margin:0 6px}
h1{font-size:34px;letter-spacing:-.02em;margin:10px 0 8px}.lede{font-size:17px;color:#555;margin:0 0 24px;max-width:70ch}
h2{font-size:20px;margin:36px 0 10px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:22px 16px}
.card{text-decoration:none;display:block}.art{aspect-ratio:1/1;border-radius:16px;overflow:hidden;background:#f3f3f3}.art img{width:100%;height:100%;object-fit:cover;display:block}
.card > b{display:block;margin-top:8px;font-size:15px}.meta b{font-weight:700}.card small{display:block;color:#717171;font-size:13px}.meta{display:flex;justify-content:space-between;font-size:13px;margin-top:4px}
.menu{margin:4px 0 0;padding:0;list-style:none;font-size:12.5px;color:#555}.menu li{display:flex;justify-content:space-between;gap:8px}
.guide{margin:44px 0;padding:24px;border:1px solid #ebebeb;border-radius:18px;background:#fafafa}.guide h2{margin:0 0 6px;font-size:20px}.guide ol{margin:10px 0 0 18px;padding:0;color:#444;line-height:1.5}
.faq{margin:10px 0 24px}.faq h3{font-size:16px;margin:16px 0 4px}.faq p{margin:0;color:#444;line-height:1.5}
.links{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 24px}.links a{border:1px solid #ddd;border-radius:999px;padding:7px 12px;font-size:13px;text-decoration:none;color:#222}.links a small{color:#717171;margin-left:4px}
footer{border-top:1px solid #ebebeb;padding:20px 0 40px;color:#717171;font-size:13px;margin-top:24px}
`;

type Faq = { q: string; a: string };

/** Questions answered only from what the listings hold. A question with no fact behind it is left out. */
export function buildFaq(kind: Kind, metro: Metro | null, items: Item[]): Faq[] {
  const city = metro ? metro.name : "the US and Canada";
  const n = items.length;
  const plural = kind.plural;
  const faq: Faq[] = [];

  const areaCount = new Map<string, number>();
  for (const i of items) {
    const town = String(i.area || "").replace(/,\s*[A-Z]{2}$/, "").trim();
    // An operator whose town was never scraped has only its state as an area ("FL"), which is not a town and
    // must not be listed as one: "including places in FL, Tampa and Clearwater".
    if (town && !regionOfArea(town)) areaCount.set(town, (areaCount.get(town) || 0) + 1);
  }
  const towns = [...areaCount.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 4);
  const withPhotos = items.filter((i) => i.cover).length;
  faq.push({
    q: `How many ${plural} are there in ${city}?`,
    a:
      `Outset lists ${n} ${n === 1 ? plural.replace(/s$/, "") : plural} ${metro ? "around " + metro.name : "across the US and Canada"}` +
      (metro && towns.length > 1 ? `, including places in ${list(towns)}` : "") +
      `. ${withPhotos ? `${withPhotos} of them have photos.` : "Photos are added as each operator's site is read."}`,
  });

  const priced = items.map(priceOf).filter((p): p is number => p != null);
  if (priced.length) {
    const min = Math.min(...priced);
    const max = Math.max(...priced);
    faq.push({
      q: `How much do ${plural} cost in ${city}?`,
      a:
        `${priced.length} of the ${n} operators publish prices on their own site. ` +
        (min === max ? `Their starting price is ${money(min)}.` : `Starting prices run from ${money(min)} to ${money(max)}.`) +
        ` The full menu is on each listing.`,
    });
  }

  const durCount = new Map<string, number>();
  for (const i of items) if (i.dur) durCount.set(String(i.dur), (durCount.get(String(i.dur)) || 0) + 1);
  const durs = [...durCount.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d).slice(0, 3);
  if (durs.length) {
    faq.push({
      q: `How long do ${plural} in ${city} take?`,
      a: `${durCount.size === 1 ? "The listed duration is" : "Listed durations include"} ${list(durs)}, as stated on ${durs.length === 1 ? "the operator's" : "the operators'"} own sites.`,
    });
  }

  const reviewed = items.filter((i) => Number(i.reviews) > 0).sort((a, b) => Number(b.reviews) - Number(a.reviews)).slice(0, 3);
  if (reviewed.length) {
    faq.push({
      q: `Which ${plural} in ${city} have the most reviews?`,
      a:
        list(reviewed.map((i) => `${i.title} (${i.rating ? Number(i.rating).toFixed(1) + " stars, " : ""}${Number(i.reviews).toLocaleString("en-US")} reviews)`)) +
        ". Review counts are from public listings.",
    });
  }

  const hours = items.filter(hasHours).length;
  if (hours) {
    faq.push({
      q: `Do the listings show opening hours?`,
      a: `${hours} of the ${n} show hours copied from the operator's website. The rest do not publish them on Outset yet.`,
    });
  }

  faq.push({
    q: "Where does this information come from?",
    a: "From each operator's own website and public listings, one source per fact. Operators can claim their page on Outset and correct anything.",
  });
  return faq;
}

type Neighbour = { file: string; label: string; count: number };

function page(kind: Kind, metro: Metro | null, items: Item[], nearby: Neighbour[], otherKinds: Neighbour[]): string {
  const title = pageTitle(kind, metro);
  const canonical = `${publicSite()}p/${fileFor(kind.art, metro ? metro.id : null)}`;
  const guide = GUIDES[kind.art as keyof typeof GUIDES];
  const priced = items.map(priceOf).filter((p): p is number => p != null);
  const minPrice = priced.length ? Math.min(...priced) : null;
  const withPhotos = items.filter((i) => i.cover).length;
  const faq = buildFaq(kind, metro, items);
  const cards = items
    .slice(0, MAX_CARDS)
    .map((i) => {
      const from = priceOf(i);
      const menu = (i.services || [])
        .slice(0, 3)
        .map((s) => {
          const v = s.variants.find((x) => x.price != null);
          return `<li><span>${esc(s.name)}</span><span>${v && v.price != null ? esc(money(v.price)) : ""}</span></li>`;
        })
        .join("");
      return `<a class="card" href="${publicSite()}#o=${esc(i.id)}">
  <div class="art">${i.cover ? `<img src="${esc(i.cover)}" alt="${esc(i.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}</div>
  <b>${esc(i.title)}</b><small>${esc(i.area)}</small>
  <div class="meta"><span>${from != null ? "From <b>" + esc(money(from)) + "</b>" : "Price on request"}</span>${i.rating ? `<span>★ ${Number(i.rating).toFixed(1)}${i.reviews ? " (" + Number(i.reviews).toLocaleString("en-US") + ")" : ""}</span>` : ""}</div>
  ${menu ? `<ul class="menu">${menu}</ul>` : ""}
</a>`;
    })
    .join("\n");
  const pill = (n: Neighbour) => `<a href="${n.file}">${esc(n.label)}<small>${n.count}</small></a>`;
  const ld = [
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: title,
      numberOfItems: items.length,
      itemListElement: items.slice(0, MAX_CARDS).map((i, n) => ({ "@type": "ListItem", position: n + 1, name: i.title, url: `${publicSite()}#o=${i.id}` })),
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    },
  ];
  const description =
    `${items.length} ${kind.plural} ${metro ? "around " + placeName(metro) : "across the US and Canada"} on Outset` +
    (minPrice != null ? `, from ${money(minPrice)}` : "") +
    `. ${withPhotos ? "Photos, menus and prices" : "Menus and prices"} from each operator's own website. Pick a listing and request a time.`;
  const lede =
    `${items.length} ${esc(kind.plural)} ${metro ? "around " + esc(metro.name) : "across the US and Canada"}` +
    (priced.length ? `, ${priced.length} with prices from the operator's own site${minPrice != null ? " (from " + esc(money(minPrice)) + ")" : ""}` : "") +
    `. Open a listing to see its menu, then request a time. No phone tag.`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Outset</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<style>${CSS}</style></head><body>
<header><div class="wrap top"><a class="logo" href="${publicSite()}">Outset</a><a class="cta" href="${publicSite()}">Open Outset</a></div></header>
<main class="wrap">
<nav class="crumbs"><a href="${publicSite()}">Outset</a><span>›</span><a href="index.html">By activity and city</a>${metro ? `<span>›</span><a href="${fileFor(kind.art, null)}">${esc(kind.search)}</a><span>›</span>${esc(metro.name)}` : `<span>›</span>${esc(kind.search)}`}</nav>
<h1>${esc(title)}</h1>
<p class="lede">${lede}</p>
<div class="grid">${cards}</div>
${guide ? `<section class="guide"><h2>What ${esc(lower(kind.search))} ${/s$/.test(kind.search) ? "are" : "is"} actually like</h2><p>${esc(guide.hook)}</p><ol>${guide.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol><p><b>Bring:</b> ${esc(guide.bring.join(", "))}. <b>Good for:</b> ${esc(guide.goodFor)}</p></section>` : ""}
<section class="faq"><h2>Questions</h2>${faq.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join("")}</section>
${nearby.length ? `<h2>${esc(kind.search)} ${metro ? "near " + esc(metro.name) : "by city"}</h2><div class="links">${nearby.map(pill).join("")}</div>` : ""}
${otherKinds.length ? `<h2>Other things to do${metro ? " in " + esc(metro.name) : ""}</h2><div class="links">${otherKinds.map(pill).join("")}</div>` : ""}
</main>
<footer><div class="wrap">Outset · Book the jump. Skip the call.</div></footer>
</body></html>`;
}

export type LandingPagesResult = { pages: number; metroPages: number; kindPages: number; urls: string[] };

export function writeLandingPages(items: Item[], opts: { publicDir?: string } = {}): LandingPagesResult {
  const publicDir = opts.publicDir || defaultPublicDir;
  const dir = join(publicDir, "p");
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (f.endsWith(".html")) unlinkSync(join(dir, f));

  // Group once: kind -> every listing, and kind -> metro -> listings. A listing browse would not show, and a
  // listing whose kind we only guessed, are dropped before anything is grouped, counted or used to decide a
  // page exists. A page states its kind as fact in the title, the count and the JSON-LD; a guess cannot go there.
  const listable = items.filter((i) => !i.thin && !i.kindUnconfirmed);

  const byKind = new Map<string, Item[]>();
  const byKindMetro = new Map<string, Map<string, Item[]>>();
  for (const i of listable) {
    if (!byKind.has(i.art)) byKind.set(i.art, []);
    byKind.get(i.art)!.push(i);
    if (!i.metroId) continue;
    if (!byKindMetro.has(i.art)) byKindMetro.set(i.art, new Map());
    const m = byKindMetro.get(i.art)!;
    if (!m.has(i.metroId)) m.set(i.metroId, []);
    m.get(i.metroId)!.push(i);
  }
  const metroById = new Map(METROS.map((m) => [m.id, m]));

  // Decide the page set first, so every link on every page points at a page this run writes.
  const kindPages = KINDS.filter((k) => (byKind.get(k.art) || []).length > 0);
  const metroPages = new Map<string, { kind: Kind; metro: Metro; items: Item[] }[]>(); // by metro id
  const metrosOfKind = new Map<string, { metro: Metro; items: Item[] }[]>();
  for (const kind of kindPages) {
    const list: { metro: Metro; items: Item[] }[] = [];
    for (const [metroId, local] of byKindMetro.get(kind.art) || []) {
      const metro = metroById.get(metroId);
      if (!metro || local.length < MIN_METRO_LISTINGS) continue;
      list.push({ metro, items: local.sort(rank) });
      if (!metroPages.has(metroId)) metroPages.set(metroId, []);
      metroPages.get(metroId)!.push({ kind, metro, items: local });
    }
    metrosOfKind.set(kind.art, list);
  }

  const urls: string[] = [];
  const write = (file: string, html: string) => {
    writeFileSync(join(dir, file), html);
    urls.push(`${publicSite()}p/${file}`);
  };
  let metroCount = 0;
  for (const kind of kindPages) {
    const all = (byKind.get(kind.art) || []).slice().sort(rank);
    const metros = metrosOfKind.get(kind.art) || [];
    const byCity = metros
      .slice()
      .sort((a, b) => b.items.length - a.items.length)
      .map((m) => ({ file: fileFor(kind.art, m.metro.id), label: placeName(m.metro), count: m.items.length }));
    const otherKindsAnywhere = kindPages
      .filter((k) => k.art !== kind.art)
      .map((k) => ({ file: fileFor(k.art, null), label: k.search, count: (byKind.get(k.art) || []).length }));
    write(fileFor(kind.art, null), page(kind, null, all, byCity, otherKindsAnywhere));
    for (const { metro, items: local } of metros) {
      const nearby = metros
        .filter((m) => m.metro.id !== metro.id)
        .sort((a, b) => kmBetween(metro, a.metro) - kmBetween(metro, b.metro))
        .slice(0, MAX_NEARBY)
        .map((m) => ({ file: fileFor(kind.art, m.metro.id), label: placeName(m.metro), count: m.items.length }));
      const otherKinds = (metroPages.get(metro.id) || [])
        .filter((p) => p.kind.art !== kind.art)
        .sort((a, b) => b.items.length - a.items.length)
        .map((p) => ({ file: fileFor(p.kind.art, metro.id), label: p.kind.search, count: p.items.length }));
      write(fileFor(kind.art, metro.id), page(kind, metro, local, nearby, otherKinds));
      metroCount += 1;
    }
  }

  // The index groups pages by city so a crawler reaches every page in two hops.
  const cities = [...metroPages.entries()]
    .map(([id, pages]) => ({ metro: metroById.get(id)!, pages: pages.sort((a, b) => b.items.length - a.items.length) }))
    .sort((a, b) => a.metro.name.localeCompare(b.metro.name));
  const index = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Things to do by activity and city · Outset</title>
<meta name="description" content="Every activity Outset lists, by city: ${kindPages.length} kinds of thing to do across ${cities.length} cities in the US and Canada.">
<link rel="canonical" href="${publicSite()}p/index.html"><style>${CSS}</style></head><body><header><div class="wrap top"><a class="logo" href="${publicSite()}">Outset</a><a class="cta" href="${publicSite()}">Open Outset</a></div></header><main class="wrap"><h1>Things to do by activity and city</h1>
<h2>Everywhere</h2><div class="links">${kindPages.map((k) => `<a href="${fileFor(k.art, null)}">${esc(k.search)}<small>${(byKind.get(k.art) || []).length}</small></a>`).join("")}</div>
${cities.map((c) => `<h2>${esc(placeName(c.metro))}</h2><div class="links">${c.pages.map((p) => `<a href="${fileFor(p.kind.art, c.metro.id)}">${esc(p.kind.search)}<small>${p.items.length}</small></a>`).join("")}</div>`).join("\n")}
</main><footer><div class="wrap">Outset · Book the jump. Skip the call.</div></footer></body></html>`;
  writeFileSync(join(dir, "index.html"), index);
  writeFileSync(
    join(publicDir, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[publicSite(), `${publicSite()}p/index.html`, ...urls].map((u) => `<url><loc>${u}</loc></url>`).join("")}</urlset>`,
  );
  writeFileSync(join(publicDir, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${publicSite()}sitemap.xml\n`);
  return { pages: urls.length, metroPages: metroCount, kindPages: kindPages.length, urls };
}
