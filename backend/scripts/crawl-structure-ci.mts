import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scrapeSite, serviceCount, type ScrapeResult } from "../src/enrich/sitescrape.ts";
import { withDeadline } from "../src/scrape/fetch.ts";

/**
 * The structure crawl, without the database.
 *
 * The photo crawl fills a listing's pictures. This fills everything else a guest actually reads: what the
 * operator sells, what it costs, how long it takes, what is included, the waiver and booking links, and the
 * opening hours. 43,722 catalog operators have a website and not one priced offering, and this crawl is the
 * only thing that changes that. Like the photo crawl it used to need the 450 MB SQLite file and so ran
 * nowhere; `scripts/structure-queue.mts` writes the work list on a machine that has the database, this reads
 * that list and writes its results beside it, and `src/sync/structureSidecar.ts` reads them back at sync time.
 *
 * Politeness is the point, not throughput. These fetches come from GitHub's shared IP ranges, so a block
 * would hurt every project on the platform. `fetchHtml` honours robots.txt and identifies itself; a site is
 * walked by one worker, one page at a time, with a pause between pages, and the default concurrency is four.
 * This crawl reads up to forty pages per site, so a site costs far more than a photo harvest does: budget
 * about two minutes each rather than the photo crawl's seventy-five seconds.
 *
 *   npx tsx scripts/crawl-structure-ci.mts --shard=0 --of=12 --concurrency=4 --minutes=170 --site-seconds=150
 */

const here = dirname(fileURLToPath(import.meta.url));
const backend = join(here, "..");

const arg = (name: string, fallback: string): string => {
  const a = process.argv.find((x) => x.startsWith("--" + name + "="));
  return a ? a.split("=").slice(1).join("=") : fallback;
};

const shard = Number(arg("shard", "0"));
const of = Math.max(1, Number(arg("of", "1")));
const concurrency = Math.max(1, Math.min(8, Number(arg("concurrency", "4"))));
const minutes = Math.max(1, Number(arg("minutes", "170")));
const limit = Number(arg("limit", "0"));
/**
 * A hard ceiling on one operator. A site that opens a socket and never answers would otherwise hold a worker
 * for the whole run, and a forty-page walk gives it forty chances to do that. Slow sites are not worth
 * waiting for when forty thousand are queued.
 */
const siteMs = Math.max(20, Number(arg("site-seconds", "150"))) * 1000;
// How deep to walk one site. `scrapeSite` reads this from the environment, the same as it does locally.
process.env.STRUCTURE_MAX_PAGES = arg("max-pages", process.env.STRUCTURE_MAX_PAGES || "40");
const queuePath = join(backend, arg("queue", "data/structure-queue.json"));
const outDir = join(backend, "data/structure");
const outPath = join(outDir, `shard-${shard}-of-${of}.json`);

type QueueRow = { id: string; domain: string; website: string; name: string; art: string; family: string | null; region: string | null };
/** The scrape as stored: the id is the key and the domain is in the work list, so neither is repeated here. */
type Stored = Omit<ScrapeResult, "operatorId" | "domain">;

if (!existsSync(queuePath)) {
  console.error(`no work list at ${queuePath}; run scripts/structure-queue.mts on a machine with the database first`);
  process.exit(1);
}
const queue = JSON.parse(readFileSync(queuePath, "utf8")) as { total: number; listed: number; operators: QueueRow[] };

// Striped, not sliced: every shard gets the same mix of states and categories, so one slow region cannot
// starve a runner and the early shards are not all the same corner of the country.
const mine = queue.operators.filter((_, i) => i % of === shard);

mkdirSync(outDir, { recursive: true });
const done: Record<string, Stored> = existsSync(outPath) ? (JSON.parse(readFileSync(outPath, "utf8")) as Record<string, Stored>) : {};
// An operator read by an earlier run under a different shard count is done too, so changing the number of
// runners does not re-read every site the old layout already finished.
const doneElsewhere = new Set<string>();
for (const f of readdirSync(outDir)) {
  if (!f.endsWith(".json") || join(outDir, f) === outPath) continue;
  try {
    for (const id of Object.keys(JSON.parse(readFileSync(join(outDir, f), "utf8")) as Record<string, unknown>)) doneElsewhere.add(id);
  } catch {
    /* a half-written shard from a cancelled runner */
  }
}
const todo = mine.filter((r) => !done[r.id] && !doneElsewhere.has(r.id)).slice(0, limit > 0 ? limit : undefined);

console.log(`shard ${shard} of ${of}: ${mine.length} operators, ${Object.keys(done).length} already done, ${todo.length} to read, ${concurrency} at a time, ${minutes} minute budget`);

const deadline = Date.now() + minutes * 60_000;
let i = 0;
let read = 0;
let withServices = 0;
let withPrices = 0;
let pages = 0;

/** Save as we go: a runner that is cancelled or times out still leaves everything it finished. */
let dirty = false;
const save = (): void => {
  if (!dirty) return;
  writeFileSync(outPath, JSON.stringify(done));
  dirty = false;
};
const saver = setInterval(save, 30_000);

function store(row: QueueRow, r: Stored): void {
  done[row.id] = r;
  dirty = true;
}

async function worker(): Promise<void> {
  while (i < todo.length && Date.now() < deadline) {
    const row = todo[i++];
    try {
      const r = await withDeadline(scrapeSite({ id: row.id, domain: row.domain, website: row.website }), siteMs, row.domain);
      const { operatorId: _id, domain: _domain, ...rest } = r;
      store(row, rest);
      read += 1;
      pages += r.pages;
      if (serviceCount(r) > 0) withServices += 1;
      if (r.services.some((s) => s.price_cents != null)) withPrices += 1;
    } catch (e) {
      // A deadline or a thrown fetch is still an answer about this site: record it so the next run moves on.
      store(row, {
        start: row.website,
        pages: 0,
        services: [],
        facts: [],
        contact: {},
        status: "error",
        error: (e as Error).message.slice(0, 200),
        at: new Date().toISOString(),
      });
      read += 1;
    }
    if (read % 25 === 0) console.log(`  ${read}/${todo.length} read, ${withServices} with services, ${withPrices} with a price, ${pages} pages fetched`);
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
clearInterval(saver);
dirty = true;
save();

const ranOut = Date.now() >= deadline && i < todo.length;
console.log(
  `shard ${shard}: ${read} sites read, ${withServices} gained services, ${withPrices} gained a price, ${pages} pages fetched. ` +
    `${Object.keys(done).length} of ${mine.length} done in this shard.` +
    (ranOut ? ` Budget reached with ${todo.length - i} left; the next run picks up where this stopped.` : ""),
);
