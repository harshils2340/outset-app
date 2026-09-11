import "../src/env.ts";
import { db } from "../src/db/client.ts";
import { probeQuality, isUsable } from "../src/enrich/photoquality.ts";
import { guardLaptopJob } from "../src/scrape/guard.ts";
import { spawnWorkers } from "../src/scrape/cpu.ts";

/**
 * Screen every cover, and every gallery photo, by its pixels. A map, logo, flyer or blank tile as cover is replaced by the operator's first
 * photo that reads as a photograph; with none, the cover fact is deleted so the listing falls back to the scene
 * illustration. Gallery photos that read as a graphic, map or scanned page are deleted, and a numbered series
 * (guide1..guide6, page-1..page-8) goes as a whole once any page of it fails, because the rest are the same
 * booklet. Each operator gets a `cover_screened` fact with the verdict so the run can resume.
 *   npx tsx scripts/screen-covers.mts [limit] [concurrency]
 */
const limit = Number(process.argv[2] || 100000);
const concurrency = Number(process.argv[3] || 8);
guardLaptopJob({ name: "screen-covers", limit, concurrency });
db.exec("PRAGMA busy_timeout = 180000");
const rows = db
  .prepare(
    `SELECT o.id, o.domain FROM operators o
     WHERE EXISTS (SELECT 1 FROM facts f WHERE f.operator_id = o.id AND f.fact_key = 'cover')
       AND NOT EXISTS (SELECT 1 FROM facts f WHERE f.operator_id = o.id AND f.fact_key = 'cover_screened')
     ORDER BY (o.metro_id IS NULL), o.review_count DESC NULLS LAST LIMIT ?`,
  )
  .all(limit) as { id: string; domain: string }[];
const photosOf = db.prepare("SELECT fact_key, fact_value, source_url FROM facts WHERE operator_id = ? AND fact_key IN ('cover','photo') ORDER BY rowid");
const setCover = db.prepare("UPDATE facts SET fact_value = ?, source_url = ? WHERE operator_id = ? AND fact_key = 'cover'");
const dropCover = db.prepare("DELETE FROM facts WHERE operator_id = ? AND fact_key = 'cover'");
const dropPhoto = db.prepare("DELETE FROM facts WHERE operator_id = ? AND fact_key IN ('photo','cover') AND fact_value = ?");
/** "boaters_safety_guide3.jpg" -> "boaters_safety_guide"; "" when the name does not end in a number. */
const seriesStem = (url: string): string => {
  const name = decodeURIComponent(url.split("?")[0].split("/").pop() || "").replace(/\.[a-z0-9]+$/i, "");
  const m = name.match(/^(.*?)[-_ ]?(\d{1,3})$/);
  return m && m[1].length >= 3 ? m[1].toLowerCase() : "";
};
const mark = db.prepare("INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?, ?, 'cover_screened', ?, NULL, 'site')");

let i = 0;
let kept = 0;
// A probe that never settles (the proxy sometimes leaves a socket open past its own timeout) counts as "unknown"
// rather than stalling a worker for the rest of the run.
const probe = (url: string) =>
  Promise.race([
    probeQuality(url),
    new Promise<Awaited<ReturnType<typeof probeQuality>>>((r) => setTimeout(() => r({ kind: "unknown", stats: null, reason: "hung" } as Awaited<ReturnType<typeof probeQuality>>), 30_000)),
  ]);
let swapped = 0;
let dropped = 0;
let photosDropped = 0;
const kinds: Record<string, number> = {};

const worker = async () => {
  while (i < rows.length) {
    const op = rows[i++];
    try {
      const facts = photosOf.all(op.id) as { fact_key: string; fact_value: string; source_url: string | null }[];
      const cover = facts.find((f) => f.fact_key === "cover");
      if (!cover) continue;
      const verdict = await probe(cover.fact_value);
      kinds[verdict.kind] = (kinds[verdict.kind] || 0) + 1;
      // Gallery: every photo gets its own verdict; a bad one is deleted, and so is the rest of its numbered series.
      const photos = facts.filter((f) => f.fact_key === "photo");
      const verdicts = new Map<string, string>();
      const badStems = new Set<string>();
      if (!isUsable(verdict.kind)) { const st = seriesStem(cover.fact_value); if (st) badStems.add(st); }
      await Promise.all(photos.map(async (f) => { const v = f.fact_value === cover.fact_value ? verdict : await probe(f.fact_value); verdicts.set(f.fact_value, v.kind); if (!isUsable(v.kind)) { const st = seriesStem(f.fact_value); if (st) badStems.add(st); } }));
      const stemCount = new Map<string, number>();
      for (const f of photos) { const st = seriesStem(f.fact_value); if (st) stemCount.set(st, (stemCount.get(st) || 0) + 1); }
      const bad = (url: string) => !isUsable(verdicts.get(url) as never) || (badStems.has(seriesStem(url)) && (stemCount.get(seriesStem(url)) || 0) >= 2);
      for (const f of photos) {
        if (f.fact_value !== cover.fact_value && bad(f.fact_value)) { dropPhoto.run(op.id, f.fact_value); photosDropped += 1; }
      }
      if (isUsable(verdict.kind) && !bad(cover.fact_value)) {
        kept += 1;
        mark.run(crypto.randomUUID(), op.id, "kept:" + verdict.kind);
        continue;
      }
      // The cover is a map, graphic or scanned page: promote the first gallery photo that passed.
      const replacement = photos.find((f) => f.fact_value !== cover.fact_value && verdicts.get(f.fact_value) === "photo" && !bad(f.fact_value)) || null;
      if (replacement) {
        setCover.run(replacement.fact_value, replacement.source_url ?? cover.source_url, op.id);
        swapped += 1;
        mark.run(crypto.randomUUID(), op.id, "swapped:" + verdict.kind + ":" + replacement.fact_value);
      } else {
        dropCover.run(op.id);
        dropped += 1;
        mark.run(crypto.randomUUID(), op.id, "dropped:" + verdict.kind);
      }
    } catch (e) {
      console.error(op.domain + ": " + (e as Error).message.slice(0, 80));
    }
    const n = i;
    if (n % 100 === 0) console.log(new Date().toISOString().slice(11, 19), `${n}/${rows.length} screened, ${kept} kept, ${swapped} swapped, ${dropped} dropped, ${photosDropped} gallery photos removed`, kinds);
  }
};

console.log(`${rows.length} covers to screen, ${concurrency} at a time`);
await Promise.all(Array.from({ length: Math.min(spawnWorkers(concurrency), rows.length) }, worker));
console.log(`done: ${rows.length} screened, ${kept} kept, ${swapped} swapped, ${dropped} dropped, ${photosDropped} gallery photos removed`, kinds);
