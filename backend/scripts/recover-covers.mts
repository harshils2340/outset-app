import "../src/env.ts";
import { db } from "../src/db/client.ts";
import { probeImage, shapeBonus } from "../src/enrich/imagesize.ts";
import { guardLaptopJob } from "../src/scrape/guard.ts";
import { spawnWorkers } from "../src/scrape/cpu.ts";

/**
 * Second look at every cover: read the real size of the cover and its alternates, and promote the best-shaped one.
 * Fixes listings that lead with a logo, a poster or a banner. Metro operators with the most reviews first.
 */
const limit = Number(process.argv[2] || 3000);
const concurrency = Number(process.argv[3] || 12);
guardLaptopJob({ name: "recover-covers", limit, concurrency });
const rows = db
  .prepare(
    `SELECT o.id, o.domain FROM operators o
     WHERE EXISTS (SELECT 1 FROM facts f WHERE f.operator_id = o.id AND f.fact_key = 'cover')
       AND NOT EXISTS (SELECT 1 FROM facts f WHERE f.operator_id = o.id AND f.fact_key = 'cover_checked')
     ORDER BY (o.metro_id IS NULL), o.review_count DESC NULLS LAST LIMIT ?`,
  )
  .all(limit) as { id: string; domain: string }[];
const photosOf = db.prepare("SELECT fact_key, fact_value, source_url FROM facts WHERE operator_id = ? AND fact_key IN ('cover','photo')");
const setCover = db.prepare("UPDATE facts SET fact_value = ?, source_url = ? WHERE operator_id = ? AND fact_key = 'cover'");
const mark = db.prepare("INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?, ?, 'cover_checked', ?, NULL, 'site')");
let i = 0;
let changed = 0;
let dropped = 0;
const worker = async () => {
  while (i < rows.length) {
    const op = rows[i++];
    try {
      const facts = photosOf.all(op.id) as { fact_key: string; fact_value: string; source_url: string | null }[];
      const cover = facts.find((f) => f.fact_key === "cover");
      if (!cover) continue;
      const cands = [cover.fact_value, ...facts.filter((f) => f.fact_key === "photo").map((f) => f.fact_value)].filter((v, k, a) => a.indexOf(v) === k).slice(0, 6);
      const scored = await Promise.all(cands.map(async (url, k) => ({ url, bonus: shapeBonus(await probeImage(url)), k })));
      // Widget product shots keep a head start; otherwise the crawl's order stands and shape breaks ties.
      const best = scored
        .map((x) => ({ ...x, score: (x.k === 0 ? 3 : 0) + (/filestack|fareharbor|xola/i.test(x.url) ? 2 : 0) - x.k * 0.5 + x.bonus }))
        .filter((x) => x.bonus > -6)
        .sort((a, b) => b.score - a.score)[0];
      if (best && best.url !== cover.fact_value) {
        setCover.run(best.url, cover.source_url, op.id);
        changed += 1;
      } else if (!best) dropped += 1;
      mark.run(crypto.randomUUID(), op.id, best ? best.url : "none");
    } catch (e) {
      console.error(op.domain + ": " + (e as Error).message.slice(0, 80));
    }
    const n = i;
    if (n % 200 === 0) console.log(`${n}/${rows.length} checked, ${changed} covers swapped, ${dropped} with no usable photo`);
  }
};
await Promise.all(Array.from({ length: Math.min(spawnWorkers(concurrency), rows.length) }, worker));
console.log(`Covers: ${rows.length} checked, ${changed} swapped, ${dropped} with no usable photo. Run sync to publish.`);
process.exit(0);
