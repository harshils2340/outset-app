import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CHAINS, dedupeCandidates, runChains, type Candidate } from "../src/discover/chains.ts";
import { candidatesFromElements, fetchFloridaByName } from "../src/discover/osmnames.ts";
import { candidatesFromBrave, refreshBrave, type BraveState } from "../src/discover/braveapi.ts";

/**
 * Florida discovery, without the database.
 *
 * Three free sources, most precise first:
 *   chains  every Florida location of franchise and chain brands that sell bookable experiences, from each
 *           brand's own location pages (src/discover/chains.ts)
 *   osm     OpenStreetMap businesses in Florida whose names say what they are (src/discover/osmnames.ts),
 *           one Overpass request
 *   web     the official Brave Search API, Florida destinations x experience terms, operator sites only
 *           (src/discover/braveapi.ts); skipped when BRAVE_SEARCH_API_KEY is not set
 *
 * Like scripts/crawl-photos-ci.mts this never opens SQLite. It writes backend/data/discovered/florida-<source>.json
 * (a list of candidates) and a summary; scripts/import-discovered.mts inserts the new ones on a machine that
 * has the database. It runs on GitHub's runners (.github/workflows/discover-florida.yml), never on the Mac:
 * outside CI it refuses a full run and allows only a small correctness test (--chains=a,b,c, --sources=osm).
 *
 *   npx tsx scripts/discover-florida-ci.mts [--sources=chains,osm,web] [--chains=pwat,escapology] [--out=data/discovered]
 *                                           [--brave-budget=400]
 */

const here = dirname(fileURLToPath(import.meta.url));
const backend = join(here, "..");

const arg = (name: string, fallback: string): string => {
  const a = process.argv.find((x) => x.startsWith("--" + name + "="));
  return a ? a.split("=").slice(1).join("=") : fallback;
};

const sources = new Set(arg("sources", "chains,osm,web").split(",").map((s) => s.trim()).filter(Boolean));
const onlyChains = arg("chains", "").split(",").map((s) => s.trim()).filter(Boolean);
const outDir = resolve(backend, arg("out", "data/discovered"));
const braveBudget = Math.max(0, Number(arg("brave-budget", process.env.BRAVE_MAX_QUERIES || "400")));

const inCloud = !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.RENDER || process.env.OUTSET_PIPELINE);
if (!inCloud) {
  // The founder's Mac froze under crawls started from agent sessions. A statewide run belongs on a runner.
  // The web source only calls the Brave Search API, one request a second, and never fetches an operator's site or
  // starts a browser, so it cannot load the CPU the way the chain and map sources can. It may run here on its own,
  // which is how discovery continues while GitHub Actions is unavailable. Chains and OpenStreetMap stay blocked.
  const webOnly = sources.size === 1 && sources.has("web");
  const small = webOnly || ((!sources.has("chains") || (onlyChains.length > 0 && onlyChains.length <= 3)) && (!sources.has("web") || !process.env.BRAVE_SEARCH_API_KEY));
  if (!small) {
    console.error("Blocked on this machine: statewide Florida discovery runs on GitHub Actions (discover-florida.yml).");
    console.error("Locally only a correctness test is allowed: --sources=chains --chains=<at most three ids>, or --sources=osm.");
    process.exit(1);
  }
}

mkdirSync(outDir, { recursive: true });
const write = (file: string, data: unknown) => writeFileSync(join(outDir, file), JSON.stringify(data, null, 1) + "\n");
const summaryPath = join(outDir, "florida-summary.json");
const summary: Record<string, unknown> = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, "utf8")) : {};
const count = (list: Candidate[], key: "kind" | "city" | "activity") => {
  const m: Record<string, number> = {};
  for (const c of list) m[c[key] || "?"] = (m[c[key] || "?"] || 0) + 1;
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
};

const started = Date.now();

if (sources.has("chains")) {
  const list = onlyChains.length ? CHAINS.filter((c) => onlyChains.includes(c.id)) : CHAINS;
  const missing = onlyChains.filter((id) => !CHAINS.some((c) => c.id === id));
  if (missing.length) console.error("unknown chain ids: " + missing.join(", "));
  console.log(`chains: ${list.length} brands`);
  const results = await runChains(list);
  // Merge into the previous file: brands not run this time keep their rows, and a brand whose site failed
  // (zero parsed) keeps last run's rows instead of vanishing from the catalog because of one bad afternoon.
  const prevPath = join(outDir, "florida-chains.json");
  const prev: Candidate[] = existsSync(prevPath) ? JSON.parse(readFileSync(prevPath, "utf8")) : [];
  const ran = new Set(results.filter((r) => r.florida > 0).map((r) => r.id));
  const kept = prev.filter((c) => !ran.has(c.domain.replace(/^chain-/, "").split("-")[0]) && CHAINS.some((ch) => c.domain.startsWith(`chain-${ch.id}-`)));
  const candidates = dedupeCandidates([...results.flatMap((r) => r.candidates), ...kept]);
  write("florida-chains.json", candidates);
  summary.chains = {
    at: new Date().toISOString(),
    brands: list.length,
    candidates: candidates.length,
    perChain: Object.fromEntries(results.map((r) => [r.id, { brand: r.brand, florida: r.florida, fetches: r.pages, ...(r.note ? { note: r.note } : {}) }])),
    byKind: count(candidates, "kind"),
  };
  console.log(`chains: ${candidates.length} Florida locations`);
}

if (sources.has("osm")) {
  try {
    const { elements, requests } = await fetchFloridaByName();
    const { candidates, matched, dropped } = candidatesFromElements(elements);
    write("florida-osm.json", candidates);
    summary.osm = { at: new Date().toISOString(), requests, elements: elements.length, matched, dropped, candidates: candidates.length, byActivity: count(candidates, "activity") };
    console.log(`osm: ${elements.length} named elements from ${requests} request(s), ${candidates.length} candidates, ${dropped} dropped`);
  } catch (e) {
    console.error("osm: Overpass failed, keeping the previous file: " + (e as Error).message);
    summary.osm = { ...((summary.osm as object) || {}), lastError: (e as Error).message.slice(0, 200), lastErrorAt: new Date().toISOString() };
  }
}

if (sources.has("web")) {
  const statePath = join(outDir, "brave-queries.json");
  const state: BraveState = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { queries: {} };
  const run = await refreshBrave(state, { key: process.env.BRAVE_SEARCH_API_KEY, budget: braveBudget });
  if (!run.skipped) writeFileSync(statePath, JSON.stringify(state) + "\n");
  const { candidates, considered, dropped } = candidatesFromBrave(state);
  if (Object.keys(state.queries).length) write("florida-web.json", candidates);
  summary.web = { at: new Date().toISOString(), ...run, answered: Object.keys(state.queries).length, considered, dropped, candidates: candidates.length, byActivity: count(candidates, "activity") };
  console.log(`web: ${run.skipped ? "skipped" : run.spent + " queries spent"}, ${candidates.length} candidates from ${Object.keys(state.queries).length} answered queries`);
}

write("florida-summary.json", summary);
console.log(`done in ${Math.round((Date.now() - started) / 1000)}s; files in ${outDir}`);
process.exit(0);
