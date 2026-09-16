import "../src/env.ts";
import { randomUUID } from "node:crypto";
import { load } from "cheerio";
import { db, nowIso } from "../src/db/client.ts";
import { fetchHtml, sleep, withDeadline } from "../src/scrape/fetch.ts";
import { guardLaptopJob } from "../src/scrape/guard.ts";
import { spawnWorkers } from "../src/scrape/cpu.ts";
import { detectVendor } from "../src/enrich/vendors.ts";

/**
 * Booking links for operators the crawl tagged with a vendor but never gave a usable booking URL.
 *
 * `npm run widgets` (src/enrich/widgets.ts pendingWidgets) only reaches an operator whose `booking_url` fact
 * carries the vendor's own shape: a FareHarbor shortname, a book.peek.com/s/<key>/<code> link, a Xola seller.
 * Hundreds of operators were tagged from page text instead (`booking_software` / `booking_vendor` facts,
 * `operators.calendar_vendor`) with a `booking_url` that points at their own /book-now/ page, so the widget
 * reader never sees them. This script opens that page (homepage plus up to --pages obvious booking pages: links
 * that say book / reserve / schedule / tickets), finds the vendor embed in the HTML, and records one
 * `booking_url` fact with confidence 'widget-link' in the shape the readers expect.
 *
 * Two shortcuts spend no operator fetch at all:
 *   - a link the crawl already stored in a shape the reader does not parse (www.peek.com/s/..., a Xola
 *     x2-checkout button=<id>) is rewritten to the canonical shape; a Xola button is resolved to its seller
 *     through the public https://xola.com/api/buttons/<id> (the same call readXola makes).
 *
 * Dry run by default: prints what it would write. `--write` inserts facts and one `sources` row per operator
 * (extractor 'widget-links') so the next run skips it; `--redo` ignores that row.
 *
 *   npx tsx scripts/widget-links.mts                          dry run, 200 operators, 3 at a time
 *   npx tsx scripts/widget-links.mts --limit=2000 --concurrency=4 --write
 *   npx tsx scripts/widget-links.mts --vendor=peek,xola --limit=50
 *   npx tsx scripts/widget-links.mts --only=danawharf.com,flynyon.com
 *   --pages=2   booking pages to open after the homepage (default 2)
 *
 * Polite: src/scrape/fetch.ts (robots.txt, browser UA with a From header, 12 s timeout, CPU budget), one
 * homepage and at most --pages more per operator, 40 s deadline per operator. No browser is ever launched.
 * On a Mac guardLaptopJob caps it to one crawl at a time; the full run belongs on the Render worker.
 */

const args = process.argv.slice(2);
const flag = (name: string): string | null => {
  const a = args.find((x) => x === "--" + name || x.startsWith("--" + name + "="));
  if (!a) return null;
  return a.includes("=") ? a.slice(a.indexOf("=") + 1) : "";
};
const num = (name: string, dflt: number): number => {
  const v = flag(name);
  const n = v == null || v === "" ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
};
const WRITE = flag("write") != null;
const REDO = flag("redo") != null;
const LIMIT = num("limit", 200);
const CONCURRENCY = num("concurrency", 3);
const PAGES = num("pages", 2);
const ONLY = (flag("only") || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const VENDOR_FILTER = new Set((flag("vendor") || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));

/* ---------- vendor embeds ---------- */

export type Ref = { vendor: string; url: string; note?: string };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const HEX24 = "[a-f0-9]{24}";
/** A URL fragment as it appears in HTML, JSON or a script: stops at a quote, whitespace, a tag or a closing bracket. */
const REST = "[^\"'\\s<>)\\\\]*";
const FH_RESERVED = new Set(["api", "embeds", "book", "widgets", "static", "script", "calendar", "s", "help", "www", "blog", "support", "dashboard", "login", "signup", "compare", "about", "careers", "pricing", "features", "integrations", "developer", "developers", "partners", "press", "resources", "sitemap", "terms", "privacy"]);

const trimUrl = (u: string) => u.replace(/&amp;/g, "&").replace(/\\\//g, "/").replace(/[.,;:!?]+$/, "");

/**
 * Every vendor's public embed or link shape, read from raw HTML (script src, iframe src, anchors, data
 * attributes, inline JSON). Returns the booking URL in the shape src/enrich/widgets.ts parses for FareHarbor,
 * Peek and Xola, and the link as found for vendors that have no reader yet. Order matters: the first hit wins.
 */
const EXTRACTORS: { vendor: string; find: (html: string) => Ref | null }[] = [
  {
    vendor: "fareharbor",
    find: (h) => {
      const re = new RegExp("fareharbor\\.com\\/(?:embeds\\/(?:book|script)\\/(?:calendar\\/)?)?([a-z0-9][a-z0-9-]{1,60})\\/", "ig");
      let m: RegExpExecArray | null;
      while ((m = re.exec(h))) {
        const sn = m[1].toLowerCase();
        if (FH_RESERVED.has(sn) || /^v\d+$/.test(sn)) continue;
        return { vendor: "fareharbor", url: "https://fareharbor.com/embeds/book/" + sn + "/?full-items=yes" };
      }
      // FH.open({ shortname: "x" }) or a data attribute on the lightframe button.
      const s = h.match(/shortname["']?\s*[:=]\s*["']([a-z0-9][a-z0-9-]{1,60})["']/i) || h.match(/data-fareharbor-shortname\s*=\s*["']([a-z0-9][a-z0-9-]{1,60})["']/i);
      if (s && !FH_RESERVED.has(s[1].toLowerCase())) return { vendor: "fareharbor", url: "https://fareharbor.com/embeds/book/" + s[1].toLowerCase() + "/?full-items=yes" };
      return null;
    },
  },
  {
    vendor: "peek",
    find: (h) => {
      const m = h.match(new RegExp("peek\\.com\\/s\\/(" + UUID + ")\\/([A-Za-z0-9_]{3,12})\\b", "i"));
      if (m) return { vendor: "peek", url: "https://book.peek.com/s/" + m[1].toLowerCase() + "/" + m[2] };
      // The Peek Pro button: a widget key and a program code in data attributes near the word "peek".
      // window._peekConfig = {key: '<uuid>'} loads js.peek.com/widget_button.js; the storefront opens on the key alone,
      // so many sites carry no program code at all. Those are reported as partial, never written.
      const key = h.match(new RegExp("_peekConfig[^<>]{0,400}?(" + UUID + ")", "i")) || h.match(new RegExp("peek[^<>]{0,400}?(" + UUID + ")", "i")) || h.match(new RegExp("data-(?:peek-)?key\\s*=\\s*[\"'](" + UUID + ")[\"']", "i"));
      const code = h.match(/data-(?:peek-)?(?:program|program-id|activity|activity-id)\s*=\s*["']([A-Za-z0-9_]{3,12})["']/i);
      if (key && code) return { vendor: "peek", url: "https://book.peek.com/s/" + key[1].toLowerCase() + "/" + code[1] };
      if (key) return { vendor: "peek", url: "https://book.peek.com/s/" + key[1].toLowerCase(), note: "peek key without a program code: the reader needs both" };
      return null;
    },
  },
  {
    vendor: "xola",
    find: (h) => {
      const s = h.match(new RegExp("(?:seller\\/|[?&]sellerId=|data-seller(?:-id)?\\s*=\\s*\\\\?[\"'])(" + HEX24 + ")\\b", "i"));
      if (s) return { vendor: "xola", url: "https://checkout.xola.com/index.html#seller/" + s[1].toLowerCase() };
      // <div class="xola-checkout" data-button-id="..."> (also data-button=, and \" inside JSON-escaped page state).
      const b = h.match(new RegExp("(?:buttons?\\/|[?&#]button=|data-button(?:-id)?\\s*=\\s*\\\\?[\"'])(" + HEX24 + ")\\b", "i"));
      if (b) return { vendor: "xola", url: "button:" + b[1].toLowerCase() };
      return null;
    },
  },
  { vendor: "checkfront", find: (h) => pick(h, "https?:\\/\\/[a-z0-9-]+\\.checkfront\\.(?:com|site)" + REST, "checkfront", /^https?:\/\/(?:www|help|support|app)\./i) },
  { vendor: "bookeo", find: (h) => pick(h, "https?:\\/\\/(?:[a-z0-9-]+\\.)?bookeo\\.com\\/" + REST, "bookeo", /bookeo\.com\/(?:$|\?|#|support|help|blog|about|pricing|terms|privacy|login|signup|images|css|js\b)/i) },
  { vendor: "rezdy", find: (h) => pick(h, "https?:\\/\\/[a-z0-9-]+\\.rezdy\\.com" + REST, "rezdy", /^https?:\/\/(?:www|help|support|developers|api|app)\./i) },
  {
    vendor: "square",
    find: (h) =>
      pick(h, "https?:\\/\\/[a-z0-9-]+\\.square\\.site" + REST, "square", /^https?:\/\/(?:www|help|support)\./i) ||
      pick(h, "https?:\\/\\/(?:www\\.)?squareup\\.com\\/appointments\\/" + REST, "square") ||
      pick(h, "https?:\\/\\/(?:www\\.)?square\\.link\\/" + REST, "square"),
  },
  {
    vendor: "acuity",
    find: (h) =>
      pick(h, "https?:\\/\\/[a-z0-9-]+\\.as\\.me" + REST, "acuity", /^https?:\/\/(?:www|help|support)\./i) ||
      pick(h, "https?:\\/\\/(?:app|embed|[a-z0-9-]+)\\.(?:acuityscheduling|squarespacescheduling)\\.com\\/(?:schedule|embed)" + REST, "acuity"),
  },
  { vendor: "burblesoft", find: (h) => pick(h, "https?:\\/\\/bookings\\.burblesoft\\.com\\/index\\/\\d+(?:\\/\\d+)?", "burblesoft") },
  { vendor: "tock", find: (h) => pick(h, "https?:\\/\\/(?:www\\.)?exploretock\\.com\\/[a-z0-9][a-z0-9-]+" + REST, "tock", /exploretock\.com\/(?:about|blog|careers|business|city|explore|help|login|press|privacy|terms|search|user|join)\b/i) },
  { vendor: "vallypro", find: (h) => pick(h, "https?:\\/\\/(?:book\\.)?vallypro\\.com\\/p\\/[a-z0-9][a-z0-9-]+" + REST, "vallypro") },
  { vendor: "resova", find: (h) => pick(h, "https?:\\/\\/[a-z0-9-]+\\.resova\\.(?:us|com|eu)" + REST, "resova", /^https?:\/\/(?:www|get|help|support|app|api)\./i) },
];

function pick(html: string, pattern: string, vendor: string, skip?: RegExp): Ref | null {
  const re = new RegExp(pattern, "ig");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const url = trimUrl(m[0]);
    if (skip && skip.test(url)) continue;
    return { vendor, url };
  }
  return null;
}

/** The embed of one vendor, or of any known vendor when `vendor` is null. */
export function findEmbed(html: string, vendor: string | null): Ref | null {
  // Page builders inline their whole state: Vancouver Water Adventures' Xola button sits 1 MB into the homepage.
  const text = html.length > 2_500_000 ? html.slice(0, 2_500_000) : html;
  const order = vendor ? [...EXTRACTORS.filter((e) => e.vendor === vendor), ...EXTRACTORS.filter((e) => e.vendor !== vendor)] : EXTRACTORS;
  for (const e of order) {
    const r = e.find(text);
    if (r) return r;
  }
  return null;
}

/** A Xola button id names a seller only through the vendor's public button record. */
async function resolveXolaButton(ref: Ref): Promise<Ref> {
  if (ref.vendor !== "xola" || !ref.url.startsWith("button:")) return ref;
  try {
    const res = await fetch("https://xola.com/api/buttons/" + ref.url.slice(7), {
      headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36", accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { ...ref, note: "xola button " + ref.url.slice(7) + ": " + res.status };
    const b = (await res.json()) as { seller?: { id?: string } };
    const id = b?.seller?.id;
    if (id && /^[a-f0-9]{24}$/i.test(id)) return { vendor: "xola", url: "https://checkout.xola.com/index.html#seller/" + id.toLowerCase() };
    return { ...ref, note: "xola button record names no seller" };
  } catch (e) {
    return { ...ref, note: "xola button lookup failed: " + (e as Error).message.slice(0, 60) };
  }
}

/** True when the reader (pendingWidgets / readFareharbor / peekRef / xolaSeller) or detectVendor can use this link as-is. */
function usable(vendor: string, url: string): boolean {
  if (vendor === "fareharbor") {
    // Exactly what widgets.ts fareharborShortname accepts; /embeds/script/calendar/<sn>/ is not it.
    const m = url.match(/fareharbor\.com\/(?:embeds\/book\/)?([a-z0-9-]+)\/?/i);
    return !!m && !/^(api|embeds|book|widgets|static)$/i.test(m[1]);
  }
  if (vendor === "peek") return /book\.peek\.com\/s\/[a-f0-9-]{36}\/[A-Za-z0-9_]+/i.test(url);
  if (vendor === "xola") return /xola\.[a-z]+\/.*seller\/[a-f0-9]{24}/i.test(url);
  return detectVendor(url) === vendor;
}

/* ---------- the queue ---------- */

type Op = { id: string; domain: string; website: string; vendor: string; links: string[] };

const VENDORS = EXTRACTORS.map((e) => e.vendor);

function pending(): Op[] {
  const cond = REDO ? "" : "AND NOT EXISTS (SELECT 1 FROM sources s WHERE s.operator_id = o.id AND s.extractor = 'widget-links')";
  const onlyCond = ONLY.length ? `AND lower(o.domain) IN (${ONLY.map(() => "?").join(",")})` : "";
  const rows = db
    .prepare(
      `SELECT o.id, o.domain, o.website,
              COALESCE(o.calendar_vendor, (SELECT f.fact_value FROM facts f WHERE f.operator_id = o.id AND f.fact_key = 'booking_software' LIMIT 1)) AS vendor,
              (SELECT group_concat(f.fact_value, char(10)) FROM facts f WHERE f.operator_id = o.id AND f.fact_key IN ('booking_url', 'online_booking')) AS links
       FROM operators o
       WHERE o.origin != 'demo' AND o.website IS NOT NULL AND o.website != ''
         AND (o.calendar_vendor IN (${VENDORS.map((v) => "'" + v + "'").join(",")})
              OR EXISTS (SELECT 1 FROM facts f WHERE f.operator_id = o.id AND f.fact_key = 'booking_software' AND f.fact_value IN (${VENDORS.map((v) => "'" + v + "'").join(",")})))
         ${cond} ${onlyCond}
       ORDER BY (o.metro_id IS NULL), o.review_count DESC NULLS LAST, o.name ASC`,
    )
    .all(...ONLY) as { id: string; domain: string; website: string; vendor: string; links: string | null }[];
  const out: Op[] = [];
  for (const r of rows) {
    if (!VENDORS.includes(r.vendor)) continue;
    if (VENDOR_FILTER.size && !VENDOR_FILTER.has(r.vendor)) continue;
    const links = (r.links || "").split("\n").filter((l) => /^https?:\/\//i.test(l));
    if (links.some((l) => usable(r.vendor, l))) continue;
    out.push({ id: r.id, domain: r.domain, website: r.website, vendor: r.vendor, links });
    if (out.length >= LIMIT) break;
  }
  return out;
}

/* ---------- one operator ---------- */

type Outcome = { op: Op; how: "stored-link" | "homepage" | "booking-page" | "none" | "error"; ref: Ref | null; page: string | null; fetched: number; error?: string };

const BOOKISH = /\b(book|booking|reserve|reservation|schedule|tickets?|availability|rates|pricing|buy)\b/i;
const SKIP_PATH = /\.(pdf|jpe?g|png|gif|svg|webp|mp4|zip|css|js)$|\/(wp-json|feed|tag|category|author|cart|login|account|wp-admin|wp-content)\b|blog\/|\/news\//i;

/** Same-origin links whose text or href says book / reserve / schedule / tickets, "book now" first, shortest first. */
function bookingPages(html: string, pageUrl: string): string[] {
  const $ = load(html);
  const origin = new URL(pageUrl).origin;
  const scored = new Map<string, number>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const text = ($(el).text() || "").replace(/\s+/g, " ").trim();
    let abs: URL | null = null;
    try {
      abs = new URL(href, pageUrl);
    } catch {
      return;
    }
    if (abs.origin !== origin || SKIP_PATH.test(abs.pathname)) return;
    if (!BOOKISH.test(text) && !BOOKISH.test(abs.pathname)) return;
    const key = abs.origin + abs.pathname.replace(/\/$/, "") + (abs.search || "");
    if (key.replace(/\/$/, "") === pageUrl.replace(/\/$/, "")) return;
    const score = (/\bbook(?:ing)?\b|reserv/i.test(text) ? 3 : 0) + (/\bbook|reserv/i.test(abs.pathname) ? 2 : 0) + (BOOKISH.test(text) ? 1 : 0);
    scored.set(key, Math.max(scored.get(key) || 0, score));
  });
  return [...scored.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length).map(([u]) => u).slice(0, PAGES);
}

async function one(op: Op): Promise<Outcome> {
  // 1. A stored link in a shape the reader does not parse: rewrite it, no fetch of the operator's site.
  for (const l of op.links) {
    const r = findEmbed(l, op.vendor);
    if (r && r.vendor === op.vendor) {
      const ref = await resolveXolaButton(r);
      if (!ref.url.startsWith("button:") && !ref.note) return { op, how: "stored-link", ref, page: l, fetched: 0 };
    }
  }
  // 2. Homepage, then the obvious booking pages.
  const start = op.website.startsWith("http") ? op.website : "https://" + op.website;
  let fetched = 0;
  let home: { status: number; html: string; finalUrl: string };
  try {
    home = await fetchHtml(start);
    fetched += 1;
  } catch (e) {
    return { op, how: "error", ref: null, page: start, fetched, error: (e as Error).message.slice(0, 100) };
  }
  if (home.status !== 200 || !home.html) return { op, how: "error", ref: null, page: start, fetched, error: home.status === 0 ? "robots.txt disallows" : "http " + home.status };
  let found = findEmbed(home.html, op.vendor);
  if (found) {
    const ref = await resolveXolaButton(found);
    if (!ref.url.startsWith("button:")) return { op, how: "homepage", ref, page: home.finalUrl || start, fetched };
    found = null;
  }
  for (const url of bookingPages(home.html, home.finalUrl || start)) {
    await sleep(250);
    const res = await fetchHtml(url).catch(() => null);
    fetched += 1;
    if (!res || res.status !== 200 || !res.html) continue;
    const r = findEmbed(res.html, op.vendor);
    if (!r) continue;
    const ref = await resolveXolaButton(r);
    if (ref.url.startsWith("button:")) continue;
    return { op, how: "booking-page", ref, page: res.finalUrl || url, fetched };
  }
  return { op, how: "none", ref: null, page: null, fetched };
}

/* ---------- writes ---------- */

const insFact = db.prepare("INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?, ?, 'booking_url', ?, ?, 'widget-link')");
const delFact = db.prepare("DELETE FROM facts WHERE operator_id = ? AND fact_key = 'booking_url' AND confidence = 'widget-link'");
const hasFact = db.prepare("SELECT 1 FROM facts WHERE operator_id = ? AND fact_key = 'booking_url' AND fact_value = ? LIMIT 1");
const delSource = db.prepare("DELETE FROM sources WHERE operator_id = ? AND extractor = 'widget-links'");
const insSource = db.prepare("INSERT INTO sources (id, operator_id, url, fetched_at, http_status, extractor, robots_allowed, note) VALUES (?, ?, ?, ?, ?, 'widget-links', 1, ?)");

function store(o: Outcome): void {
  delSource.run(o.op.id);
  if (o.ref && !o.ref.note) {
    delFact.run(o.op.id);
    if (!hasFact.get(o.op.id, o.ref.url)) insFact.run(randomUUID(), o.op.id, o.ref.url, o.page || o.op.website);
    insSource.run(randomUUID(), o.op.id, o.page || o.op.website, nowIso(), 200, `${o.ref.vendor} link from ${o.how}` + (o.ref.vendor !== o.op.vendor ? ` (tagged ${o.op.vendor})` : ""));
  } else {
    insSource.run(randomUUID(), o.op.id, o.page || o.op.website, nowIso(), o.how === "error" ? 0 : 200, (o.how === "error" ? "error: " + (o.error || "") : o.ref?.note ? "partial: " + o.ref.note : "no " + o.op.vendor + " embed on homepage or booking pages").slice(0, 200));
  }
}

/* ---------- run ---------- */

const queue = pending();
console.log(`${WRITE ? "WRITE" : "DRY RUN"}: ${queue.length} operators tagged with a vendor but without a usable booking URL` + (ONLY.length ? ` (only ${ONLY.join(", ")})` : "") + (VENDOR_FILTER.size ? ` (vendor ${[...VENDOR_FILTER].join(", ")})` : "") + `. Concurrency ${CONCURRENCY}, ${PAGES} booking pages per site.`);
if (!queue.length) process.exit(0);
if (flag("list") != null) {
  // No network: the queue by vendor, and how many can be fixed from a stored link alone.
  const by = new Map<string, { total: number; stored: number }>();
  for (const op of queue) {
    const b = by.get(op.vendor) || { total: 0, stored: 0 };
    b.total += 1;
    if (op.links.some((l) => findEmbed(l, op.vendor)?.vendor === op.vendor)) b.stored += 1;
    by.set(op.vendor, b);
  }
  for (const [v, b] of [...by.entries()].sort((a, b) => b[1].total - a[1].total)) console.log(`  ${v.padEnd(11)} ${String(b.total).padStart(5)} queued, ${b.stored} rewritable from a stored link without a fetch`);
  process.exit(0);
}
if (!ONLY.length) guardLaptopJob({ name: "widget-links", limit: LIMIT, concurrency: CONCURRENCY });

const results: Outcome[] = [];
let i = 0;
let fetches = 0;
const worker = async (w: number) => {
  await sleep(w * 400);
  while (i < queue.length) {
    const op = queue[i++];
    const r = await withDeadline(one(op), 40000, op.domain).catch((e): Outcome => ({ op, how: "error", ref: null, page: null, fetched: 0, error: (e as Error).message.slice(0, 100) }));
    fetches += r.fetched;
    results.push(r);
    if (WRITE) store(r);
    const what = r.ref ? `${r.ref.vendor} ${r.ref.url}${r.ref.note ? "  [" + r.ref.note + "]" : ""}` : r.how === "error" ? "error: " + r.error : "no embed found";
    console.log(`${r.op.domain.padEnd(40)} ${r.op.vendor.padEnd(11)} ${r.how.padEnd(12)} ${what}${r.ref && r.ref.vendor !== r.op.vendor ? "  (tagged " + r.op.vendor + ")" : ""}`);
  }
};
await Promise.all(Array.from({ length: Math.min(spawnWorkers(CONCURRENCY), queue.length) }, (_, w) => worker(w)));

const ok = results.filter((r) => r.ref && !r.ref.note);
const byVendor = new Map<string, { total: number; found: number }>();
for (const r of results) {
  const b = byVendor.get(r.op.vendor) || { total: 0, found: 0 };
  b.total += 1;
  if (r.ref && !r.ref.note) b.found += 1;
  byVendor.set(r.op.vendor, b);
}
console.log("");
console.log(`${results.length} operators, ${fetches} page fetches, ${ok.length} booking links found (${results.filter((r) => r.how === "stored-link").length} from stored links, ${results.filter((r) => r.how === "homepage").length} on the homepage, ${results.filter((r) => r.how === "booking-page").length} on a booking page), ${results.filter((r) => r.how === "error").length} errors.`);
for (const [v, b] of [...byVendor.entries()].sort((a, b) => b[1].total - a[1].total)) console.log(`  ${v.padEnd(11)} ${b.found}/${b.total}`);
console.log(WRITE ? `Wrote ${ok.length} booking_url facts (confidence 'widget-link'); run \`npm run widgets\` to read the menus.` : "Nothing written. Add --write to insert the facts.");
process.exit(0);
