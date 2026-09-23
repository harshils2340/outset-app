import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DIRECTORIES, runDirectory, type DirectoryCandidate } from "../src/discover/directories.ts";

/**
 * Read a slice of a directory-style marketplace for the businesses on it, and write what was found under
 * data/discovered/ for scripts/import-discovered.mts. No database, no network beyond the directory itself.
 *
 *   npx tsx scripts/discover-directories.mts --source=captainexperiences            40 pages, printed, nothing written
 *   npx tsx scripts/discover-directories.mts --source=captainexperiences --write    append to the two files below
 *   options: --max=40  --skip=N (continue from page N; a run records where it stopped in the summary file)
 *
 * Writes directory-<source>.json (candidates with their own website: the importer inserts these) and
 * directory-<source>-needs-website.json (name and town only: leads for a website lookup, never inserted as
 * listings). Both are appended to and deduplicated by domain, so successive slices build one list.
 *
 * On a laptop this is one host, one request at a time, a pause between, and at most 200 pages per run.
 */

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "../data/discovered");
const arg = (name: string, fallback: string): string => {
  const a = process.argv.find((x) => x.startsWith("--" + name + "="));
  return a ? a.split("=").slice(1).join("=") : fallback;
};
const write = process.argv.includes("--write");
const id = arg("source", "");
const src = DIRECTORIES.find((d) => d.id === id);
if (!src) {
  console.error(`--source must be one of: ${DIRECTORIES.map((d) => d.id).join(", ")}`);
  process.exit(1);
}

const summaryPath = join(outDir, `directory-${src.id}-summary.json`);
const summary = existsSync(summaryPath) ? (JSON.parse(readFileSync(summaryPath, "utf8")) as { nextSkip?: number }) : {};
const skip = Number(arg("skip", String(summary.nextSkip || 0)));
const max = Number(arg("max", String(src.max)));

const run = await runDirectory(src, { max, skip, log: console.log });
console.log(`${run.fetched} pages fetched, ${run.parsed} businesses read, ${run.withWebsite} with their own website, ${run.outsideMarket} outside the US and Canada, ${run.failed.length} failed`);
for (const f of run.failed.slice(0, 5)) console.log("  failed: " + f);
for (const c of run.candidates.slice(0, 12)) console.log(`  ${c.name} · ${[c.city, c.region].filter(Boolean).join(", ")}${c.website ? " · " + c.website : " · (no website on the page)"}`);
if (run.candidates.length > 12) console.log(`  ... and ${run.candidates.length - 12} more`);

if (!write) {
  console.log("\nDry run, nothing written. Add --write to append these to data/discovered/.");
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });
function appendUnique(path: string, rows: DirectoryCandidate[]): number {
  const have = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as DirectoryCandidate[]) : [];
  const seen = new Set(have.map((c) => c.domain));
  const fresh = rows.filter((c) => !seen.has(c.domain));
  writeFileSync(path, JSON.stringify([...have, ...fresh], null, 1));
  return fresh.length;
}
const withSite = run.candidates.filter((c) => c.website);
const needsSite = run.candidates.filter((c) => !c.website);
const a = appendUnique(join(outDir, `directory-${src.id}.json`), withSite);
const b = appendUnique(join(outDir, `directory-${src.id}-needs-website.json`), needsSite);
writeFileSync(summaryPath, JSON.stringify({ source: src.id, listed: run.listed, nextSkip: skip + run.fetched, lastRunAt: new Date().toISOString() }, null, 2));
console.log(`\nWrote ${a} new with a website (import-discovered.mts inserts these) and ${b} new needing a website lookup. Next run continues from #${skip + run.fetched} of ${run.listed}.`);
