import { DatabaseSync } from "node:sqlite";
import { collapseChains } from "../src/sync/brandShare.ts";
import { REJECTED_KIND, fullSize } from "../src/sync/imageUrl.ts";
import { cleanImageUrl } from "../src/enrich/srcset.ts";
import { existsSync as fileExists, readFileSync } from "node:fs";
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
     -- Florida first: it is the launch market, and every listing there is one Harshil can sell this month.
     ORDER BY (o.region = 'FL') DESC,
              EXISTS (SELECT 1 FROM sources s WHERE s.operator_id = o.id AND s.extractor = 'photos') ASC,
              metro DESC,
              o.review_count DESC NULLS LAST,
              o.name ASC
     LIMIT ?`,
  )
  .all(limit) as Row[];

/**
 * Operators that do have stored photos, all of which the photo screen has since rejected: dead links after a site
 * redesign, logos, maps, scanned documents. The screen drops those from the published listing but not from the
 * database, so the listing shows no picture while the query above still sees a cover and skips it for ever. Up
 * River Adventures, on the first Tampa send list, lost all eight photos this way. Strict rule: every stored
 * image has a rejected verdict. Images the screen has not judged yet do not count against an operator. These go
 * first, because they are listings guests could already see.
 */
const verdictPath = join(here, "../data/photo-verdicts.json");
const verdicts: Record<string, { kind?: string }> = fileExists(verdictPath) ? JSON.parse(readFileSync(verdictPath, "utf8")) : {};
const rejected = (url: string): boolean => {
  const clean = cleanImageUrl(url);
  if (!clean) return true;
  const keys = [url, clean, fullSize(clean) || ""].filter(Boolean);
  const kinds = keys.map((k) => verdicts[k]?.kind).filter((k): k is string => !!k);
  return kinds.length > 0 && kinds.every((k) => REJECTED_KIND.test(k));
};
const withPhotos = db
  .prepare(
    `SELECT o.id, o.domain, o.website, o.name, o.icon_key AS art, o.family, o.region,
            o.review_count AS reviews, (o.metro_id IS NOT NULL) AS metro,
            group_concat(f.fact_value, char(10)) AS urls
       FROM operators o JOIN facts f ON f.operator_id = o.id AND f.fact_key IN ('cover', 'photo')
      WHERE o.origin != 'demo' AND o.website IS NOT NULL AND o.website != '' AND o.name IS NOT NULL AND length(o.name) >= 3
      GROUP BY o.id`,
  )
  .all() as (Row & { urls: string })[];
const allRejected = Object.keys(verdicts).length
  ? withPhotos.filter((r) => {
      const urls = (r.urls || "").split("\n").filter(Boolean);
      return urls.length > 0 && urls.every(rejected);
    })
  : [];
if (allRejected.length) console.log(`${allRejected.length} operators have stored photos that the screen rejected, every one; queued first.`);

// Chain locations collapse to one row per brand site; see src/sync/brandShare.ts.
const queue = collapseChains([...allRejected, ...rows.filter((r) => !allRejected.some((a) => a.id === r.id))]).map((r) => ({
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
