import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Site structure harvested by a crawl that ran without a database (GitHub Actions until 16 September 2026; the
 * Render worker writes straight to SQLite now, so these files only carry what that older crawl read).
 *
 * Photos are half a listing. This is the other half: what the operator sells, what it costs, how long it
 * takes, what is included, the waiver and booking links, the opening hours. `scripts/structure-queue.mts`
 * writes the work list from SQLite, `scripts/crawl-structure-ci.mts` runs on a runner and commits one JSON
 * shard per runner under `backend/data/structure/`, and this reads those shards back at sync time so the
 * catalog picks them up. Keyed by the operator's database id, which is what the work list carried.
 *
 * The shards are the crawl's memory as well as its output: an operator already in one is not read again, so
 * nothing here may be deleted to "force a refresh" without understanding that it also loses the record of
 * every site that legitimately had nothing to read.
 *
 * This is a way station, not a second database. Once a machine with SQLite imports these through
 * `saveSiteStructure`, the shards can be pruned; until then, merging them here is what makes a cloud crawl
 * visible on the site. The rows come out in exactly the shape `toCatalogItem` already reads out of
 * `offerings` and `facts`, so nothing downstream has to know where they came from.
 */

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "../../data/structure");

export type CrawledOffering = {
  name: string;
  detail: string | null;
  duration: string | null;
  price_cents: number | null;
  price_unit: string | null;
  currency?: string;
  source_url: string | null;
};
export type CrawledFact = { fact_key: string; fact_value: string; source_url: string | null };
export type CrawledStructure = {
  start: string;
  pages: number;
  services: CrawledOffering[];
  facts: CrawledFact[];
  contact: { phone?: string; email?: string; hours?: string };
  status: "ok" | "no_pages" | "error";
  error?: string;
  at: string;
};

let cache: Map<string, CrawledStructure> | null = null;

/** Every shard, merged. A later read of the same operator wins, so a re-crawl can correct a bad harvest. */
export function loadCrawledStructure(): Map<string, CrawledStructure> {
  if (cache) return cache;
  cache = new Map();
  if (!existsSync(dir)) return cache;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    let shard: Record<string, CrawledStructure>;
    try {
      shard = JSON.parse(readFileSync(join(dir, file), "utf8")) as Record<string, CrawledStructure>;
    } catch {
      continue; // a shard half-written by a cancelled runner is skipped, not fatal
    }
    for (const [id, row] of Object.entries(shard)) {
      if (!row || !Array.isArray(row.services) || !Array.isArray(row.facts)) continue;
      const prev = cache.get(id);
      if (!prev || (row.at || "") > (prev.at || "")) cache.set(id, row);
    }
  }
  return cache;
}

/**
 * What the cloud crawl read off one operator's site, in the shape `toCatalogItem` reads out of the database.
 * Empty when the crawl has not reached this operator or found nothing there.
 */
export function crawledStructureFor(operatorId: string): { offerings: CrawledOffering[]; facts: CrawledFact[] } {
  const row = loadCrawledStructure().get(operatorId);
  if (!row || row.status !== "ok") return { offerings: [], facts: [] };
  return { offerings: row.services || [], facts: row.facts || [] };
}

/** Opening hours the crawl read, for the operators whose `hours` column is still empty. */
export function crawledHoursFor(operatorId: string): string | null {
  return loadCrawledStructure().get(operatorId)?.contact.hours || null;
}

/** For the sync log: how many operators the cloud crawl has read, and how many gained services or a price. */
export function crawledStructureStats(): { operators: number; withServices: number; withPrices: number } {
  const all = loadCrawledStructure();
  let withServices = 0;
  let withPrices = 0;
  for (const row of all.values()) {
    if (row.services?.length) withServices += 1;
    if (row.services?.some((s) => s.price_cents != null)) withPrices += 1;
  }
  return { operators: all.size, withServices, withPrices };
}
