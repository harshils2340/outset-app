import { randomUUID } from "node:crypto";
import { load } from "cheerio";
import { db, nowIso } from "../db/client.ts";
import { fetchHtml, sleep, withDeadline } from "../scrape/fetch.ts";
import { spawnWorkers } from "../scrape/cpu.ts";
import { harvestReviews, REVIEW_LINK } from "./sitescrape.ts";
import { selectReviews, type Review } from "../sync/reviews.ts";

/**
 * The standalone review pass: the home page and up to three review or testimonial pages per operator. The
 * reading itself is `harvestReviews` in sitescrape.ts, which the structure crawl also runs on every page it
 * visits, and the rules are in sync/reviews.ts, so both write the same `review` facts in the same model.
 */

type OpRow = { id: string; domain: string; website: string | null };

export async function reviewsForOperator(op: OpRow): Promise<{ pages: number; reviews: number }> {
  const start = op.website?.startsWith("http") ? op.website : "https://" + (op.website || op.domain);
  const home = await fetchHtml(start);
  if (home.status !== 200 || !home.html) return { pages: 0, reviews: 0 };
  const origin = new URL(home.finalUrl || start).origin;
  const found: Review[] = [...harvestReviews(home.html, home.finalUrl || start).reviews];
  const $ = load(home.html);
  const links = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const text = $(el).text();
    if (!REVIEW_LINK.test(href.replace(/[-_/]+/g, " ")) && !REVIEW_LINK.test(text)) return;
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
    found.push(...harvestReviews(res.html, link).reviews);
  }
  const keep = selectReviews(found);
  db.prepare("DELETE FROM facts WHERE operator_id = ? AND fact_key = 'review'").run(op.id);
  db.prepare("DELETE FROM sources WHERE operator_id = ? AND extractor = 'reviews'").run(op.id);
  const ins = db.prepare("INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?, ?, 'review', ?, ?, 'site')");
  for (const r of keep) ins.run(randomUUID(), op.id, JSON.stringify(r), r.sourceUrl);
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
  await Promise.all(Array.from({ length: Math.min(spawnWorkers(concurrency), queue.length) }, worker));
  return out;
}
