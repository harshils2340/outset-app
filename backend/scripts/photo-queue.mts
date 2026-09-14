import { DatabaseSync } from "node:sqlite";
import { collapseChains } from "../src/sync/brandShare.ts";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Writes the photo work list that the cloud crawl reads.
 *
 * The crawl's useful output is tiny: a website URL in, a handful of image URLs out. The 450 MB SQLite file
 * is the only reason it could not leave this machine, so this script is the one half that needs the
 * database. It runs here (or on Render), opens outset.db read-only, and commits
 * `backend/data/photo-queue.json`: every catalog operator that has a website and has never ended up with a
 * cover, best metros first.
 *
 * Deliberately NOT under `public/`. Vite copies `public/` into `dist/`, so a file there would ship to every
 * visitor on every deploy.
 *
 * Each row carries what the crawl needs and nothing else: the id to key results by, the host for
 * politeness, the site to crawl, and the three words `rankForCover` reads (name, art, family) so the cover
 * choice on the runner is the same one this machine would have made. `region` is there so a workflow can
 * shard by state.
 *
 *   npx tsx scripts/photo-queue.mts [--limit=20000] [--out=data/photo-queue.json]
 */

const here = dirname(fileURLToPath(import.meta.url));
const backend = join(here, "..");

const arg = (name: string, fallback: string): string => {
  const a = process.argv.find((x) => x.startsWith("--" + name + "="));
  return a ? a.split("=").slice(1).join("=") : fallback;
};

type Row = {
  id: string;
  domain: string;
  website: string;
  name: string;
  art: string;
  family: string | null;
  region: string | null;
  reviews: number | null;
  metro: 0 | 1;
};

const limit = Number(arg("limit", "20000"));
const dbPath = arg("db", process.env.OUTSET_DB || join(backend, "data/outset.db"));
const outPath = arg("out", join(backend, "data/photo-queue.json"));

if (!existsSync(dbPath)) {
  console.error(`No database at ${dbPath}. This script needs the machine that has it; the crawl does not.`);
  process.exit(1);
}

// Read-only: a crawl or a sync may be writing this file right now, and this job must never block one.
const db = new DatabaseSync(dbPath, { readOnly: true });
db.exec("PRAGMA busy_timeout = 120000");

const SELECT = `
  SELECT o.id, o.domain, o.website, o.name, o.icon_key AS art, o.family, o.region,
         o.review_count AS reviews, (o.metro_id IS NOT NULL) AS metro
    FROM operators o
   WHERE o.origin != 'demo'
     AND o.website IS NOT NULL AND o.website != ''
     AND o.name IS NOT NULL AND length(o.name) >= 3
     AND NOT EXISTS (SELECT 1 FROM facts f WHERE f.operator_id = o.id AND f.fact_key = 'cover')
`;

const total = (db.prepare(`SELECT count(*) AS n FROM (${SELECT})`).get() as { n: number }).n;

// Never-visited sites first: a site the crawl already walked and came back empty from is the expensive kind.
// Then metro rows, then the busiest operators, so the first shard is the one guests are most likely to open.
const rows = db
  .prepare(
    `${SELECT}
     ORDER BY EXISTS (SELECT 1 FROM sources s WHERE s.operator_id = o.id AND s.extractor = 'photos') ASC,
              metro DESC,
              o.review_count DESC NULLS LAST,
              o.name ASC
     LIMIT ?`,
  )
  .all(limit) as Row[];

// Chain locations collapse to one row per brand site; see src/sync/brandShare.ts.
const queue = collapseChains(rows).map((r) => ({
  id: r.id,
  domain: r.domain,
  website: r.website,
  name: r.name,
  art: r.art,
  family: r.family || "",
  region: r.region || "",
}));

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ at: new Date().toISOString(), total, listed: queue.length, operators: queue }, null, 0));

const bytes = Buffer.byteLength(JSON.stringify(queue));
const byRegion = new Map<string, number>();
for (const q of queue) byRegion.set(q.region || "?", (byRegion.get(q.region || "?") || 0) + 1);
const top = [...byRegion.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
console.log(`${total} operators have a website and no cover. Wrote the top ${queue.length} to ${outPath} (${(bytes / 1e6).toFixed(2)} MB).`);
console.log("Biggest regions in the queue: " + top.map(([r, n]) => `${r} ${n}`).join(", "));
