import { randomUUID } from "node:crypto";
import { db } from "../db/client.ts";
import { guardLaptopJob, isLaptop } from "../scrape/guard.ts";
import { measureIdle, MIN_IDLE } from "../scrape/cpu.ts";

/**
 * Covers that no longer load, repointed at a photo that does.
 *
 * Browse promises a photograph. `src/components/explore/feed.ts` keeps a listing out of the grid unless it
 * has a cover, because a wall of scene illustrations reads as a broken page however good the businesses
 * behind it are. But a cover is a URL on the operator's own web server, and they rot: measured twice on
 * 20 September 2026 against independent 40-listing samples, 3 of 40 and then 3 of 40 again no longer answer,
 * so something close to one cover in thirteen is dead at any moment. The guest app draws its generated
 * illustration in their place, which is the exact thing the cover filter exists to prevent.
 *
 * The app now drops such a card the moment its image fails (`src/lib/deadCovers.ts`), which is the right
 * behaviour and is still a patch over bad data: the listing silently vanishes from browse even though the
 * crawl usually found half a dozen other photographs of the same business. This fixes the data instead.
 * A listing whose cover has died is not a listing without photographs; it is a listing pointed at the wrong
 * one.
 *
 * Order of preference, and it matters: a cover that still loads is left completely alone, because the one a
 * person or the crawl chose is better than the next one in the list. Only a dead cover is replaced, by the
 * first surviving `photo` fact in the order they were stored. A listing with nothing left that loads has its
 * cover fact removed, so it drops out of browse honestly rather than standing there as a cartoon.
 *
 * This is a crawl: it asks thousands of other people's servers for images. It takes the single crawl lock,
 * keeps the CPU floor, and refuses to run past a small cap on a laptop. The whole catalog belongs on the
 * Render worker.
 */

/** Everything goes through the proxy the app itself draws with, so "loads" means what a guest would get. */
export function proxied(url: string, w = 640): string {
  return "https://wsrv.nl/?url=" + encodeURIComponent(url.replace(/^https?:\/\//, "")) + "&w=" + w + "&output=webp";
}

const TIMEOUT_MS = 15000;

/** Does this image actually render? An answer that is not an image is as dead as a 404. */
export async function renders(url: string): Promise<boolean> {
  try {
    const res = await fetch(proxied(url), { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return false;
    if (!(res.headers.get("content-type") || "").startsWith("image/")) return false;
    // wsrv answers 200 with a near-empty body for some upstream failures; a real photo is never 100 bytes.
    const buf = await res.arrayBuffer();
    return buf.byteLength > 1024;
  } catch {
    return false;
  }
}

export type CoverFix = { operatorId: string; domain: string; was: string; now: string | null; tried: number };

type Row = { id: string; domain: string; coverId: string; cover: string };

/** Listings with a cover, oldest first so a re-run continues rather than re-checking the same head. */
export function pending(limit: number): Row[] {
  return db
    .prepare(
      `SELECT o.id AS id, o.domain AS domain, f.id AS coverId, f.fact_value AS cover
         FROM facts f JOIN operators o ON o.id = f.operator_id
        WHERE f.fact_key = 'cover' AND f.fact_value LIKE 'http%'
        ORDER BY o.id
        LIMIT ?`,
    )
    .all(limit) as Row[];
}

function photosFor(operatorId: string): string[] {
  return (
    db
      .prepare("SELECT fact_value AS v FROM facts WHERE operator_id = ? AND fact_key = 'photo' AND fact_value LIKE 'http%'")
      .all(operatorId) as { v: string }[]
  ).map((r) => r.v);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type ScreenResult = { checked: number; alive: number; repointed: number; cleared: number; fixes: CoverFix[] };

export async function screenCovers(opts: { limit: number; concurrency: number; pauseMs: number }): Promise<ScreenResult> {
  if (isLaptop() && opts.limit > 40) {
    throw new Error(
      `Refusing to screen ${opts.limit} covers on this Mac; the cap here is 40. The catalog runs on the Render worker outset-pipeline: npm run cover-screen -- --limit=60000`,
    );
  }
  guardLaptopJob({ name: "cover-screen", limit: opts.limit, concurrency: opts.concurrency });

  const rows = pending(opts.limit);
  const out: ScreenResult = { checked: 0, alive: 0, repointed: 0, cleared: 0, fixes: [] };

  const one = async (r: Row): Promise<void> => {
    out.checked += 1;
    if (await renders(r.cover)) {
      out.alive += 1;
      return;
    }
    // Dead. Walk this operator's other photographs and take the first that a guest's browser would see.
    const others = photosFor(r.id).filter((p) => p !== r.cover);
    let tried = 0;
    for (const p of others) {
      tried += 1;
      if (!(await renders(p))) continue;
      db.prepare("UPDATE facts SET fact_value = ? WHERE id = ?").run(p, r.coverId);
      // The dead URL leaves the photo list too, or the listing page's gallery keeps drawing a gap for it.
      db.prepare("DELETE FROM facts WHERE operator_id = ? AND fact_key = 'photo' AND fact_value = ?").run(r.id, r.cover);
      out.repointed += 1;
      out.fixes.push({ operatorId: r.id, domain: r.domain, was: r.cover, now: p, tried });
      return;
    }
    // Nothing left that loads: drop the cover so the listing leaves browse honestly instead of as a cartoon.
    db.prepare("DELETE FROM facts WHERE id = ?").run(r.coverId);
    out.cleared += 1;
    out.fixes.push({ operatorId: r.id, domain: r.domain, was: r.cover, now: null, tried });
  };

  for (let i = 0; i < rows.length; i += opts.concurrency) {
    if (isLaptop()) {
      for (let w = 0; w < 20 && (await measureIdle()) < MIN_IDLE; w += 1) await sleep(3000);
    }
    await Promise.all(rows.slice(i, i + opts.concurrency).map(one));
    await sleep(opts.pauseMs);
  }
  return out;
}

/** Record a fresh cover id so a repointed listing is re-synced. Kept separate: sync reads facts, not this. */
export function noteSourced(operatorId: string, note: string): void {
  db.prepare("INSERT INTO sources (id, operator_id, url, fetched_at, http_status, extractor, robots_allowed, note) VALUES (?, ?, ?, ?, 200, 'cover-screen', 1, ?)").run(
    randomUUID(),
    operatorId,
    "",
    new Date().toISOString(),
    note,
  );
}
