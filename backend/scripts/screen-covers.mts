import "../src/env.ts";
import { db } from "../src/db/client.ts";
import { probeQuality, isUsable } from "../src/enrich/photoquality.ts";

/**
 * Screen every cover by its pixels. A map, logo, flyer or blank tile as cover is replaced by the operator's first
 * photo that reads as a photograph; with none, the cover fact is deleted so the listing falls back to the scene
 * illustration. Each operator gets a `cover_screened` fact with the verdict so the run can resume.
 *   npx tsx scripts/screen-covers.mts [limit] [concurrency]
 */
const limit = Number(process.argv[2] || 100000);
const concurrency = Number(process.argv[3] || 8);
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
const mark = db.prepare("INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?, ?, 'cover_screened', ?, NULL, 'site')");

let i = 0;
let kept = 0;
let swapped = 0;
let dropped = 0;
const kinds: Record<string, number> = {};

const worker = async () => {
  while (i < rows.length) {
    const op = rows[i++];
    try {
      const facts = photosOf.all(op.id) as { fact_key: string; fact_value: string; source_url: string | null }[];
      const cover = facts.find((f) => f.fact_key === "cover");
      if (!cover) continue;
      const verdict = await probeQuality(cover.fact_value);
      kinds[verdict.kind] = (kinds[verdict.kind] || 0) + 1;
      if (isUsable(verdict.kind)) {
        kept += 1;
        mark.run(crypto.randomUUID(), op.id, "kept:" + verdict.kind);
        continue;
      }
      // The cover is a map or graphic: walk the other photos in crawl order and promote the first real one.
      let replacement: { fact_value: string; source_url: string | null } | null = null;
      for (const f of facts) {
        if (f.fact_key !== "photo" || f.fact_value === cover.fact_value) continue;
        const v = await probeQuality(f.fact_value);
        if (v.kind === "photo") {
          replacement = f;
          break;
        }
      }
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
    if (n % 200 === 0) console.log(`${n}/${rows.length} screened, ${kept} kept, ${swapped} swapped, ${dropped} dropped`, kinds);
  }
};

console.log(`${rows.length} covers to screen, ${concurrency} at a time`);
await Promise.all(Array.from({ length: concurrency }, worker));
console.log(`done: ${rows.length} screened, ${kept} kept, ${swapped} swapped, ${dropped} dropped`, kinds);
