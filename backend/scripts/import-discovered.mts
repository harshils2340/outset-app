import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DROP_HOSTS } from "../src/discover/braveapi.ts";
import { hostOf, type Candidate } from "../src/discover/chains.ts";
import { CITIES } from "../src/discover/cities.ts";
import { FL_DESTINATIONS, kmBetween } from "../src/discover/florida.ts";
import type { PlaceCandidate } from "../src/discover/places.ts";
import { METROS, categoryById, nearestMetro, type MetroDef } from "../src/taxonomy/catalog.ts";

/**
 * Imports every candidate file under backend/data/discovered/ into the operators table.
 *
 * Candidate files are written by jobs that never open the database:
 *   florida-{chains,osm,web}.json   scripts/discover-florida-ci.mts on a GitHub runner (Candidate shape, region FL)
 *   places-<metro>.json             src/discover/places.ts, Google Places Text Search per metro, US and Canada
 *                                   (PlaceCandidate: the Candidate shape plus country, rating, place id, query)
 * Anything else in the directory (brave-queries.json, florida-summary.json) is not a candidate file and is skipped.
 *
 * Runs on a machine that has the database (Render or the laptop; it makes no network requests). Reads the files
 * most precise first (chains, osm, web, places) and inserts only candidates that are not already an operator.
 * "Already" means any of: the same domain, the same website, the same website host, the same OpenStreetMap
 * element, the same phone, the same name in the same city, the same name within about 2 km, or, for a chain
 * location, a row of the same brand within about a kilometre (or in the same city when either side has no pin).
 * Two candidates for one business inside a run are caught the same way. Existing rows are never modified.
 *
 * A search result (web, places) must carry the operator's own website: a business we cannot read is not a
 * listing. OpenStreetMap and chain rows may lack one, the way discover/osm.ts writes them. Any website on an
 * aggregator, directory or social host (braveapi.ts DROP_HOSTS, judged with a Canadian suffix swapped for .com
 * as well) is rejected whatever the source.
 *
 * New rows are shaped like the rows discovery already writes (osm.ts, searchapi.ts upsertPlace): unclaimed,
 * request-only, category, family and icon from the taxonomy, region and country from the candidate, and the
 * metro the way searchapi.ts placeToOperator assigns one: the nearest metro within 160 km of the candidate's pin,
 * else of the centre of the city the query ran from (the Florida destination for a Brave hit, the metro named in
 * the file for a Places hit, else the CITIES grid entry for the candidate's city and region). Origin keeps the
 * rows apart: chain, osm and search for the Florida files, places for Google Places files.
 *
 *   npx tsx scripts/import-discovered.mts                    # dry run: counts, rejections, nothing written
 *   npx tsx scripts/import-discovered.mts --write            # insert
 *   options: --dir=data/discovered  --source=chains,osm,web,places  (--sources= and --dry still accepted)
 */

export type FileSource = "chains" | "osm" | "web" | "places";
const SOURCE_ORDER: FileSource[] = ["chains", "osm", "web", "places"];

/** What a candidate file is, read from its name. */
export type FileMeta = {
  file: string;
  /** Which job wrote it; also the --source filter value. */
  source: FileSource;
  /** "florida" or "places": the discovery job, used in the source citation. */
  job: "florida" | "places";
  /** The metro the queries ran from, for places-<metro>.json. */
  metro: MetroDef | null;
};

/** Any candidate a file can hold. Florida files carry the plain Candidate; Places files add country and rating. */
export type AnyCandidate = Omit<Candidate, "region"> & Partial<Pick<PlaceCandidate, "country" | "rating" | "reviewCount" | "placeId" | "query">> & { region: string | null };

/** The operator row a candidate becomes. Region and country are the candidate's; metro is nearest within 160 km. */
export type MappedRow = {
  domain: string; name: string; website: string | null; phone: string | null; street: string | null; postal: string | null;
  metro_id: string | null; city: string | null; region: string; country: "US" | "CA"; family: string; category_id: string;
  icon_key: string; origin: string; lat: number | null; lon: number | null; osm_ref: string | null;
  source_url: string; extractor: string; note: string | null;
};

const CA_REGIONS = new Set(["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"]);
/** Origin per Florida source, unchanged from the first version of this script. Places rows get "places". */
const ORIGIN: Record<Candidate["source"], string> = { chain: "chain", osm: "osm", web: "search" };

export function parseFileName(file: string): FileMeta | null {
  const name = basename(file);
  const fl = name.match(/^florida-(chains|osm|web)\.json$/);
  if (fl) return { file, source: fl[1] as FileSource, job: "florida", metro: null };
  const pl = name.match(/^places-([a-z0-9-]+)\.json$/);
  if (pl) {
    const metro = METROS.find((m) => m.id === pl[1]) || null;
    return { file, source: "places", job: "places", metro };
  }
  return null;
}

/** Candidate files in a directory, most precise source first, optionally only some sources. */
export function listCandidateFiles(dir: string, sources?: string[]): { files: FileMeta[]; skipped: string[] } {
  const want = (sources || []).map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (const w of want) if (!SOURCE_ORDER.includes(w as FileSource)) throw new Error(`unknown --source ${w}; known: ${SOURCE_ORDER.join(", ")}`);
  const files: FileMeta[] = [];
  const skipped: string[] = [];
  if (!existsSync(dir)) return { files, skipped };
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".json")) continue;
    const meta = parseFileName(join(dir, name));
    if (!meta) { skipped.push(name); continue; }
    if (want.length && !want.includes(meta.source)) continue;
    files.push(meta);
  }
  files.sort((a, b) => SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source) || a.file.localeCompare(b.file));
  return { files, skipped };
}

const norm = (s: string | null | undefined) => (s || "").toLowerCase().replace(/&/g, " and ").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const brandKey = (s: string) => norm(s).split(" ").filter((w) => w.length > 2 && !/^(the|and)$/.test(w)).slice(0, 2).join(" ");
const siteKey = (u: string | null | undefined) => (u || "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
const osmRefOf = (c: AnyCandidate): string | null => {
  const m = (c.sourceUrl || "").match(/openstreetmap\.org\/(node|way|relation)\/(\d+)/);
  return m ? `${m[1]}/${m[2]}` : null;
};

/** DROP_HOSTS ends in a US-centric suffix list; tripadvisor.ca and yelp.ca are the same directories. */
export function isAggregatorHost(host: string): boolean {
  const asCom = host.replace(/\.(co\.)?[a-z]{2,3}$/i, ".com");
  return DROP_HOSTS.test(host) || DROP_HOSTS.test(asCom);
}

export type KnownRow = { domain: string; name: string; website: string | null; phone: string | null; city: string | null; lat: number | null; lon: number | null; osm_ref?: string | null };
type Pin = { name: string; brand: string; lat: number; lon: number };

/**
 * Everything the operators table already has, indexed for the "already known" test. Fed from the database when the
 * script runs, from hand-written rows in tests. remember() adds each accepted candidate so a run cannot insert one
 * business twice.
 */
export class KnownIndex {
  private byDomain = new Set<string>();
  private bySite = new Set<string>();
  private byHost = new Set<string>();
  private byOsm = new Set<string>();
  private byPhone = new Set<string>();
  private byNameCity = new Set<string>();
  private brandCity = new Set<string>();
  /** Pins bucketed by a 0.05 degree cell so a candidate compares against its neighbourhood, not 140,000 rows. */
  private cells = new Map<string, Pin[]>();

  private static cell(lat: number, lon: number): string {
    return `${Math.floor(lat / 0.05)}:${Math.floor(lon / 0.05)}`;
  }

  remember(r: KnownRow): void {
    this.byDomain.add(r.domain);
    if (r.website) this.bySite.add(siteKey(r.website));
    if (r.website && !r.domain.startsWith("chain-")) {
      const h = hostOf(r.website);
      if (h) this.byHost.add(h);
    }
    if (r.osm_ref) this.byOsm.add(r.osm_ref);
    if (r.phone) this.byPhone.add(r.phone);
    if (r.city) this.byNameCity.add(norm(r.name) + "|" + norm(r.city));
    if (r.lat != null && r.lon != null) this.pin({ name: norm(r.name), brand: brandKey(r.name), lat: r.lat, lon: r.lon });
    if (r.city) this.brandCity.add(brandKey(r.name) + "|" + norm(r.city));
  }

  /** A chain branch already attached to an operator (locations table). */
  rememberLocation(l: { name: string; city: string | null; lat: number; lon: number }): void {
    this.pin({ name: norm(l.name), brand: brandKey(l.name), lat: l.lat, lon: l.lon });
    if (l.city) this.brandCity.add(brandKey(l.name) + "|" + norm(l.city));
  }

  private pin(p: Pin): void {
    const k = KnownIndex.cell(p.lat, p.lon);
    const list = this.cells.get(k);
    if (list) list.push(p);
    else this.cells.set(k, [p]);
  }

  private near(lat: number, lon: number): Pin[] {
    const out: Pin[] = [];
    const cy = Math.floor(lat / 0.05);
    const cx = Math.floor(lon / 0.05);
    for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) {
      const list = this.cells.get(`${y}:${x}`);
      if (list) out.push(...list);
    }
    return out;
  }

  whyKnown(c: AnyCandidate): string | null {
    if (this.byDomain.has(c.domain)) return "domain";
    const host = hostOf(c.website);
    if (c.source !== "chain" && host && this.byDomain.has(host)) return "domain";
    if (c.website && c.source !== "web" && this.bySite.has(siteKey(c.website))) return "website";
    if (c.source !== "chain" && host && this.byHost.has(host)) return "website host";
    const osm = osmRefOf(c);
    if (osm && this.byOsm.has(osm)) return "osm element";
    if (c.phone && this.byPhone.has(c.phone)) return "phone";
    if (c.city && this.byNameCity.has(norm(c.name) + "|" + norm(c.city))) return "name and city";
    if (c.lat != null && c.lon != null) {
      const n = norm(c.name);
      const b = c.brand ? brandKey(c.brand) : null;
      for (const p of this.near(c.lat, c.lon)) {
        if (Math.abs(p.lat - c.lat) > 0.03 || Math.abs(p.lon - c.lon) > 0.03) continue;
        const km = kmBetween(p.lat, p.lon, c.lat, c.lon);
        if (p.name === n && km < 2) return "name nearby";
        if (b && p.brand === b && km < 1.2) return "same brand nearby";
        if (km < 0.15 && (p.brand === brandKey(c.name) || p.name.includes(n) || n.includes(p.name))) return "same place";
      }
    } else if (c.brand && c.city && this.brandCity.has(brandKey(c.brand) + "|" + norm(c.city))) {
      return "same brand in city";
    }
    return null;
  }
}

/**
 * The centre of the city a pin-less candidate was searched from: the Florida destination for a Brave hit, the metro
 * named in a places file, else the CITIES grid entry for the candidate's city and region.
 */
export function queryCentre(c: AnyCandidate, meta: Pick<FileMeta, "job" | "metro">): { lat: number; lon: number } | null {
  if (meta.job === "florida" && c.city) {
    const d = FL_DESTINATIONS.find((x) => x.name === c.city);
    if (d) return d;
  }
  if (meta.metro) return meta.metro;
  const city = c.city ? CITIES.find((x) => x.name.toLowerCase() === c.city!.toLowerCase() && (!c.region || x.region === c.region)) : null;
  return city || null;
}

/** Same rule as searchapi.ts placeToOperator: nearest metro within 160 km of the pin, else of the query city's centre. */
export function metroFor(c: AnyCandidate, meta: Pick<FileMeta, "job" | "metro">): MetroDef | null {
  if (c.lat != null && c.lon != null) return nearestMetro(c.lat, c.lon, 160);
  const centre = queryCentre(c, meta);
  return centre ? nearestMetro(centre.lat, centre.lon, 160) : null;
}

export function countryOf(c: AnyCandidate, metro: MetroDef | null): "US" | "CA" {
  if (c.country === "US" || c.country === "CA") return c.country;
  if (c.region && CA_REGIONS.has(c.region.toUpperCase())) return "CA";
  if (c.region) return "US";
  return metro?.country || "US";
}

/** One candidate to a row, or the reason it is rejected. Pure: no database. Does not consult the known index. */
export function mapCandidate(c: AnyCandidate, meta: FileMeta): { row: MappedRow } | { reject: string } {
  if (!c || typeof c !== "object") return { reject: "not a candidate" };
  const cat = c.kind ? categoryById(c.kind) : undefined;
  if (!cat) return { reject: "unknown kind" };
  if (!c.name || c.name.trim().length < 3) return { reject: "no usable name" };
  if (!c.domain) return { reject: "no domain" };
  if (!c.region || !/^[A-Za-z]{2}$/.test(c.region.trim())) return { reject: "no region" };
  if (!c.sourceUrl) return { reject: "no source url" };
  const host = hostOf(c.website);
  if (c.website && !host) return { reject: "bad website url" };
  if (c.source === "web" && !host) return { reject: "website required" };
  if (host && isAggregatorHost(host)) return { reject: "aggregator, directory or social host" };
  const metro = metroFor(c, meta);
  const lat = c.lat ?? null;
  const lon = c.lon ?? null;
  const origin = meta.job === "places" ? "places" : ORIGIN[c.source];
  return {
    row: {
      domain: c.domain, name: c.name.trim().slice(0, 120), website: c.website || null, phone: c.phone || null, street: c.street || null,
      postal: c.postal || null, metro_id: metro?.id || null, city: c.city || null, region: c.region.trim().toUpperCase(),
      country: countryOf(c, metro), family: cat.family, category_id: cat.id, icon_key: cat.iconKey, origin, lat, lon,
      osm_ref: osmRefOf(c), source_url: c.sourceUrl, extractor: `discover-${meta.job}:${c.source}`, note: c.activity || null,
    },
  };
}

export type ImportStats = {
  read: number;
  inserted: number;
  known: Record<string, number>;
  rejected: Record<string, number>;
  perFile: { file: string; source: FileSource; candidates: number; added: number }[];
  bySource: Record<string, number>;
  byOrigin: Record<string, number>;
  byKind: Record<string, number>;
  byActivity: Record<string, number>;
  byCity: Record<string, number>;
  byMetro: Record<string, number>;
};

const bump = (m: Record<string, number>, k: string) => void (m[k] = (m[k] || 0) + 1);

/**
 * Runs the mapper over the given files against a known index. `insert` is called for each accepted row when
 * given; a dry run passes none. Returns the stats and, so a dry run can be inspected, every accepted row.
 */
export function importFiles(
  files: FileMeta[],
  known: KnownIndex,
  opts: { insert?: (row: MappedRow) => void; log?: (m: string) => void } = {},
): { stats: ImportStats; rows: MappedRow[] } {
  const log = opts.log || (() => {});
  const stats: ImportStats = { read: 0, inserted: 0, known: {}, rejected: {}, perFile: [], bySource: {}, byOrigin: {}, byKind: {}, byActivity: {}, byCity: {}, byMetro: {} };
  const rows: MappedRow[] = [];
  for (const meta of files) {
    let list: AnyCandidate[];
    try {
      const parsed = JSON.parse(readFileSync(meta.file, "utf8")) as unknown;
      if (!Array.isArray(parsed)) { log(`${basename(meta.file)}: not a list, skipped`); continue; }
      list = parsed as AnyCandidate[];
    } catch (e) {
      log(`${basename(meta.file)}: unreadable (${(e as Error).message}), skipped`);
      continue;
    }
    let added = 0;
    for (const c of list) {
      stats.read += 1;
      const mapped = mapCandidate(c, meta);
      if ("reject" in mapped) { bump(stats.rejected, mapped.reject); continue; }
      const why = known.whyKnown(c);
      if (why) { bump(stats.known, why); continue; }
      const r = mapped.row;
      if (opts.insert) opts.insert(r);
      known.remember({ domain: r.domain, name: r.name, website: r.website, phone: r.phone, city: r.city, lat: r.lat, lon: r.lon, osm_ref: r.osm_ref });
      rows.push(r);
      stats.inserted += 1;
      added += 1;
      bump(stats.bySource, meta.source);
      bump(stats.byOrigin, r.origin);
      bump(stats.byKind, r.category_id);
      bump(stats.byActivity, r.note || r.category_id);
      bump(stats.byCity, r.city ? `${r.city}, ${r.region}` : `(no city), ${r.region}`);
      bump(stats.byMetro, r.metro_id || "(no metro within 160 km)");
    }
    stats.perFile.push({ file: basename(meta.file), source: meta.source, candidates: list.length, added });
    log(`${basename(meta.file)}: ${list.length} candidates, ${added} new`);
  }
  return { stats, rows };
}

const table = (m: Record<string, number>, limit = 60) =>
  Object.entries(m)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k, v]) => `  ${String(v).padStart(5)}  ${k}`)
    .join("\n") || "  (none)";

/** Every stat block the command prints, so the test can check the shape of a dry run without a database. */
export function report(stats: ImportStats, dry: boolean): string {
  return [
    `${dry ? "DRY RUN, nothing written. " : ""}${stats.read} candidates read, ${stats.inserted} ${dry ? "would be inserted" : "inserted"}, ${Object.values(stats.rejected).reduce((a, b) => a + b, 0)} rejected`,
    "rejected, by reason:\n" + table(stats.rejected),
    "already known, by match:\n" + table(stats.known),
    "new by source:\n" + table(stats.bySource),
    "new by origin:\n" + table(stats.byOrigin),
    "new by metro:\n" + table(stats.byMetro),
    "new by kind:\n" + table(stats.byKind),
    "new by activity:\n" + table(stats.byActivity),
    "new by city (top 60):\n" + table(stats.byCity),
  ].join("\n");
}

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const backend = join(here, "..");
  const arg = (name: string, fallback: string): string => {
    const a = process.argv.find((x) => x.startsWith("--" + name + "="));
    return a ? a.split("=").slice(1).join("=") : fallback;
  };
  const write = process.argv.includes("--write");
  const dry = !write || process.argv.includes("--dry");
  const dir = resolve(backend, arg("dir", "data/discovered"));
  const sourceArg = arg("source", arg("sources", ""));
  const { files, skipped } = listCandidateFiles(dir, sourceArg ? sourceArg.split(",") : undefined);
  for (const s of skipped) console.log(`${s}: not a candidate file, skipped`);
  if (!files.length) {
    console.log(`no candidate files in ${dir}${sourceArg ? ` for --source=${sourceArg}` : ""}`);
    return;
  }

  const { db, nowIso } = await import("../src/db/client.ts");
  const known = new KnownIndex();
  // Every operator anywhere, loaded once: per-candidate queries over 140,000 rows would take minutes.
  const rows = db.prepare("SELECT domain, name, website, phone, city, lat, lon, osm_ref FROM operators").all() as KnownRow[];
  for (const r of rows) known.remember(r);
  const locs = db
    .prepare("SELECT o.name, l.city, l.lat, l.lon FROM locations l JOIN operators o ON o.id = l.operator_id WHERE l.lat IS NOT NULL AND l.lon IS NOT NULL")
    .all() as { name: string; city: string | null; lat: number; lon: number }[];
  for (const l of locs) known.rememberLocation(l);

  const insertRow = db.prepare(
    `INSERT INTO operators (
      id, domain, name, website, phone, street, postal, metro_id, city, region, country, family, category_id, icon_key,
      claim_status, booking_mode, origin, completeness, lat, lon, osm_ref, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unclaimed', 'request', ?, 0, ?, ?, ?, ?, ?)`,
  );
  const cite = db.prepare(
    "INSERT INTO sources (id, operator_id, url, fetched_at, http_status, extractor, robots_allowed, note) VALUES (?, ?, ?, ?, NULL, ?, 1, ?)",
  );
  const insert = (r: MappedRow) => {
    const id = randomUUID();
    const now = nowIso();
    insertRow.run(
      id, r.domain, r.name, r.website, r.phone, r.street, r.postal, r.metro_id, r.city, r.region, r.country, r.family, r.category_id,
      r.icon_key, r.origin, r.lat, r.lon, r.osm_ref, now, now,
    );
    cite.run(randomUUID(), id, r.source_url, now, r.extractor, r.note);
  };

  if (!dry) db.exec("BEGIN");
  let stats: ImportStats;
  try {
    stats = importFiles(files, known, { insert: dry ? undefined : insert, log: console.log }).stats;
    if (!dry) db.exec("COMMIT");
  } catch (e) {
    if (!dry) db.exec("ROLLBACK");
    throw e;
  }
  console.log("\n" + report(stats, dry));
  if (dry) console.log("\nrerun with --write to insert.");
}

const invokedDirectly = !!process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) await main();
