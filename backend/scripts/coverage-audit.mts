import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Coverage audit: every activity in the taxonomy crossed with every metro. No network.
 *
 * For each pair it counts what a guest can see (public/catalog.json, non-thin) and what the database holds
 * (operators by metro and icon key), then ranks the gaps. The rank answers "where does a guest searching
 * '<activity> in <city>' get nothing, in a city where that would be noticed?":
 *
 *   prevalence(activity) = the activity's share of published listings in its third best-covered big metro
 *                          (at least 200 published), floored by its share of the whole database
 *   expected(pair)       = prevalence(activity) x published listings in that metro
 *   want(pair)           = min(24, max(expected, page floor)), a page of results, and at least a dozen in a
 *                          big metro (floor = min(12, metro published / 60)) since Google Maps shows a page
 *                          for almost any "<activity> in <big city>"
 *   deficit(pair)        = want - published, when positive
 *   score(pair)          = deficit x metro published listings
 *
 * The metro's published total is the weight, so an empty activity in Toronto outranks the same one in Kelowna,
 * and an activity with nothing at all outranks one that is merely under the benchmark.
 * The benchmark is our own best-covered cities rather than the catalog average, because the average is what
 * OpenStreetMap tags well (campgrounds, museums, golf) and says nothing about what Google Maps shows for
 * "cooking classes": the one metro where a web search ran for cooking is the honest yardstick for the rest.
 *
 *   npx tsx scripts/coverage-audit.mts                  # every metro, top 20
 *   npx tsx scripts/coverage-audit.mts --metro=toronto  # one metro
 *   npx tsx scripts/coverage-audit.mts --top=40
 *
 * Writes backend/data/coverage-audit.csv (every pair, unfiltered) each run.
 */

const here = dirname(fileURLToPath(import.meta.url));
const backend = join(here, "..");
const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith("--" + name + "="))?.split("=").slice(1).join("=");
const onlyMetro = arg("metro")?.toLowerCase();
const top = Number(arg("top") || 20);

const { db } = await import("../src/db/client.ts");
const { CATEGORIES, METROS } = await import("../src/taxonomy/catalog.ts");

type Op = { id: string; title: string; art: string; metroId?: string; thin?: true };
const catalog = JSON.parse(readFileSync(join(backend, "../public/catalog.json"), "utf8")) as { operators: Op[] };

/** One activity per icon key (the guest's ArtKind). Paddleboard shares kayak's art, so it folds in. */
const activities: { art: string; label: string; query: string }[] = [];
for (const c of CATEGORIES) if (!activities.some((a) => a.art === c.iconKey)) activities.push({ art: c.iconKey, label: c.label, query: c.searchQuery });

const key = (metro: string, art: string) => metro + "|" + art;
const published = new Map<string, number>();
const publishedThin = new Map<string, number>();
const metroPublished = new Map<string, number>();
let publishedTotal = 0;
for (const o of catalog.operators) {
  if (!o.metroId) continue;
  if (o.thin) {
    publishedThin.set(key(o.metroId, o.art), (publishedThin.get(key(o.metroId, o.art)) || 0) + 1);
    continue;
  }
  publishedTotal++;
  published.set(key(o.metroId, o.art), (published.get(key(o.metroId, o.art)) || 0) + 1);
  metroPublished.set(o.metroId, (metroPublished.get(o.metroId) || 0) + 1);
}

const dbRows = db.prepare("SELECT metro_id AS metro, icon_key AS art, COUNT(*) AS n FROM operators WHERE metro_id IS NOT NULL GROUP BY 1, 2").all() as { metro: string; art: string; n: number }[];
const dbCount = new Map<string, number>();
const artDb = new Map<string, number>();
let dbTotal = 0;
for (const r of dbRows) {
  dbCount.set(key(r.metro, r.art), r.n);
  artDb.set(r.art, (artDb.get(r.art) || 0) + r.n);
  dbTotal += r.n;
}

/** Benchmark share per activity: third-highest share among metros with at least 200 published listings. */
const benchmark = new Map<string, number>();
for (const a of activities) {
  const shares = METROS.map((m) => (metroPublished.get(m.id) || 0) >= 200 ? (published.get(key(m.id, a.art)) || 0) / (metroPublished.get(m.id) || 1) : -1)
    .filter((x) => x >= 0).sort((x, y) => y - x);
  benchmark.set(a.art, shares[Math.min(2, shares.length - 1)] || 0);
}

type Row = {
  metro: string; metroName: string; art: string; label: string; query: string;
  published: number; publishedThin: number; dbOperators: number; metroPublished: number; expected: number; want: number; deficit: number; score: number;
};
const rows: Row[] = [];
for (const m of METROS) {
  const weight = metroPublished.get(m.id) || 0;
  for (const a of activities) {
    const prevalence = Math.max(benchmark.get(a.art) || 0, (artDb.get(a.art) || 0) / Math.max(dbTotal, 1));
    const pub = published.get(key(m.id, a.art)) || 0;
    const expected = prevalence * weight;
    const want = Math.min(24, Math.max(expected, Math.min(12, weight / 60)));
    const deficit = Math.max(0, Math.round((want - pub) * 10) / 10);
    rows.push({
      metro: m.id, metroName: m.name + ", " + m.region, art: a.art, label: a.label, query: a.query,
      published: pub, publishedThin: publishedThin.get(key(m.id, a.art)) || 0, dbOperators: dbCount.get(key(m.id, a.art)) || 0,
      metroPublished: weight, expected: Math.round(expected * 10) / 10, want: Math.round(want * 10) / 10, deficit, score: Math.round(deficit * weight),
    });
  }
}

const csvCell = (v: string | number) => (typeof v === "number" ? String(v) : /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
const header = ["metro", "metroName", "activity", "label", "searchQuery", "published", "publishedThin", "dbOperators", "metroPublished", "expected", "want", "deficit", "score"];
const csv = [header.join(",")]
  .concat(rows.map((r) => [r.metro, r.metroName, r.art, r.label, r.query, r.published, r.publishedThin, r.dbOperators, r.metroPublished, r.expected, r.want, r.deficit, r.score].map(csvCell).join(",")))
  .join("\n");
const csvPath = join(backend, "data/coverage-audit.csv");
writeFileSync(csvPath, csv + "\n");

const ranked = rows.filter((r) => (!onlyMetro || r.metro === onlyMetro) && r.deficit > 0).sort((a, b) => b.score - a.score || b.expected - a.expected);
const pad = (s: string | number, n: number, right = false) => (right ? String(s).padStart(n) : String(s).padEnd(n));
console.log(`${publishedTotal.toLocaleString()} published non-thin listings with a metro, ${dbTotal.toLocaleString()} database operators with a metro, ${activities.length} activities x ${METROS.length} metros. CSV: ${csvPath}`);
console.log(`\nWorst gaps${onlyMetro ? " in " + onlyMetro : ""} (top ${top}), score = missing listings up to a page x metro size:`);
console.log(pad("metro", 16) + pad("activity", 14) + pad("published", 10, true) + pad("thin", 6, true) + pad("in db", 7, true) + pad("metro pub", 10, true) + pad("expected", 9, true) + pad("want", 6, true) + pad("deficit", 8, true) + pad("score", 7, true) + "  query");
for (const r of ranked.slice(0, top)) {
  console.log(pad(r.metro, 16) + pad(r.art, 14) + pad(r.published, 10, true) + pad(r.publishedThin, 6, true) + pad(r.dbOperators, 7, true) + pad(r.metroPublished, 10, true) + pad(r.expected, 9, true) + pad(r.want, 6, true) + pad(r.deficit, 8, true) + pad(r.score, 7, true) + "  " + r.query);
}
const zero = rows.filter((r) => (!onlyMetro || r.metro === onlyMetro) && r.published === 0);
console.log(`\n${zero.length} of ${rows.filter((r) => !onlyMetro || r.metro === onlyMetro).length} pairs have no published listing at all; ${zero.filter((r) => r.dbOperators > 0).length} of those already have operators in the database waiting on the crawl.`);
