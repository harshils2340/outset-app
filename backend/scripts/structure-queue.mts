import { DatabaseSync } from "node:sqlite";
import { collapseChains } from "../src/sync/brandShare.ts";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Writes the structure work list that the cloud crawl reads.
 *
 * Photos alone do not populate a listing. Services, prices, durations, what is included, policies, the
 * meeting point and opening hours all come from the structure crawl, and that crawl has been running
 * nowhere: it needed the 450 MB SQLite file, so it only ever ran on one laptop. Splitting it the way the
 * photo crawl was split fixes that, and this script is the half that needs the database. It opens outset.db
 * read-only and commits `backend/data/structure-queue.json`: every catalog operator that has a website and
 * not one priced offering, best metros first.
 *
 * Deliberately NOT under `public/`. Vite copies `public/` into `dist/`, so a file there would ship to every
 * visitor on every deploy.
 *
 * Each row carries only what the crawl needs: the id to key results by, the host for politeness, the site to
 * crawl, and the words a human reads in the log (name, art, family). `region` is there so a workflow can
 * shard by state.
 *
 *   npx tsx scripts/structure-queue.mts [--limit=0] [--out=data/structure-queue.json]
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

// No cap by default: the whole backlog is the work list, and the runners stripe through it shard by shard.
const limit = Number(arg("limit", "0"));
const dbPath = arg("db", process.env.OUTSET_DB || join(backend, "data/outset.db"));
const outPath = arg("out", join(backend, "data/structure-queue.json"));

if (!existsSync(dbPath)) {
  console.error(`No database at ${dbPath}. This script needs the machine that has it; the crawl does not.`);
  process.exit(1);
}

// Read-only: a crawl or a sync may be writing this file right now, and this job must never block one.
const db = new DatabaseSync(dbPath, { readOnly: true });
db.exec("PRAGMA busy_timeout = 120000");

// Every operator with a website, not only the ones without a priced menu. A menu from a booking widget or
// an extraction is better than a crawl's, and the catalog merge keeps it, but those listings still lack what
// only the site says: opening hours, what is included, the meeting point, the cancellation policy. So they
// are read too, after every listing that has no menu at all.
const SELECT = `
  SELECT o.id, o.domain, o.website, o.name, o.icon_key AS art, o.family, o.region,
         o.review_count AS reviews, (o.metro_id IS NOT NULL) AS metro,
         EXISTS (SELECT 1 FROM offerings f WHERE f.operator_id = o.id AND f.price_cents IS NOT NULL AND f.price_cents > 0) AS priced
    FROM operators o
   WHERE o.origin != 'demo'
     AND o.website IS NOT NULL AND o.website != ''
     AND o.name IS NOT NULL AND length(o.name) >= 3
`;

const total = (db.prepare(`SELECT count(*) AS n FROM (${SELECT})`).get() as { n: number }).n;

// Never-read sites first: a site the structure crawl already walked and came back empty from is the
// expensive kind. Then metro rows, then the busiest operators, so the earliest results are the listings
// guests are most likely to open.
const rows = db
  .prepare(
    `${SELECT}
     -- Florida first: it is the launch market, and every listing there is one Harshil can sell this month.
     ORDER BY (o.region = 'FL') DESC,
              priced ASC,
              EXISTS (SELECT 1 FROM sources s WHERE s.operator_id = o.id AND s.extractor = 'site-structure') ASC,
              metro DESC,
              o.review_count DESC NULLS LAST,
              o.name ASC
     ${limit > 0 ? "LIMIT ?" : ""}`,
  )
  .all(...(limit > 0 ? [limit] : [])) as Row[];

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
console.log(`${total} operators have a website (unpriced first). Wrote ${queue.length} to ${outPath} (${(bytes / 1e6).toFixed(2)} MB).`);
console.log("Biggest regions in the queue: " + top.map(([r, n]) => `${r} ${n}`).join(", "));
