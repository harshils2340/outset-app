import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectMedia, rankByShape, type Video } from "../src/enrich/imagescrape.ts";
import { probeKind } from "../src/enrich/pagescan.ts";
import { withDeadline } from "../src/scrape/fetch.ts";
import { cleanImageUrl, looksLikeSrcsetFragment } from "../src/enrich/srcset.ts";
import { REJECTED_KIND, fullSize } from "../src/sync/imageUrl.ts";

/**
 * The photo crawl, without the database.
 *
 * Three quarters of the catalog has no photo, no price and no hours, and 22,310 of those listings have a
 * website nobody has ever fetched. The crawl that fills them used to need the 450 MB SQLite file, which is
 * why it could only run on one laptop and then stopped running anywhere. It does not need it: a website goes
 * in and a handful of image URLs come out. `scripts/photo-queue.mts` writes the work list from the database
 * on a machine that has one; this script reads that list and writes its results beside it, so it runs on a
 * GitHub Actions runner for free, on a schedule, with no server to approve.
 *
 * Every image is judged as it is found, by the same pixel and page scan the cloud screen uses, so nothing
 * reaches a gallery unscreened and nothing waits on the next screening pass.
 *
 * Politeness is the point, not throughput. These fetches come from GitHub's shared IP ranges, so a block
 * would hurt every project on the platform. `fetchHtml` honours robots.txt and identifies itself; each
 * operator is one host and is crawled by one worker, and the default concurrency is four.
 *
 *   npx tsx scripts/crawl-photos-ci.mts --shard=0 --of=8 --concurrency=4 --minutes=170 --site-seconds=75
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
 * A hard ceiling on one operator. A site that opens a socket and never answers, or a headless render that
 * never settles, would otherwise hold a worker for the whole run: the first local test sat on six sites for
 * minutes and wrote nothing. Slow sites are not worth waiting for when twenty thousand are queued.
 */
const siteMs = Math.max(15, Number(arg("site-seconds", "75"))) * 1000;
const queuePath = join(backend, arg("queue", "data/photo-queue.json"));
const outDir = join(backend, "data/photos");
const outPath = join(outDir, `shard-${shard}-of-${of}.json`);

type QueueRow = { id: string; domain: string; website: string; name: string; art: string; family: string | null; region: string | null };
type Result = {
  /** The best photo, already screened. Absent when the site gave nothing usable. */
  cover?: string;
  photos: string[];
  videos: string[];
  /** When this operator was crawled, so a later run can refresh the stalest first. */
  at: string;
  /** Why an operator came back with nothing, so a human can tell a dead site from a blocked one. */
  note?: string;
};

if (!existsSync(queuePath)) {
  console.error(`no work list at ${queuePath}; run scripts/photo-queue.mts on a machine with the database first`);
  process.exit(1);
}
const queue = JSON.parse(readFileSync(queuePath, "utf8")) as { total: number; listed: number; operators: QueueRow[] };

// Striped, not sliced: every shard gets the same mix of states and categories, so one slow region cannot
// starve a runner and the early shards are not all the same corner of the country.
const mine = queue.operators.filter((_, i) => i % of === shard);

mkdirSync(outDir, { recursive: true });
const done: Record<string, Result> = existsSync(outPath) ? (JSON.parse(readFileSync(outPath, "utf8")) as Record<string, Result>) : {};
// The photo screen's verdicts, committed beside this script. A saved result whose every photo the screen has since
// rejected (a redesigned site's dead links, a logo) is not done: the work list queued it again for that reason.
const verdictFile = join(backend, "data/photo-verdicts.json");
const verdicts: Record<string, { kind?: string }> = existsSync(verdictFile) ? JSON.parse(readFileSync(verdictFile, "utf8")) : {};
const allRejected = (r: Result): boolean => {
  const urls = [r.cover || "", ...(r.photos || [])].filter(Boolean);
  if (!urls.length) return false;
  return urls.every((u) => {
    const c = cleanImageUrl(u);
    if (!c) return true;
    const kinds = [u, c, fullSize(c) || ""].map((k) => verdicts[k]?.kind).filter((k): k is string => !!k);
    return kinds.length > 0 && kinds.every((k) => REJECTED_KIND.test(k));
  });
};
for (const [id, r] of Object.entries(done)) if (allRejected(r)) delete done[id];

// An operator crawled by an earlier run under a different shard count (shard-2-of-6) is done too. Without this,
// changing the number of runners re-crawls everything the old layout finished.
const doneElsewhere = new Set<string>();
for (const f of readdirSync(outDir)) {
  if (!f.endsWith(".json") || join(outDir, f) === outPath) continue;
  try {
    for (const [id, r] of Object.entries(JSON.parse(readFileSync(join(outDir, f), "utf8")) as Record<string, Result>)) {
      if (![r.cover || "", ...(r.photos || [])].some((u) => u && looksLikeSrcsetFragment(u)) && !allRejected(r)) doneElsewhere.add(id);
    }
  } catch {
    /* a half-written shard from a cancelled runner */
  }
}
// Runs before 14 September 2026 split srcset on every comma and stored pieces of Wix transform URLs. Those
// operators are forgotten here so this run reads them again with the fixed parser, instead of being skipped
// for ever as done.
let redo = 0;
for (const [id, r] of Object.entries(done)) {
  if ([r.cover || "", ...(r.photos || [])].some((u) => u && looksLikeSrcsetFragment(u))) {
    delete done[id];
    redo += 1;
  }
}
if (redo) console.log(`${redo} operators had photos from the old comma-splitting parser and will be read again`);
const todo = mine.filter((r) => !done[r.id] && !doneElsewhere.has(r.id)).slice(0, limit > 0 ? limit : undefined);

console.log(`shard ${shard} of ${of}: ${mine.length} operators, ${Object.keys(done).length} already done, ${todo.length} to crawl, ${concurrency} at a time, ${minutes} minute budget`);

const deadline = Date.now() + minutes * 60_000;
let i = 0;
let crawled = 0;
let withPhotos = 0;
let screened = 0;
let dropped = 0;

/** Save as we go: a runner that is cancelled or times out still leaves everything it finished. */
let dirty = false;
const save = (): void => {
  if (!dirty) return;
  writeFileSync(outPath, JSON.stringify(done));
  dirty = false;
};
const saver = setInterval(save, 30_000);

/**
 * Judge one image the way the published screen does. A graphic, map or scanned document is not a photo of
 * the place; "unknown" means the proxy would not answer, which is not evidence against the image, so it is
 * kept and the next screening pass will settle it.
 */
async function usable(url: string): Promise<boolean> {
  try {
    const v = await probeKind(url);
    screened += 1;
    if (/^(?:graphic|map|document)$/.test(v.kind)) {
      dropped += 1;
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

async function worker(): Promise<void> {
  while (i < todo.length && Date.now() < deadline) {
    const row = todo[i++];
    const at = new Date().toISOString();
    try {
      const { photos, videos } = await withDeadline(collectMedia(row.website, 8), siteMs, row.domain);
      crawled += 1;
      if (!photos.length) {
        done[row.id] = { photos: [], videos: [], at, note: "no photos on the site" };
        dirty = true;
        continue;
      }
      const ranked = await rankByShape(photos);
      // Screen in crawl order and stop once there are enough, so a site with sixty images costs a few probes.
      const keep: string[] = [];
      for (const p of ranked) {
        if (keep.length >= 10) break;
        if (await withDeadline(usable(p.url), 20_000, "screen " + row.domain).catch(() => true)) keep.push(p.url);
      }
      done[row.id] = {
        ...(keep.length ? { cover: keep[0] } : {}),
        photos: keep,
        videos: videos.slice(0, 3).map((v: Video) => v.url),
        at,
        ...(keep.length ? {} : { note: "every photo screened out" }),
      };
      if (keep.length) withPhotos += 1;
      dirty = true;
    } catch (e) {
      done[row.id] = { photos: [], videos: [], at, note: (e as Error).message.slice(0, 80) };
      dirty = true;
    }
    if (crawled % 25 === 0) console.log(`  ${crawled}/${todo.length} crawled, ${withPhotos} with photos, ${screened} images screened, ${dropped} screened out`);
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
clearInterval(saver);
dirty = true;
save();

const ranOut = Date.now() >= deadline && i < todo.length;
console.log(
  `shard ${shard}: ${crawled} crawled, ${withPhotos} gained photos, ${screened} images screened, ${dropped} screened out. ` +
    `${Object.keys(done).length} of ${mine.length} done in this shard.` +
    (ranOut ? ` Budget reached with ${todo.length - i} left; the next run picks up where this stopped.` : ""),
);
// Photo harvesting starts headless Chrome for JavaScript-only sites, which can hold the process open.
process.exit(0);
