import { randomUUID } from "node:crypto";
import { load } from "cheerio";
import { db, nowIso } from "../db/client.ts";
import { fetchHtml, sleep, withDeadline } from "../scrape/fetch.ts";

/**
 * Real review text, from the two free places it lives: schema.org Review markup (what Google itself reads)
 * and the testimonials pages operators publish. Each review keeps its author, star rating when stated, and
 * the page it came from. Nothing is written by us. Reviews appear on the listing labelled as the operator's own.
 */

export type Review = { author: string | null; rating: number | null; text: string; date: string | null; source: "schema" | "site"; url: string };
type OpRow = { id: string; domain: string; website: string | null };

const REVIEW_LINK = /\b(reviews?|testimonials?|what[- ](people|guests|customers|our guests)[- ]say|feedback|raves?|kudos|guest[- ]book)\b/i;
const JUNK = /\b(cookie|javascript|subscribe|newsletter|privacy|terms|copyright|all rights|click here|read more|book now|\$\d)\b|https?:|@|\d{3}[-.]\d{3}[-.]\d{4}/i;
const FIRST_PERSON = /\b(we|our|us|i|my|me)\b/i;

function clean(s: string): string {
  return s.replace(/\s+/g, " ").replace(/^["“”'‘’\s]+|["“”'‘’\s]+$/g, "").trim();
}

function goodText(t: string): boolean {
  return t.length >= 50 && t.length <= 600 && !JUNK.test(t) && FIRST_PERSON.test(t) && /[.!?]/.test(t);
}

function ratingOf(v: unknown): number | null {
  const n = typeof v === "object" && v && "ratingValue" in (v as Record<string, unknown>) ? Number((v as Record<string, unknown>).ratingValue) : Number(v);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : null;
}

/** schema.org Review objects, at the top level or nested under a business, product or aggregate. */
export function reviewsFromJsonLd(html: string, url: string): Review[] {
  const $ = load(html);
  const out: Review[] = [];
  const walk = (node: unknown, depth: number) => {
    if (!node || depth > 6) return;
    if (Array.isArray(node)) {
      node.forEach((n) => walk(n, depth + 1));
      return;
    }
    if (typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    const type = String(o["@type"] || "");
    if (/Review$/.test(type) && (o.reviewBody || o.description)) {
      const text = clean(String(o.reviewBody || o.description));
      const author = typeof o.author === "string" ? o.author : ((o.author as Record<string, unknown> | undefined)?.name as string | undefined) || null;
      if (text.length >= 30 && text.length <= 700 && !JUNK.test(text)) {
        out.push({ author: author ? clean(String(author)).slice(0, 60) : null, rating: ratingOf(o.reviewRating), text, date: typeof o.datePublished === "string" ? o.datePublished.slice(0, 10) : null, source: "schema", url });
      }
    }
    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v, depth + 1);
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      walk(JSON.parse($(el).text()), 0);
    } catch {
      /* ignore broken JSON-LD */
    }
  });
  return out;
}

/** Testimonial blocks: an element that looks like a review card, or a blockquote, with a name nearby. */
export function reviewsFromMarkup(html: string, url: string): Review[] {
  const $ = load(html);
  $("script, style, noscript, nav, footer, header").remove();
  const out: Review[] = [];
  const seen = new Set<string>();
  const push = (text: string, author: string | null, rating: number | null) => {
    const t = clean(text);
    const key = t.slice(0, 80).toLowerCase();
    if (!goodText(t) || seen.has(key)) return;
    seen.add(key);
    out.push({ author, rating, text: t.slice(0, 600), date: null, source: "site", url });
  };
  const authorNear = (el: ReturnType<typeof $>): string | null => {
    const cand = el.find("cite, footer, .author, .name, [class*=author], [class*=name], h4, h5, strong, b").first().text();
    const c = clean(cand).replace(/^[-–—~]\s*/, "");
    return c && c.length <= 60 && !/[.!?]{2}/.test(c) && c.split(" ").length <= 6 ? c : null;
  };
  const starsNear = (el: ReturnType<typeof $>): number | null => {
    const cls = el.find("[class*=star], [class*=rating]").first();
    const filled = cls.find("[class*=full], [class*=filled], [class*=on], .fa-star, [class*=star-fill]").length;
    if (filled >= 1 && filled <= 5) return filled;
    const label = cls.attr("aria-label") || cls.attr("title") || "";
    const m = label.match(/(\d(?:\.\d)?)\s*(?:out of|\/)\s*5/i);
    return m ? Number(m[1]) : null;
  };
  $("[class*=testimonial], [class*=review], [id*=testimonial], [id*=review], blockquote").each((_, el) => {
    const node = $(el);
    if (node.find("[class*=testimonial], [class*=review], blockquote").length > 3) return; // a container, not a card
    const body = node.find("p, q, .text, [class*=content], [class*=body], [class*=quote]").filter((_, p) => clean($(p).text()).length >= 50).first();
    const text = body.length ? body.text() : node.clone().children("cite, footer, h4, h5").remove().end().text();
    push(text, authorNear(node), starsNear(node));
  });
  return out.slice(0, 12);
}

export async function reviewsForOperator(op: OpRow): Promise<{ pages: number; reviews: number }> {
  const start = op.website?.startsWith("http") ? op.website : "https://" + (op.website || op.domain);
  const home = await fetchHtml(start);
  if (home.status !== 200 || !home.html) return { pages: 0, reviews: 0 };
  const origin = new URL(home.finalUrl || start).origin;
  const found: Review[] = [...reviewsFromJsonLd(home.html, home.finalUrl || start), ...reviewsFromMarkup(home.html, home.finalUrl || start)];
  const $ = load(home.html);
  const links = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const text = $(el).text();
    if (!REVIEW_LINK.test(href) && !REVIEW_LINK.test(text)) return;
    try {
      const u = new URL(href, home.finalUrl || start);
      if (u.origin === origin && !/#|mailto:|tel:/.test(href)) links.add(u.origin + u.pathname);
    } catch {
      /* ignore */
    }
  });
  let pages = 1;
  for (const link of [...links].slice(0, 3)) {
    await sleep(120);
    const res = await fetchHtml(link).catch(() => null);
    if (!res || res.status !== 200 || !res.html) continue;
    pages += 1;
    found.push(...reviewsFromJsonLd(res.html, link), ...reviewsFromMarkup(res.html, link));
  }
  // Prefer schema.org reviews, then rated ones, then longer ones. Dedupe on the opening words.
  const seen = new Set<string>();
  const keep = found
    .sort((a, b) => (a.source === "schema" ? -1 : 0) - (b.source === "schema" ? -1 : 0) || (b.rating || 0) - (a.rating || 0) || b.text.length - a.text.length)
    .filter((r) => {
      const k = r.text.slice(0, 60).toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 8);
  db.prepare("DELETE FROM facts WHERE operator_id = ? AND fact_key = 'review'").run(op.id);
  db.prepare("DELETE FROM sources WHERE operator_id = ? AND extractor = 'reviews'").run(op.id);
  const ins = db.prepare("INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?, ?, 'review', ?, ?, 'site')");
  for (const r of keep) ins.run(randomUUID(), op.id, JSON.stringify({ a: r.author, r: r.rating, t: r.text, d: r.date, s: r.source }), r.url);
  db.prepare("INSERT INTO sources (id, operator_id, url, fetched_at, http_status, extractor, robots_allowed, note) VALUES (?, ?, ?, ?, 200, 'reviews', 1, ?)").run(randomUUID(), op.id, start, nowIso(), `${keep.length} reviews from ${pages} pages`);
  return { pages, reviews: keep.length };
}

export function pendingReviews(limit: number): OpRow[] {
  return db
    .prepare(
      `SELECT id, domain, website FROM operators o
       WHERE origin != 'demo' AND website IS NOT NULL AND metro_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM sources s WHERE s.operator_id = o.id AND s.extractor = 'reviews')
       ORDER BY review_count DESC NULLS LAST, name ASC
       LIMIT ?`,
    )
    .all(limit) as OpRow[];
}

export async function reviewsPending(limit: number, concurrency = 8): Promise<{ sites: number; withReviews: number; reviews: number }> {
  const queue = pendingReviews(limit);
  const out = { sites: 0, withReviews: 0, reviews: 0 };
  let i = 0;
  const worker = async () => {
    while (i < queue.length) {
      const op = queue[i++];
      try {
        const r = await withDeadline(reviewsForOperator(op), 90000, op.domain);
        out.sites += 1;
        if (r.reviews) out.withReviews += 1;
        out.reviews += r.reviews;
      } catch (e) {
        out.sites += 1;
        db.prepare("INSERT INTO sources (id, operator_id, url, fetched_at, http_status, extractor, robots_allowed, note) VALUES (?, ?, ?, ?, 0, 'reviews', 1, ?)").run(randomUUID(), op.id, op.website || op.domain, nowIso(), "error: " + (e as Error).message.slice(0, 80));
      }
      if (out.sites % 200 === 0) console.log(`${out.sites}/${queue.length} sites, ${out.withReviews} with reviews, ${out.reviews} reviews`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return out;
}
