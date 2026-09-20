import { randomUUID } from "node:crypto";
import { demandedTargets } from "../concierge/demand.ts";
import { db, nowIso } from "../db/client.ts";
import { sleep, withDeadline } from "../scrape/fetch.ts";
import { spawnWorkers } from "../scrape/cpu.ts";
import { normalizePhone } from "../scrape/run.ts";
import { scrapeSite, serviceCount, type ScrapeResult } from "./sitescrape.ts";

/**
 * Rule-based site reading, no language model. It reads what the operator's own site is organized around:
 * navigation links, page titles and headings. "Jet Ski Rentals", "Kayak Rentals", "Sunset Cruise", "Online Waiver",
 * "Reserve Now". Prices are copied only when a dollar amount sits right next to a service heading.
 * Everything stored has confidence 'site' and the page it came from. Nothing is guessed.
 *
 * The reading itself lives in `sitescrape.ts`, which touches no database so it can run on a GitHub Actions
 * runner. This file is the other half: it takes what a scrape found and writes it into offerings, facts,
 * operators and sources. Behaviour for callers here is unchanged.
 */

export { photoNear } from "./sitescrape.ts";

export type StructureResult = {
  operatorId: string;
  domain: string;
  pages: number;
  services: number;
  status: "ok" | "no_pages" | "error";
  error?: string;
};

/**
 * Store what a scrape found. Site rows are replaced wholesale, because a re-read of the same site is the
 * newer truth; photo and video facts come from the media crawl and outlive a structure re-read. Offerings are
 * only written when nothing better (a booking widget, a seed, an extraction) already priced this operator.
 */
export function saveSiteStructure(op: { id: string; domain: string; website: string }, scrape: ScrapeResult): StructureResult {
  const base: StructureResult = { operatorId: op.id, domain: op.domain, pages: scrape.pages, services: 0, status: scrape.status, error: scrape.error };
  if (scrape.status !== "ok") return base;
  const now = nowIso();
  const start = scrape.start;
  // Was the listing's current rating filled from an earlier read of the operator's own AggregateRating? Then a re-read may refresh it.
  const prevAgg = db.prepare("SELECT fact_value FROM facts WHERE operator_id = ? AND fact_key = 'aggregate_rating' AND confidence = 'site' LIMIT 1").get(op.id) as { fact_value: string } | undefined;
  db.prepare("DELETE FROM offerings WHERE operator_id = ? AND confidence = 'site'").run(op.id);
  db.prepare("DELETE FROM facts WHERE operator_id = ? AND confidence = 'site' AND fact_key NOT IN ('photo', 'cover', 'video', 'video_embed')").run(op.id);
  const insOff = db.prepare(
    `INSERT INTO offerings (id, operator_id, name, detail, duration, price_cents, price_unit, currency, source_url, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'site')`,
  );
  const insFact = db.prepare(
    "INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?, ?, ?, ?, ?, 'site')",
  );
  // A menu from the booking widget or the extraction wins, but only a menu with prices on it. Until 2026-09-14 any
  // AI row blocked the site read, so an extraction that had missed the pricing page ("Hourly rides, price not
  // stated") kept a later read of that page's "$130 an hour" out of the listing for good.
  const hasPricedMenu = db.prepare("SELECT 1 FROM offerings WHERE operator_id = ? AND confidence IN ('ai','seed','widget') AND price_cents IS NOT NULL LIMIT 1").get(op.id);
  if (!hasPricedMenu) {
    for (const s of scrape.services) {
      insOff.run(randomUUID(), op.id, s.name, s.detail, s.duration, s.price_cents, s.price_unit, s.currency, s.source_url);
    }
  }
  for (const f of scrape.facts) insFact.run(randomUUID(), op.id, f.fact_key, f.fact_value, f.source_url);
  base.services = serviceCount(scrape);
  applySiteAggregate(op.id, scrape, prevAgg?.fact_value || null);
  db.prepare(
    `UPDATE operators SET phone = COALESCE(phone, ?), hours = COALESCE(hours, ?), email = COALESCE(email, ?), updated_at = ? WHERE id = ?`,
  ).run(normalizePhone(scrape.contact.phone), scrape.contact.hours || null, scrape.contact.email || null, now, op.id);
  db.prepare("DELETE FROM sources WHERE operator_id = ? AND extractor = 'site-structure'").run(op.id);
  db.prepare(
    "INSERT INTO sources (id, operator_id, url, fetched_at, http_status, extractor, robots_allowed, note) VALUES (?, ?, ?, ?, 200, 'site-structure', 1, ?)",
  ).run(randomUUID(), op.id, start, now, "deep " + base.pages + " pages: service names, descriptions, prices, waiver and booking links read from the site's own pages.");
  return base;
}

/**
 * The operator's own schema.org AggregateRating fills `rating` and `review_count` only when discovery gave the listing
 * neither. The `aggregate_rating` fact written with the scrape is the note of where the numbers came from.
 */
function applySiteAggregate(operatorId: string, scrape: ScrapeResult, previous: string | null): void {
  const fact = scrape.facts.find((f) => f.fact_key === "aggregate_rating");
  if (!fact) return;
  let agg: { rating: number; count: number };
  try {
    agg = JSON.parse(fact.fact_value) as { rating: number; count: number };
  } catch {
    return;
  }
  if (!(agg.rating >= 1 && agg.rating <= 5) || !(agg.count >= 1)) return;
  let prev: { rating: number; count: number } | null = null;
  try {
    prev = previous ? (JSON.parse(previous) as { rating: number; count: number }) : null;
  } catch {
    prev = null;
  }
  db.prepare(
    `UPDATE operators SET rating = ?, review_count = ?, updated_at = ?
     WHERE id = ? AND ((rating IS NULL AND review_count IS NULL) OR (rating IS ? AND review_count IS ?))`,
  ).run(agg.rating, Math.round(agg.count), nowIso(), operatorId, prev ? prev.rating : -1, prev ? prev.count : -1);
}

export async function readSiteStructure(op: { id: string; domain: string; website: string }): Promise<StructureResult> {
  const scrape = await scrapeSite(op);
  try {
    return saveSiteStructure(op, scrape);
  } catch (e) {
    return { operatorId: op.id, domain: op.domain, pages: scrape.pages, services: 0, status: "error", error: (e as Error).message.slice(0, 200) };
  }
}

export function pendingStructure(limit: number, redo = false): { id: string; domain: string; website: string }[] {
  /**
   * What guests asked for, first.
   *
   * The fallback order below is `(metro_id IS NULL), review_count DESC NULLS LAST, name ASC`, and only 35,844
   * of 423,161 operators have a review count — so for 92% of the backlog it is `name ASC`, an alphabetical
   * march through 315,284 sites. The concierge knows which businesses a real person was just shown and could
   * not be quoted a price for, and those are strictly better targets than whatever begins with "A".
   *
   * Demand is a prefix, not a replacement: when nobody has asked for anything the queue behaves exactly as it
   * always did, so this cannot stall a cold pipeline.
   */
  const wanted = redo ? [] : demandedTargets(Math.min(limit, 2000));
  if (wanted.length >= limit) return wanted.slice(0, limit).map(({ id, domain, website }) => ({ id, domain, website }));

  // redo: sites read before the deep crawl existed (their source note lacks "deep"). Metro operators with the most reviews first.
  const cond = redo
    ? `AND NOT EXISTS (SELECT 1 FROM sources s WHERE s.operator_id = o.id AND s.extractor = 'site-structure' AND s.note LIKE 'deep %')`
    : `AND NOT EXISTS (SELECT 1 FROM sources s WHERE s.operator_id = o.id AND s.extractor = 'site-structure')`;
  const seen = new Set(wanted.map((w) => w.id));
  const rest = db
    .prepare(
      `SELECT id, domain, website FROM operators o
       WHERE origin != 'demo' AND website IS NOT NULL ${cond}
       ORDER BY (metro_id IS NULL), review_count DESC NULLS LAST, name ASC
       LIMIT ?`,
    )
    .all(limit) as { id: string; domain: string; website: string }[];
  return [
    ...wanted.map(({ id, domain, website }) => ({ id, domain, website })),
    ...rest.filter((r) => !seen.has(r.id)),
  ].slice(0, limit);
}

export async function readPendingStructures(limit: number, concurrency = 6, redo = false): Promise<StructureResult[]> {
  /**
   * Twenty-two seconds a site, not forty. Timing six real sites by hand gave a median of about seven seconds
   * and a mean of ten, the difference being a handful of very large sites: one college site alone took
   * twenty-nine. The tail is what the crawl spends its day on, and a site that has given us nothing in
   * twenty-two seconds is worth coming back to later rather than holding a worker slot now.
   */
  const queue = pendingStructure(limit, redo);
  const out: StructureResult[] = [];
  let i = 0;
  let done = 0;
  let errors = 0;
  const worker = async (w: number) => {
    await sleep(w * 400);
    while (i < queue.length) {
      const op = queue[i++];
      const r = await withDeadline(readSiteStructure(op), 22000, op.domain).catch((e) => ({ operatorId: op.id, domain: op.domain, pages: 0, services: 0, status: "error" as const, error: (e as Error).message }));
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
  await Promise.all(Array.from({ length: Math.min(spawnWorkers(concurrency), queue.length) }, (_, w) => worker(w)));
  return out;
}
