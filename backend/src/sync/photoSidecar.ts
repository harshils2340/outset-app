import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Photos harvested by the crawl that runs on GitHub Actions, where there is no database.
 *
 * `scripts/photo-queue.mts` writes the work list from SQLite, `scripts/crawl-photos-ci.mts` runs on a runner
 * and commits one JSON shard per runner under `backend/data/photos/`, and this reads those shards back at
 * sync time so the catalog picks them up. Keyed by the operator's database id, which is what the work list
 * carried.
 *
 * The shards are the crawl's memory as well as its output: an operator already in one is not crawled again,
 * so nothing here may be deleted to "force a refresh" without understanding that it also loses the record of
 * every site that legitimately had no photos.
 *
 * This is a way station, not a second database. Once a machine with SQLite imports these into facts, the
 * shards can be pruned; until then, merging them here is what makes a cloud crawl visible on the site.
 */

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "../../data/photos");

export type CrawledPhotos = { cover?: string; photos: string[]; videos: string[]; at: string; note?: string };

let cache: Map<string, CrawledPhotos> | null = null;

/** Every shard, merged. A later crawl of the same operator wins, so a re-crawl can correct a bad harvest. */
export function loadCrawledPhotos(): Map<string, CrawledPhotos> {
  if (cache) return cache;
  cache = new Map();
  if (!existsSync(dir)) return cache;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    let shard: Record<string, CrawledPhotos>;
    try {
      shard = JSON.parse(readFileSync(join(dir, file), "utf8")) as Record<string, CrawledPhotos>;
    } catch {
      continue; // a shard half-written by a cancelled runner is skipped, not fatal
    }
    for (const [id, row] of Object.entries(shard)) {
      if (!row || !Array.isArray(row.photos)) continue;
      const prev = cache.get(id);
      if (!prev || (row.at || "") > (prev.at || "")) cache.set(id, row);
    }
  }
  return cache;
}

/** What the cloud crawl found for one operator: its photos first, then its videos. Empty when it found nothing. */
export function crawledPhotosFor(operatorId: string): { photos: string[]; videos: string[] } {
  const row = loadCrawledPhotos().get(operatorId);
  if (!row) return { photos: [], videos: [] };
  return { photos: row.photos || [], videos: row.videos || [] };
}

/** For the sync log: how many operators the cloud crawl has reached, and how many of those gained a photo. */
export function crawledPhotoStats(): { operators: number; withPhotos: number } {
  const all = loadCrawledPhotos();
  let withPhotos = 0;
  for (const row of all.values()) if (row.photos?.length) withPhotos += 1;
  return { operators: all.size, withPhotos };
}
