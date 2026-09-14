import { randomUUID } from "node:crypto";
import { db, nowIso } from "../db/client.ts";
import { withDeadline } from "../scrape/fetch.ts";
import { spawnWorkers } from "../scrape/cpu.ts";
import { collectMedia } from "./imagescrape.ts";
import { rankForCover, type CoverContext } from "./photorelevance.ts";

/**
 * The database side of the photo harvest: pick which operators to crawl, run `imagescrape.ts` over their
 * sites, choose a cover, and write the photos back as facts.
 *
 * The crawl itself lives in `./imagescrape.ts` and touches no database, so the same code can run on a
 * GitHub Actions runner with no SQLite at all (`scripts/crawl-photos-ci.mts`). Everything it exports is
 * re-exported here, so callers that imported BAD_NAME, harvestImages, rankByShape, collectPhotos or
 * collectMedia from this file keep working.
 */
export * from "./imagescrape.ts";

/** What the business is called and which activity it sells, so the cover pass can tell a scene of it from a stray photo. */
function coverContextFor(id: string): CoverContext | null {
  const row = db.prepare("SELECT name, family, icon_key FROM operators WHERE id = ?").get(id) as { name: string; family: string | null; icon_key: string } | undefined;
  return row ? { title: row.name, art: row.icon_key, family: row.family || "" } : null;
}

export async function photosForOperator(op: { id: string; domain: string; website: string }): Promise<number> {
  const media = await collectMedia(op.website);
  const videos = media.videos;
  // Shape and file quality said which images are photographs. This says which of them is a photograph of this
  // business, using the alt text and the page the photo sits on, and puts that one in the cover slot.
  const ctx = coverContextFor(op.id);
  const photos = ctx ? rankForCover(media.photos, ctx) : media.photos;
  db.prepare("DELETE FROM facts WHERE operator_id = ? AND fact_key IN ('photo', 'cover', 'video', 'video_embed')").run(op.id);
  db.prepare("DELETE FROM sources WHERE operator_id = ? AND extractor = 'photos'").run(op.id);
  const ins = db.prepare("INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?, ?, ?, ?, ?, 'site')");
  photos.forEach((p, i) => {
    ins.run(randomUUID(), op.id, i === 0 ? "cover" : "photo", p.url, p.page);
    if (i === 0) ins.run(randomUUID(), op.id, "photo", p.url, p.page);
  });
  // One moving cover: a file the card can autoplay, and separately the best embed for the listing page.
  const file = videos.find((v) => v.kind !== "embed");
  const embed = videos.find((v) => v.kind === "embed");
  if (file) ins.run(randomUUID(), op.id, "video", file.url, file.page);
  if (embed) ins.run(randomUUID(), op.id, "video_embed", embed.url, embed.page);
  db.prepare(
    "INSERT INTO sources (id, operator_id, url, fetched_at, http_status, extractor, robots_allowed, note) VALUES (?, ?, ?, ?, 200, 'photos', 1, ?)",
  ).run(randomUUID(), op.id, op.website, nowIso(), photos.length + " photos" + (videos.length ? ", " + videos.length + " videos" : ", video checked") + " linked from the operator's own pages");
  return photos.length;
}

/** Operators already crawled for photos but never checked for video. Best-covered metros first. */
export function pendingVideos(limit: number): { id: string; domain: string; website: string }[] {
  return db
    .prepare(
      `SELECT id, domain, website FROM operators o
       WHERE origin != 'demo' AND website IS NOT NULL
         AND EXISTS (SELECT 1 FROM sources s WHERE s.operator_id = o.id AND s.extractor = 'photos' AND s.note NOT LIKE '%video%' AND s.note NOT LIKE '%checked%')
         AND EXISTS (SELECT 1 FROM facts f WHERE f.operator_id = o.id AND f.fact_key = 'cover')
       ORDER BY (metro_id IS NULL), review_count DESC NULLS LAST, name ASC
       LIMIT ?`,
    )
    .all(limit) as { id: string; domain: string; website: string }[];
}

export function pendingPhotos(limit: number): { id: string; domain: string; website: string }[] {
  return db
    .prepare(
      `SELECT id, domain, website FROM operators o
       WHERE origin != 'demo' AND website IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM sources s WHERE s.operator_id = o.id AND s.extractor = 'photos')
       ORDER BY (metro_id IS NULL), review_count DESC NULLS LAST, name ASC
       LIMIT ?`,
    )
    .all(limit) as { id: string; domain: string; website: string }[];
}

/** Operators the photo crawl already visited and came back empty-handed. Worth a second pass through the browser. */
export function pendingPhotosEmpty(limit: number): { id: string; domain: string; website: string }[] {
  return db
    .prepare(
      `SELECT id, domain, website FROM operators o
       WHERE origin != 'demo' AND website IS NOT NULL
         AND EXISTS (SELECT 1 FROM sources s WHERE s.operator_id = o.id AND s.extractor = 'photos')
         AND NOT EXISTS (SELECT 1 FROM facts f WHERE f.operator_id = o.id AND f.fact_key = 'cover')
       ORDER BY (metro_id IS NULL), review_count DESC NULLS LAST, name ASC
       LIMIT ?`,
    )
    .all(limit) as { id: string; domain: string; website: string }[];
}

export async function photosPending(limit: number, concurrency = 8, mode: "photos" | "videos" | "empty" = "photos"): Promise<{ sites: number; withPhotos: number; photos: number }> {
  const queue = mode === "videos" ? pendingVideos(limit) : mode === "empty" ? pendingPhotosEmpty(limit) : pendingPhotos(limit);
  const out = { sites: 0, withPhotos: 0, photos: 0 };
  let i = 0;
  const worker = async () => {
    while (i < queue.length) {
      const op = queue[i++];
      try {
        const n = await withDeadline(photosForOperator(op), mode === "photos" ? 60000 : 120000, op.domain);
        out.sites += 1;
        if (n) out.withPhotos += 1;
        out.photos += n;
      } catch (e) {
        out.sites += 1;
        console.error(op.domain + ": " + (e as Error).message.slice(0, 120));
      }
      if (out.sites % 100 === 0) console.log(`${out.sites}/${queue.length} sites, ${out.withPhotos} with photos, ${out.photos} photos`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(spawnWorkers(concurrency), queue.length) }, worker));
  return out;
}
