import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { load } from "cheerio";
import { db, nowIso } from "../db/client.ts";
import { fetchHtml, sleep, withDeadline } from "../scrape/fetch.ts";
import { normalizePhone } from "../scrape/run.ts";
import { harvestHours } from "./hoursMarkup.ts";

/**
 * Rule-based site reading, no language model. It reads what the operator's own site is organized around:
 * navigation links, page titles and headings. "Jet Ski Rentals", "Kayak Rentals", "Sunset Cruise", "Online Waiver",
 * "Reserve Now". Prices are copied only when a dollar amount sits right next to a service heading.
 * Everything stored has confidence 'site' and the page it came from. Nothing is guessed.
 */

const SERVICE_WORDS =
  /beach (chair|furniture|umbrella)|cabana|umbrella|jet ?ski|waverunner|\bpwc\b|kayak|canoe|paddle ?board|\bsup\b|pontoon|boat rental|boat tour|charter|fishing|cruise|\bsail(ing|boat|s)?\b|sunset|dolphin|snorkel|parasail|skydiv|tandem|helicopter|heli ?tour|balloon|\bkart|escape room|\baxe\b|paintball|airsoft|horse|trail ride|zipline|\btub(e|ing)\b|banana boat|flyboard|eco ?tour|mangrove|manatee|whale|scuba|\bdiv(e|ing)\b|\bsurf|wakeboard|water ?ski|yacht|catamaran|glass ?bottom|airboat|\batv|\butv|\bjeep|segway|\bbikes?\b|e-?bike|rental/i;
const NOT_SERVICE = /blog|news|about|contact|faq|gallery|photo|review|career|job|privacy|terms|policy|sitemap|login|cart|account|gift|membership|sale|shop|store|merch|home$|location|weather|map|directions|press|partner|affiliate|franchise|donate|sponsor|newsletter|email|subscribe|coupon|special|deal/i;
/** Pages worth crawling first when a site has many. */
const CRAWL_FIRST = /rental|rent|tour|trip|price|pricing|rate|package|service|book|reserv|experience|adventure|charter|lesson|group|party|event|faq|policy|waiver|hour|about|activit|menu|option|what-we-offer|things-to-do/i;
const CRAWL_SKIP = /\.(pdf|jpg|jpeg|png|gif|svg|webp|mp4|zip|css|js)$|\/(wp-json|feed|tag|category|author|cart|checkout|login|account|wp-admin|wp-content|xmlrpc)\b|blog\/|\/news\/|\/page\/\d|\?|#/i;
const WAIVER = /waiver|release form|sign (the|your) (form|waiver)|smartwaiver|wherewolf|waiverforever/i;
const BOOK = /book now|reserve|reservation|book online|buy tickets|schedule|check availability|fareharbor|peek\.com|xola|rezdy|checkfront|bookeo|resova/i;
const HOURS = /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\s*(-|to|–|through)\s*(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\s*[:,]?\s*\d{1,2}(:\d{2})?\s*(am|pm)?\s*(-|to|–)\s*\d{1,2}(:\d{2})?\s*(am|pm)|\b(open|hours)\b[^.]{0,40}\d{1,2}(:\d{2})?\s*(am|pm)\s*(-|to|–)\s*\d{1,2}(:\d{2})?\s*(am|pm)/i;
const PRICE_NEAR = /\$\s?(\d{1,3}(?:,\d{3})+|\d{2,5})(?:\.\d{2})?(?:\s*(?:\/|per|an?|each)\s*(hour|hr|half.?hour|30 ?min|person|adult|child|kid|ski|boat|day|half.?day|trip|group|ride|flight|jump|room|lane|game)s?)?/i;

/** Groups of service names that mean the same activity. The first regex match wins. */
const CANON: [RegExp, string][] = [
  [/jet ?ski|waverunner|pwc/i, "Jet ski rental"], [/paddle ?board|sup\b/i, "Paddleboard rental"], [/kayak|canoe/i, "Kayak rental"],
  [/pontoon/i, "Pontoon rental"], [/pedal ?boat|paddle ?boat/i, "Pedal boat rental"], [/\bdock\b|swim platform/i, "Floating dock rental"],
  [/\bmega\b|giant (sup|paddle)/i, "Giant paddleboard rental"], [/boat rental|boat rent/i, "Boat rental"], [/parasail/i, "Parasailing"],
  [/banana boat|tube|tubing/i, "Banana boat and tubing"], [/flyboard/i, "Flyboarding"], [/snorkel/i, "Snorkel trip"],
  [/scuba|dive/i, "Dive trip"], [/dolphin|manatee|whale|eco ?tour|mangrove|wildlife/i, "Wildlife tour"],
  [/sunset|cruise|sail|catamaran|yacht|glass ?bottom|airboat|boat tour|harbor|harbour/i, "Boat tour"],
  [/fishing|charter/i, "Fishing charter"], [/skydiv|tandem/i, "Tandem skydive"], [/helicopter|heli/i, "Helicopter tour"],
  [/balloon/i, "Balloon flight"], [/escape room/i, "Escape room"], [/axe/i, "Axe throwing"], [/paintball|airsoft/i, "Paintball"],
  [/kart/i, "Karting"], [/horse|trail ride/i, "Trail ride"], [/zipline/i, "Zipline"], [/surf|wakeboard|water ?ski/i, "Surf and wake"],
  [/atv|utv|jeep|segway|bike/i, "Land rental"], [/beach (chair|furniture|umbrella)|cabana/i, "Beach furniture rental"],
];

function canon(name: string): string | null {
  for (const [re, label] of CANON) if (re.test(name)) return label;
  return null;
}

function normLabel(l: string): string {
  return l.toLowerCase().replace(/\bkids?\b/g, "child").replace(/\bchildren\b/g, "child").replace(/\bunder\b/g, "").replace(/\b(older|up|plus)\b/g, "").replace(/\b(and|&|the|a|an|per|each|only|rate|rates|price|prices)\b/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/s\b/g, "").replace(/\s+/g, " ").trim();
}

/** "Adult", "Adults" and "Adult 13 & older" at the same price are one line. Keep the most specific label. */
function dedupeVariants(vs: Variant[]): Variant[] {
  const out: Variant[] = [];
  for (const v of vs) {
    const n = normLabel(v.label);
    const twin = out.find((o) => {
      const m = normLabel(o.label);
      if (m === n) return true;
      if (o.price !== v.price) return false;
      const a = m.split(" ")[0];
      const b = n.split(" ")[0];
      return a === b && (m.startsWith(n) || n.startsWith(m));
    });
    if (!twin) out.push(v);
    else if (v.label.length > twin.label.length && twin.price === v.price) twin.label = v.label;
  }
  return out;
}

/** Collapse near-duplicates to one line per activity, keeping the shortest original name and any price seen. */
function consolidate(found: Map<string, Found>): Found[] {
  const groups = new Map<string, Found & { canon: string; descWords?: number }>();
  for (const f of found.values()) {
    if (/@|https?:|\.(com|net|org|ca)\b/i.test(f.name)) continue;
    const c = canon(f.name);
    if (!c) continue;
    const weak = f.price == null && !f.variants?.length && f.name.split(/\s+/).length < 2;
    if (weak) continue;
    if (/\b(rates?|prices?|pricing|packages?|options?|menu|services?)\b/i.test(f.name) && f.name.split(/\s+/).length <= 3) f.name = c;
    const cur = groups.get(c);
    if (!cur) {
      groups.set(c, { ...f, canon: c, descWords: f.desc ? f.name.split(/\s+/).length : undefined });
      continue;
    }
    if (f.name.length < cur.name.length && !/^(an?|the|your|our)\b|!$/i.test(f.name)) cur.name = f.name;
    if (cur.price == null && f.price != null) {
      cur.price = f.price;
      cur.unit = f.unit;
      cur.url = f.url;
    }
    if (!cur.detail && f.detail) cur.detail = f.detail;
    // Description: prefer the copy that came with the plainest alias ("Jet ski rental" over "jet ski dolphin tour"), then the longer one.
    if (f.desc && !/\(\d{3}\)|contact us|sales/i.test(f.desc)) {
      const fw = f.name.split(/\s+/).length;
      const cw = cur.descWords ?? 99;
      if (!cur.desc || fw < cw || (fw === cw && f.desc.length > cur.desc.length)) {
        cur.desc = f.desc;
        cur.descWords = fw;
      }
    }
    if (f.photo && (!cur.photo || (cur.photoWeak && !f.photoWeak) || (!f.photoWeak && f.name.length < cur.name.length))) {
      cur.photo = f.photo;
      cur.photoWeak = f.photoWeak;
    }
    if (f.variants?.length) {
      cur.variants = cur.variants || [];
      for (const v of f.variants) if (!cur.variants.some((x) => x.label.toLowerCase() === v.label.toLowerCase())) cur.variants.push(v);
    }
  }
  return [...groups.values()]
    .map((g) => {
      // A bare "Standard" line is only useful when it is the sole price.
      if (g.variants && g.variants.length > 1) g.variants = dedupeVariants(g.variants.filter((v) => v.label !== "Standard"));
      return { ...g, name: g.name.length > 34 ? g.canon : g.name.replace(/\s*&\s*more!?$/i, "") };
    })
    .slice(0, 14);
}

/** GoDaddy Website Builder edge (AWS Global Accelerator). Connect timeouts for our IP since the big crawl. */
const BLOCKED_HOSTS = new Set(["76.223.105.230", "13.248.243.5"]);

export type StructureResult = {
  operatorId: string;
  domain: string;
  pages: number;
  services: number;
  status: "ok" | "no_pages" | "error";
  error?: string;
};

function clean(s: string): string {
  return s.replace(/\s+/g, " ").replace(/[|•·–—]+/g, "-").replace(/\s*-\s*(from|starting at)\s*$/i, "").replace(/^\*+\s*/, "").trim();
}

/** Element text with a space between child elements, so "Boat Rental</b><span>2-Hour" does not fuse into one word. */
function spaced($: ReturnType<typeof load>, el: any): string {
  const parts: string[] = [];
  $(el)
    .contents()
    .each((_, n: any) => {
      if (n.type === "text") parts.push(n.data || "");
      else if (n.type === "tag" && n.name === "br") parts.push("\n");
      else if (n.type === "tag") parts.push(" " + spaced($, n) + " ");
    });
  return parts.join("");
}

function titleCase(s: string): string {
  return s.length > 3 && s === s.toUpperCase() ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : s;
}

type Variant = { label: string; price: number };
type Found = { name: string; detail: string | null; price: number | null; unit: string | null; url: string; variants?: Variant[]; desc?: string | null; photo?: string | null; photoWeak?: boolean };

const IMG_BAD = /logo|icon|sprite|badge|award|payment|visa|paypal|trip-?advisor|google-?review|reviews?\b|rating|yelp|facebook|instagram|arrow|button|btn|placeholder|spinner|pixel|avatar|map|flag|star|coupon|gift|calendar|phone|mail|social|header|branding|pattern|texture|blank|spacer|1x1|favicon|apple-touch|widget|weather|visible|hidden|overlay|\bbg\b|background|shape|divider|line\.|dot\.|loader|loading|\.(svg|gif|ico)(\?|$)/i;

/** Best photo near an element: inside its card, or the first real image after the heading. */
export function photoNear($: ReturnType<typeof load>, el: any, pageUrl: string, allowPageFallback = true): string | null {
  const pick = (imgs: any): string | null => {
    let best: string | null = null;
    imgs.each((_: number, img: any) => {
      if (best) return;
      const src = $(img).attr("data-src") || $(img).attr("data-lazy-src") || $(img).attr("src") || "";
      const srcset = $(img).attr("data-srcset") || $(img).attr("srcset") || "";
      const cand = srcset
        ? srcset.split(",").map((p) => p.trim().split(/\s+/)).sort((a, b) => (parseInt(b[1] || "0") || 0) - (parseInt(a[1] || "0") || 0))[0][0]
        : src;
      if (!cand) return;
      const w = Number(String($(img).attr("width") || "").replace(/[^0-9]/g, "")) || 0;
      if (w && w < 200) return;
      try {
        const abs = new URL(cand, pageUrl).toString();
        if (IMG_BAD.test(abs) || IMG_BAD.test($(img).attr("alt") || "")) return;
        best = abs;
      } catch {
        /* ignore */
      }
    });
    return best;
  };
  // 0. A picture inside the element itself, as with image links.
  const inside = pick($(el).find("img"));
  if (inside) return inside;
  // 1. The heading's own card or column.
  const card = $(el).closest("li, article, .card, [class*=card], [class*=item], [class*=service], [class*=product]");
  // WordPress wraps whole pages in <article>, so only trust a "card" that holds a handful of images.
  if (card.length && card.find("img").length <= 6) {
    const inCard = pick(card.find("img"));
    if (inCard) return inCard;
  }
  // 2. Walk up a few levels: a row that holds the heading in one column and the picture in another.
  let node = $(el).parent();
  for (let depth = 0; depth < 4 && node.length && !node.is("body"); depth++) {
    const imgs = node.find("img");
    if (imgs.length >= 1 && imgs.length <= 6) {
      const found = pick(imgs);
      if (found) return found;
    }
    if (imgs.length > 6) break;
    node = node.parent();
  }
  if (!allowPageFallback) return null;
  // 3. The page's first real content image, when the page itself is about this service.
  const main = $("main, article, [role=main], #content, .content, body").first();
  const rest = main.find("img").filter((_, img) => !$(img).closest("header, nav, footer, aside").length);
  return pick(rest.slice(0, 8));
}
type Addon = { name: string; price: number; url: string };

const ADDON_WORDS = /additional|extra|add[- ]?on|upgrade|rider|passenger|photo|video|gopro|camera|fuel|gas|cooler|insurance|damage|deposit|guide|lesson|delivery|late|tax|gratuity|tip|snorkel gear|wetsuit|dry bag|tube|towel/i;
const NUM = "(\\d{1,3}(?:,\\d{3})+|\\d{1,5})";
const PRICE_CELL = new RegExp("^\\$\\s?" + NUM + "(?:\\.\\d{2})?(?:\\s*(?:\\+|and up|\\/|per)?.*)?$", "i");
const toNum = (t: string) => Number(t.replace(/,/g, ""));

function isAddon(label: string): boolean {
  return ADDON_WORDS.test(label);
}

/** Nearest service heading above an element: check preceding siblings at each ancestor level, then the page's main heading. */
function headingAbove($: ReturnType<typeof load>, el: any): string | null {
  let node = $(el);
  for (let depth = 0; depth < 8 && node.length; depth++) {
    const prev = node.prevAll("h1, h2, h3, h4, h5, h6").filter((_, h) => SERVICE_WORDS.test($(h).text())).first();
    if (prev.length) return clean(prev.text());
    node = node.parent();
  }
  const page = $("h1, h2").filter((_, h) => SERVICE_WORDS.test($(h).text())).first();
  if (page.length) return clean(page.text());
  const title = clean($("title").first().text()).split(/[|\-–]/)[0].trim();
  return SERVICE_WORDS.test(title) ? title : null;
}

/** Read price tables and "label - $price" lists into variants and add-ons attached to the nearest service heading. */
function harvestPrices($: ReturnType<typeof load>, url: string, out: Map<string, Found>, addons: Map<string, Addon>) {
  const attach = (heading: string | null, rawLabel: string, price: number, el?: any) => {
    // Above this it is almost always a boat, a board or a membership for sale, not a booking.
    if (price > 5000 || price < 5) return;
    // "Save $15", "$10 off", deposits and coupons are not things a guest books.
    if (/\b(save|off|discount|coupon|deposit|refund|fee|tax|gratuity|tip|late|cancel|gift ?cards?|gift certificates?|membership|season pass|per (extra|additional))\b/i.test(rawLabel)) return;
    let label = rawLabel;
    if (isAddon(label)) {
      const k = label.toLowerCase();
      if (!addons.has(k)) addons.set(k, { name: titleCase(label), price, url });
      return;
    }
    const svc = heading && SERVICE_WORDS.test(heading) ? heading : label;
    if (label.toLowerCase() === svc.toLowerCase()) label = "Standard";
    const key = svc.toLowerCase();
    const cur = out.get(key) || { name: titleCase(svc), detail: null, price: null, unit: null, url };
    cur.variants = cur.variants || [];
    if (el && (!cur.photo || cur.photoWeak)) {
      const near = photoNear($, el, url, false);
      if (near) {
        cur.photo = near;
        cur.photoWeak = false;
      }
    }
    if (!cur.variants.some((v) => v.label.toLowerCase() === label.toLowerCase())) cur.variants.push({ label, price });
    if (cur.price == null || price < cur.price) cur.price = price;
    cur.url = url;
    out.set(key, cur);
  };

  $("table").each((_, table) => {
    const rows: string[][] = [];
    $(table)
      .find("tr")
      .each((_, tr) => {
        const cells = $(tr).find("th, td").map((_, c) => clean(spaced($, c))).get().filter((t) => t.length);
        if (cells.length) rows.push(cells);
      });
    if (!rows.length) return;
    const heading = headingAbove($, table);
    // Layout C: a header row naming price columns ("Price/Hour", "Half Day") and rows of [service, ..., $a, $b].
    const header = rows[0];
    const priceCols = header.map((h, i) => (/price|rate|hour|hr|half|day|week|min|adult|child|person|session|trip/i.test(h) ? i : -1)).filter((i) => i >= 0);
    if (rows.length >= 2 && priceCols.length >= 2 && rows.slice(1).some((r) => r.filter((c) => PRICE_CELL.test(c)).length >= 2)) {
      for (const r of rows.slice(1)) {
        if (!r[0] || PRICE_CELL.test(r[0]) || r[0].length > 48) continue;
        // Map price cells to header columns by position from the right when the row is shorter than the header.
        const shift = header.length - r.length;
        r.forEach((cell, i) => {
          if (!PRICE_CELL.test(cell)) return;
          const col = header[i + shift] || header[i] || "";
          const label = clean(col.replace(/price\s*\/?\s*/i, "").replace(/\*/g, "")) || "Standard";
          attach(r[0], label, toNum(cell.match(PRICE_CELL)![1]), table);
        });
      }
      return;
    }
    // Layout A: a label row followed by a price row (columns are variants).
    let usedA = false;
    for (let i = 0; i + 1 < rows.length; i++) {
      const labels = rows[i];
      const prices = rows[i + 1];
      if (labels.length === prices.length && prices.every((c) => PRICE_CELL.test(c)) && !labels.some((c) => PRICE_CELL.test(c))) {
        labels.forEach((l, j) => attach(heading, l, toNum(prices[j].match(PRICE_CELL)![1]), table));
        usedA = true;
        i++;
      }
    }
    // Layout B: rows of [label, ..., price]. Skipped when the table was already read as columns.
    if (usedA) return;
    for (const r of rows) {
      if (r.length < 2) continue;
      const priceIdx = r.findIndex((c) => PRICE_CELL.test(c));
      if (priceIdx > 0 && !PRICE_CELL.test(r[0]) && r[0].length <= 48) attach(heading, r[0], toNum(r[priceIdx].match(PRICE_CELL)![1]), table);
    }
  });

  $("li, p, dt, dd, span, div, h3, h4, a").each((_, el) => {
    if ($(el).children().length > 6) return;
    // Only the innermost element that holds the price. Wrappers around several cards would blur services together.
    if ($(el).children().toArray().some((c) => $(c).text().includes("$") && $(c).children().length > 0)) return;
    const raw = spaced($, $(el).clone().children("ul, ol, table").remove().end());
    const lines = raw.split(/\n+/).map((l) => clean(l)).filter((l) => l.length >= 4 && l.length <= 140 && (l.match(/\$/g) || []).length === 1);
    if (lines.length > 6) return;
    for (const text of lines) {
    const dollar = text.indexOf("$");
    let before = clean(text.slice(0, dollar));
    for (let k = 0; k < 3; k++) before = before.replace(/[-–:.,\s]+$/, "").replace(/\s*\b(from|starting at|only|just|as low as|price|prices|rate|rates)$/i, "").trim();
    const after = text.slice(dollar).match(new RegExp("^\\$\\s?" + NUM));
    if (!after || before.length < 3 || before.length > 48) continue;
    const label = before;
    if (!SERVICE_WORDS.test(label) && !/hour|hr|min|day|person|adult|child|kid|rider|ride|trip|flight|jump|game|lane|session|tour|package|standard|premium|private|group/i.test(label) && !isAddon(label)) continue;
    attach(headingAbove($, el), label, toNum(after[1]), el);
    }
  });
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const EMAIL_SKIP = /example|sentry|wixpress|godaddy|squarespace|wordpress|w3\.org|schema\.org|domain\.com|email\.com|yourdomain|noreply|no-reply|donotreply|\.(png|jpg|jpeg|gif|svg|webp)$/i;

type SiteImage = { url: string; words: string };

/** Every real content image on the site, with its filename and alt text as searchable words. */
function collectImages($: ReturnType<typeof load>, pageUrl: string, into: SiteImage[]): void {
  $("img").each((_, img) => {
    if ($(img).closest("header, nav, footer").length) return;
    const src = $(img).attr("data-src") || $(img).attr("data-lazy-src") || $(img).attr("src") || "";
    if (!src) return;
    const w = Number(String($(img).attr("width") || "").replace(/[^0-9]/g, "")) || 0;
    if (w && w < 200) return;
    try {
      const abs = new URL(src, pageUrl).toString();
      const alt = $(img).attr("alt") || "";
      if (IMG_BAD.test(abs) || IMG_BAD.test(alt)) return;
      const file = abs.split("/").pop()!.split("?")[0].replace(/\.[a-z0-9]+$/i, "");
      if (!into.some((i) => i.url === abs)) into.push({ url: abs, words: (file + " " + alt).toLowerCase().replace(/[-_]+/g, " ") });
    } catch {
      /* ignore */
    }
  });
}

/** For a service with no picture next to it, find a site image whose filename or alt names the same thing. */
function photoByName(name: string, images: SiteImage[]): string | null {
  const words = name.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !/rental|rentals|tour|tours|hour|hours|day|adult|child|person/.test(w));
  if (!words.length) return null;
  let best: { url: string; score: number } | null = null;
  for (const img of images) {
    const score = words.filter((w) => img.words.includes(w)).length;
    if (score && (!best || score > best.score)) best = { url: img.url, score };
  }
  return best?.url || null;
}

function originOf(u: string): string {
  try {
    return new URL(u).origin + "/";
  } catch {
    return u;
  }
}

function harvest(html: string, url: string, out: Map<string, Found>, links: Set<string>, meta: { waiver?: string; book?: string; phone?: string; hours?: string; email?: string; desc?: string; bodies?: Map<string, string> }, addons: Map<string, Addon>, images?: SiteImage[]) {
  const $ = load(html);
  const origin = new URL(url).origin;
  $("script, style, noscript, svg").remove();
  if (images) collectImages($, url, images);
  harvestPrices($, url, out, addons);

  $("a[href]").each((_, el) => {
    // Image links ("select a picture for prices") carry their name in the image's alt text.
    const imgIn = $(el).find("img").first();
    const text = clean($(el).text()) || (imgIn.length ? clean(imgIn.attr("alt") || imgIn.attr("title") || "") : "");
    const href = $(el).attr("href") || "";
    let abs: URL | null = null;
    try {
      abs = new URL(href, url);
    } catch {
      abs = null;
    }
    if (!meta.phone && /^tel:/i.test(href)) meta.phone = href.replace(/^tel:/i, "");
    if (!meta.email && /^mailto:/i.test(href)) {
      const m = href.replace(/^mailto:/i, "").split("?")[0].trim().toLowerCase();
      if (m.includes("@") && !EMAIL_SKIP.test(m)) meta.email = m;
    }
    if (!meta.waiver && (WAIVER.test(text) || WAIVER.test(href))) meta.waiver = abs?.toString() || href;
    if (!meta.book && (BOOK.test(text) || BOOK.test(href)) && abs) meta.book = abs.toString();
    if (!abs || abs.origin !== origin) return;
    if (CRAWL_SKIP.test(abs.pathname + abs.search + abs.hash)) return;
    links.add(abs.origin + abs.pathname.replace(/\/$/, ""));
    if (text.length >= 4 && text.length <= 60 && SERVICE_WORDS.test(text) && !NOT_SERVICE.test(text)) {
      const key = text.toLowerCase();
      if (!out.has(key)) out.set(key, { name: titleCase(text), detail: null, price: null, unit: null, url, photo: photoNear($, el, url, false) });
    }
  });

  $("h1, h2, h3").each((_, el) => {
    const text = clean(spaced($, el));
    if (text.length < 4 || text.length > 70 || !SERVICE_WORDS.test(text) || NOT_SERVICE.test(text)) return;
    if (/@|https?:|\.(com|net|org|ca)\b/i.test(text)) return;
    const key = text.toLowerCase();
    const near = clean($(el).nextAll().slice(0, 3).text()).slice(0, 240);
    const m = near.match(PRICE_NEAR) || text.match(PRICE_NEAR);
    const cur = out.get(key) || { name: titleCase(text), detail: null, price: null, unit: null, url };
    if (!cur.photo) {
      const strong = photoNear($, el, url, false);
      if (strong) cur.photo = strong;
      else {
        const weak = photoNear($, el, url, true);
        if (weak) {
          cur.photo = weak;
          cur.photoWeak = true;
        }
      }
    }
    {
      // Best paragraph under this heading: describes the activity, not a sales pitch, no phone numbers.
      const candidates = $(el).nextAll("p, div").slice(0, 4).map((_, n) => clean($(n).text())).get().filter((d) => d.length >= 60);
      const score = (d: string) =>
        (SERVICE_WORDS.test(d) ? 2 : 0) + (/\(\d{3}\)|\d{3}[-.]\d{3}[-.]\d{4}|contact us|call us|sales|membership|coupon|discount/i.test(d) ? -3 : 0) + (d.length > 140 ? 1 : 0);
      const best = candidates.sort((a, b) => score(b) - score(a))[0];
      if (best && score(best) > 0 && (!cur.desc || score(best) > score(cur.desc))) cur.desc = best.slice(0, 320).replace(/\s+\S*$/, "");
    }
    if (m && cur.price == null) {
      cur.price = toNum(m[1]);
      cur.unit = m[2] ? "/" + m[2].toLowerCase().replace(/s$/, "") : null;
      cur.url = url;
    }
    if (!cur.detail && near && !/\$/.test(near.slice(0, 5)) && !/reserve now|book now/i.test(near.slice(0, 20))) cur.detail = near.slice(0, 120).replace(/\s+\S*$/, "");
    out.set(key, cur);
  });

  // A service's own page (jet-ski-rentals, dolphin-tours) is the richest description of it. Keep its body copy.
  {
    const pathname = new URL(url).pathname.toLowerCase();
    const slugWords = new Set(pathname.split(/[^a-z0-9]+/).filter((w) => w.length > 2));
    const h1 = clean($("h1").first().text()).toLowerCase();
    const generic = /about|contact|faq|gallery|photo|blog|news|review|testimonial|things-to-do|polic|terms|privacy|waiver|licen|test|career|team|staff|location|direction|weather|gift|shop|cart|checkout|sitemap/.test(pathname);
    if (slugWords.size && !generic) {
      const body = $("main p, article p, .entry-content p, .content p, section p, p")
        .map((_, n) => clean($(n).text()))
        .get()
        .filter((d) => d.length >= 80 && !/cookie|javascript|browser|copyright|all rights|\(\d{3}\)|\d{3}[-.]\d{3}[-.]\d{4}|call us|contact us|privacy|terms/i.test(d))
        .slice(0, 4)
        .join(" ");
      if (body.length >= 160 && meta.bodies) meta.bodies.set(url, body.slice(0, 700).replace(/\s+\S*$/, ""));
      if (body.length >= 160) {
        const STOP = /^(the|and|our|for|with|tour|tours|rental|rentals|trip|trips|ride|rides)$/;
        const wordsOf = (name: string) => name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.test(w));
        const inSlug = (w: string) => slugWords.has(w) || slugWords.has(w + "s") || slugWords.has(w.replace(/s$/, ""));
        for (const cur of out.values()) {
          const words = wordsOf(cur.name);
          const hit = words.length > 0 && (words.every(inSlug) || (h1.length > 0 && words.every((w) => h1.includes(w))));
          if (!hit) continue;
          // /jet-ski-dolphin-tours/ belongs to neither "Jet Ski" nor "Dolphin Tours": a different service also fits the slug.
          // Aliases of the same service ("Jet ski rental" vs "Jet Ski Rentals Panama City Beach") overlap and do not count.
          const rival = [...out.values()].some((o) => {
            if (o === cur) return false;
            const ow = wordsOf(o.name);
            if (!ow.length || !ow.every(inSlug)) return false;
            const overlap = ow.some((w) => words.includes(w)) || words.some((w) => ow.includes(w));
            return !overlap;
          });
          if (rival) continue;
          if (!cur.desc || cur.desc.length < 200 || cur.desc.length < body.length / 2) cur.desc = body.slice(0, 700).replace(/\s+\S*$/, "");
          if (!cur.url || cur.url === originOf(url)) cur.url = url;
        }
      }
    }
  }

  if (!meta.desc) {
    const metaDesc = clean($('meta[property="og:description"]').attr("content") || $('meta[name="description"]').attr("content") || "");
    const para = $("main p, article p, section p, p").filter((_, n) => clean($(n).text()).length >= 90).first();
    const first = para.length ? clean(para.text()) : "";
    const pick = [metaDesc, first].filter((d) => d && !/cookie|javascript|browser|copyright|all rights|\(\d{3}\)|call us|contact us/i.test(d)).sort((a, b) => b.length - a.length)[0];
    if (pick) meta.desc = pick.slice(0, 420).replace(/\s+\S*$/, "");
  }
  if (!meta.email) {
    const found = (html.match(EMAIL_RE) || []).map((e) => e.toLowerCase()).filter((e) => !EMAIL_SKIP.test(e));
    const host = new URL(url).hostname.replace(/^www\./, "");
    const own = found.find((e) => e.endsWith("@" + host)) || found.find((e) => /info@|hello@|book|reserv|contact|sales|tours|charters/i.test(e)) || found[0];
    if (own) meta.email = own;
  }
  if (!meta.hours) {
    const lines = harvestHours(html);
    if (lines.length) meta.hours = lines.join(" | ");
  }
  if (!meta.hours) {
    const body = clean($("body").text());
    const h = body.match(HOURS);
    if (h) meta.hours = h[0].slice(0, 120);
  }
}

export async function readSiteStructure(op: { id: string; domain: string; website: string }): Promise<StructureResult> {
  const base: StructureResult = { operatorId: op.id, domain: op.domain, pages: 0, services: 0, status: "ok" };
  try {
    const start = op.website.startsWith("http") ? op.website : "https://" + op.website;
    // Hosts that drop our connections after heavy crawling. Skip in milliseconds instead of waiting out a timeout.
    try {
      const { address } = await lookup(new URL(start).hostname);
      if (BLOCKED_HOSTS.has(address)) return { ...base, status: "error", error: "host blocks crawler: " + address };
    } catch {
      return { ...base, status: "error", error: "dns lookup failed" };
    }
    let home;
    try {
      home = await fetchHtml(start);
    } catch (e) {
      // One retry after a pause covers the DNS hiccups that come with many parallel lookups.
      await sleep(1500);
      home = await fetchHtml(start);
    }
    if (home.status !== 200 || !home.html) return { ...base, status: "no_pages" };
    const found = new Map<string, Found>();
    const links = new Set<string>();
    const addons = new Map<string, Addon>();
    const images: SiteImage[] = [];
    const meta: { waiver?: string; book?: string; phone?: string; hours?: string; email?: string; desc?: string; bodies?: Map<string, string> } = { bodies: new Map() };
    harvest(home.html, home.finalUrl || start, found, links, meta, addons, images);
    base.pages = 1;
    // Breadth-first over the site's own pages, likely service and pricing pages first. Deep on purpose:
    // every location, activity and pricing page on the site is context for the listing.
    const MAX_PAGES = Number(process.env.STRUCTURE_MAX_PAGES || 40);
    const seen = new Set<string>([start.replace(/\/$/, ""), (home.finalUrl || start).replace(/\/$/, "")]);
    const queue: string[] = [];
    const enqueue = (set: Set<string>) => {
      const fresh = [...set].filter((u) => !seen.has(u) && !queue.includes(u));
      fresh.sort((a, b) => Number(CRAWL_FIRST.test(b)) - Number(CRAWL_FIRST.test(a)) || a.length - b.length);
      queue.push(...fresh);
    };
    enqueue(links);
    while (queue.length && base.pages < MAX_PAGES) {
      const url = queue.shift()!;
      if (seen.has(url)) continue;
      seen.add(url);
      await sleep(20);
      const res = await fetchHtml(url).catch(() => null);
      if (!res || res.status !== 200 || !res.html) continue;
      const more = new Set<string>();
      harvest(res.html, res.finalUrl || url, found, more, meta, addons, images);
      base.pages += 1;
      enqueue(more);
    }

    if (process.env.STRUCTURE_DEBUG) {
      for (const f of found.values()) console.error("FOUND", JSON.stringify({ name: f.name, photo: f.photo, weak: f.photoWeak, url: f.url, variants: f.variants?.length || 0 }));
    }
    const now = nowIso();
    db.prepare("DELETE FROM offerings WHERE operator_id = ? AND confidence = 'site'").run(op.id);
    // Photo and video facts come from the media crawl and outlive a structure re-read.
    db.prepare("DELETE FROM facts WHERE operator_id = ? AND confidence = 'site' AND fact_key NOT IN ('photo', 'cover', 'video', 'video_embed')").run(op.id);
    const insOff = db.prepare(
      `INSERT INTO offerings (id, operator_id, name, detail, duration, price_cents, price_unit, currency, source_url, confidence)
       VALUES (?, ?, ?, ?, NULL, ?, ?, 'USD', ?, 'site')`,
    );
    const insFact = db.prepare(
      "INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?, ?, ?, ?, ?, 'site')",
    );
    const hasAi = db.prepare("SELECT 1 FROM offerings WHERE operator_id = ? AND confidence IN ('ai','seed','widget') LIMIT 1").get(op.id);
    const services = consolidate(found);
    // Services still without copy: the page whose slug carries every word of the name, shortest slug wins.
    for (const f of services) {
      if (f.desc && f.desc.length >= 200) continue;
      const words = f.name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !/^(the|and|our|for|with|tour|tours|rental|rentals|trip|trips|ride|rides)$/.test(w));
      if (!words.length) continue;
      const hits = [...(meta.bodies || new Map<string, string>()).entries()]
        .filter(([u]) => {
          const sw = new Set(new URL(u).pathname.toLowerCase().split(/[^a-z0-9]+/));
          return words.every((w) => sw.has(w) || sw.has(w + "s") || sw.has(w.replace(/s$/, "")));
        })
        .sort((a, b) => a[0].length - b[0].length);
      if (hits[0] && (!f.desc || hits[0][1].length > f.desc.length)) {
        f.desc = hits[0][1];
        if (!f.url || f.url === originOf(hits[0][0])) f.url = hits[0][0];
      }
    }
    for (const f of services) {
      if (!f.photo || f.photoWeak) {
        const byName = photoByName(f.name, images);
        if (byName) f.photo = byName;
      }
      if (!hasAi) {
        if (f.variants?.length) {
          for (const v of f.variants.slice(0, 8)) {
            insOff.run(randomUUID(), op.id, f.name.slice(0, 80), v.label.slice(0, 80), v.price * 100, "each", f.url);
          }
        } else {
          insOff.run(randomUUID(), op.id, f.name.slice(0, 80), null, f.price == null ? null : f.price * 100, f.unit || "each", f.url);
        }
      }
      insFact.run(randomUUID(), op.id, "service", f.name.slice(0, 80), f.url);
      if (f.desc) insFact.run(randomUUID(), op.id, "service_desc", JSON.stringify({ name: f.name.slice(0, 80), desc: f.desc }), f.url);
      if (f.photo) insFact.run(randomUUID(), op.id, "service_photo", JSON.stringify({ name: f.name.slice(0, 80), url: f.photo }), f.url);
      base.services += 1;
    }
    for (const a of [...addons.values()].slice(0, 8)) insFact.run(randomUUID(), op.id, "addon", a.name.slice(0, 60) + " $" + a.price, a.url);
    if (meta.desc) insFact.run(randomUUID(), op.id, "site_desc", meta.desc, start);
    if (meta.waiver) insFact.run(randomUUID(), op.id, "waiver_url", meta.waiver, start);
    if (meta.book) insFact.run(randomUUID(), op.id, "booking_url", meta.book, start);
    if (meta.hours) insFact.run(randomUUID(), op.id, "hours_text", meta.hours, start);
    db.prepare(
      `UPDATE operators SET phone = COALESCE(phone, ?), hours = COALESCE(hours, ?), email = COALESCE(email, ?), updated_at = ? WHERE id = ?`,
    ).run(normalizePhone(meta.phone), meta.hours || null, meta.email || null, now, op.id);
    db.prepare("DELETE FROM sources WHERE operator_id = ? AND extractor = 'site-structure'").run(op.id);
    db.prepare(
      "INSERT INTO sources (id, operator_id, url, fetched_at, http_status, extractor, robots_allowed, note) VALUES (?, ?, ?, ?, 200, 'site-structure', 1, ?)",
    ).run(randomUUID(), op.id, start, now, "deep " + base.pages + " pages: service names, descriptions, prices, waiver and booking links read from the site's own pages.");
    return base;
  } catch (e) {
    const cause = (e as { cause?: { code?: string; message?: string } }).cause;
    const detail = cause ? " [" + (cause.code || cause.message || "") + "]" : "";
    return { ...base, status: "error", error: ((e as Error).message + detail).slice(0, 200) };
  }
}

export function pendingStructure(limit: number, redo = false): { id: string; domain: string; website: string }[] {
  // redo: sites read before the deep crawl existed (their source note lacks "deep"). Metro operators with the most reviews first.
  const cond = redo
    ? `AND NOT EXISTS (SELECT 1 FROM sources s WHERE s.operator_id = o.id AND s.extractor = 'site-structure' AND s.note LIKE 'deep %')`
    : `AND NOT EXISTS (SELECT 1 FROM sources s WHERE s.operator_id = o.id AND s.extractor = 'site-structure')`;
  return db
    .prepare(
      `SELECT id, domain, website FROM operators o
       WHERE origin != 'demo' AND website IS NOT NULL ${cond}
       ORDER BY (metro_id IS NULL), review_count DESC NULLS LAST, name ASC
       LIMIT ?`,
    )
    .all(limit) as { id: string; domain: string; website: string }[];
}

export async function readPendingStructures(limit: number, concurrency = 6, redo = false): Promise<StructureResult[]> {
  const queue = pendingStructure(limit, redo);
  const out: StructureResult[] = [];
  let i = 0;
  let done = 0;
  let errors = 0;
  const worker = async (w: number) => {
    await sleep(w * 400);
    while (i < queue.length) {
      const op = queue[i++];
      const r = await withDeadline(readSiteStructure(op), 40000, op.domain).catch((e) => ({ operatorId: op.id, domain: op.domain, pages: 0, services: 0, status: "error" as const, error: (e as Error).message }));
      out.push(r);
      done += 1;
      if (r.status !== "ok") {
        // Mark the attempt so the next run moves on instead of retrying the same dead or blocked sites first.
        db.prepare(
          "INSERT INTO sources (id, operator_id, url, fetched_at, http_status, extractor, robots_allowed, note) VALUES (?, ?, ?, ?, 0, 'site-structure', 1, ?)",
        ).run(randomUUID(), op.id, op.website, nowIso(), (r.status + ": " + (r.error || "no readable pages")).slice(0, 200));
      }
      if (r.status === "error" && errors < 12) {
        errors += 1;
        console.error(op.domain + ": " + r.error);
      }
      if (done % 50 === 0) {
        const ok = out.filter((x) => x.status === "ok").length;
        const svc = out.reduce((n, x) => n + x.services, 0);
        console.log(`${done}/${queue.length} sites, ${ok} readable, ${svc} services found`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, (_, w) => worker(w)));
  return out;
}
