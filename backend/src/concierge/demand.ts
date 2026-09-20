import { db } from "../db/client.ts";
import type { Option } from "./plan.ts";

/**
 * What guests actually ask for, fed back to the crawler.
 *
 * The crawl queue is ordered `(metro_id IS NULL), review_count DESC NULLS LAST, name ASC`, and only 35,844 of
 * 423,161 operators carry a review count. So for 92% of the backlog that ORDER BY collapses to `name ASC`: the
 * crawler works through the catalog alphabetically. "A1 Kayak Rentals" is read before "Escapology Toronto"
 * because of the letter it starts with, and with 315,284 sites still untouched, the difference between a good
 * order and an alphabetical one is the difference between the demo working and not.
 *
 * Meanwhile the concierge knows exactly what people want, because they typed it. Every question is a vote:
 * this activity, in this town, right now. And every answer that came back without a price is a specific
 * business a real person wanted and we could not quote. That is the best crawl target in the catalog and
 * nothing was doing anything with it.
 *
 * So: two tables. `crawl_demand` counts businesses that were shown to somebody and had nothing to show —
 * exact, and the strongest signal there is. `search_demand` counts the category-and-town pairs people ask
 * about, which reaches the businesses nobody has been shown yet because they are further down the list.
 *
 * Nothing here fetches anything. It writes down what was wanted; the pipeline on Render decides what to do
 * about it.
 */

let ready = false;

function ensure(): void {
  if (ready) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS crawl_demand (
      operator_id TEXT PRIMARY KEY,
      asks INTEGER NOT NULL DEFAULT 0,
      last_ask TEXT NOT NULL,
      last_reason TEXT
    );
    CREATE TABLE IF NOT EXISTS search_demand (
      id TEXT PRIMARY KEY,
      category_id TEXT,
      city TEXT,
      region TEXT,
      asks INTEGER NOT NULL DEFAULT 0,
      last_ask TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_crawl_demand_asks ON crawl_demand(asks DESC);
  `);
  ready = true;
}

/**
 * Record one answered question.
 *
 * Only the businesses we could not quote are counted. A shop we already have a price for is not a crawl
 * target, and counting it would bury the ones that are: the queue must be a list of gaps, not a popularity
 * chart of things that already work.
 */
export function recordDemand(intent: { categoryId: string | null; city: string | null; region: string | null }, options: Option[]): void {
  try {
    ensure();
    const now = new Date().toISOString();

    const bump = db.prepare(
      `INSERT INTO crawl_demand (operator_id, asks, last_ask, last_reason) VALUES (?, 1, ?, ?)
       ON CONFLICT(operator_id) DO UPDATE SET asks = asks + 1, last_ask = excluded.last_ask, last_reason = excluded.last_reason`,
    );
    const byDomain = db.prepare("SELECT id FROM operators WHERE domain = ?");

    for (const o of options) {
      const hasPrice = o.departures.some((d) => d.fromPrice != null) || o.services.some((s) => s.price != null);
      const hasTime = o.departures.length > 0;
      if (hasPrice && hasTime) continue;
      const row = byDomain.get(o.domain) as { id: string } | undefined;
      if (!row) continue;
      // Said plainly, so whoever reads the queue knows what this crawl is meant to find.
      const reason = !hasPrice && !o.bookingUrl ? "no price, no booking link" : !hasPrice ? "no price" : "no live times";
      bump.run(row.id, now, reason);
    }

    // The question itself, for the businesses further down the list that nobody has been shown yet.
    const key = [intent.categoryId || "any", (intent.city || "").toLowerCase(), intent.region || ""].join("|");
    db.prepare(
      `INSERT INTO search_demand (id, category_id, city, region, asks, last_ask) VALUES (?, ?, ?, ?, 1, ?)
       ON CONFLICT(id) DO UPDATE SET asks = asks + 1, last_ask = excluded.last_ask`,
    ).run(key, intent.categoryId, intent.city, intent.region, now);
  } catch {
    /**
     * A guest's answer must never fail because a counter did not increment. This table is an optimisation for
     * a crawler that runs somewhere else, hours from now.
     */
  }
}

export type DemandTarget = { id: string; domain: string; website: string; asks: number; reason: string | null };

/**
 * The crawl queue, most-wanted first.
 *
 * Businesses somebody was actually shown come first, ordered by how many people were shown them. Then the
 * businesses in the category-and-town pairs people keep asking about, which is how the queue reaches past the
 * handful that happen to rank today.
 */
export function demandedTargets(limit: number): DemandTarget[] {
  ensure();
  const shown = db
    .prepare(
      `SELECT o.id, o.domain, o.website, d.asks, d.last_reason AS reason
         FROM crawl_demand d JOIN operators o ON o.id = d.operator_id
        WHERE o.website IS NOT NULL AND o.origin != 'demo'
          AND NOT EXISTS (SELECT 1 FROM sources s WHERE s.operator_id = o.id AND s.extractor = 'site-structure')
        ORDER BY d.asks DESC, d.last_ask DESC LIMIT ?`,
    )
    .all(limit) as DemandTarget[];
  if (shown.length >= limit) return shown;

  /**
   * Then everything in the places people keep asking about. `instr` on a lowered city rather than a join,
   * because the demand table stores what the guest's sentence resolved to and operators are filed under
   * neighbouring towns: a question about Waterloo is answered by businesses in Kitchener and Cambridge.
   */
  const seen = new Set(shown.map((s) => s.id));
  const pairs = db
    .prepare("SELECT category_id, city, region, asks FROM search_demand ORDER BY asks DESC, last_ask DESC LIMIT 40")
    .all() as { category_id: string | null; city: string | null; region: string | null; asks: number }[];

  const out = [...shown];
  for (const p of pairs) {
    if (out.length >= limit) break;
    const where: string[] = ["o.website IS NOT NULL", "o.origin != 'demo'", "NOT EXISTS (SELECT 1 FROM sources s WHERE s.operator_id = o.id AND s.extractor = 'site-structure')"];
    const args: (string | number)[] = [];
    if (p.category_id) { where.push("o.category_id = ?"); args.push(p.category_id); }
    if (p.region) { where.push("o.region = ?"); args.push(p.region); }
    const rows = db
      .prepare(`SELECT o.id, o.domain, o.website FROM operators o WHERE ${where.join(" AND ")} ORDER BY o.review_count DESC NULLS LAST LIMIT ?`)
      .all(...args, limit - out.length) as { id: string; domain: string; website: string }[];
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({ ...r, asks: p.asks, reason: "asked for " + (p.category_id || "something") + " near " + (p.city || p.region) });
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** What the queue currently looks like, for the operator of the pipeline. */
export function demandSummary(): { shown: number; pairs: number; topPairs: { label: string; asks: number }[] } {
  ensure();
  const shown = (db.prepare("SELECT COUNT(*) n FROM crawl_demand").get() as { n: number }).n;
  const pairs = (db.prepare("SELECT COUNT(*) n FROM search_demand").get() as { n: number }).n;
  const top = db
    .prepare("SELECT category_id, city, region, asks FROM search_demand ORDER BY asks DESC LIMIT 8")
    .all() as { category_id: string | null; city: string | null; region: string | null; asks: number }[];
  return {
    shown,
    pairs,
    topPairs: top.map((p) => ({ label: (p.category_id || "anything") + " near " + (p.city || p.region || "anywhere"), asks: p.asks })),
  };
}
