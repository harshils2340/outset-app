import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Candidate } from "../src/discover/chains.ts";
import { FL_DESTINATIONS, kmBetween } from "../src/discover/florida.ts";

/**
 * Imports what scripts/discover-florida-ci.mts found on a GitHub runner.
 *
 * Runs on a machine that has the database (Render or the laptop; it makes no network requests). Reads
 * backend/data/discovered/florida-chains.json, florida-osm.json and florida-web.json in that order, most
 * precise first, and inserts only candidates that are not already an operator. "Already" means any of:
 * the same domain, the same website, the same OpenStreetMap element, the same phone, the same name in the
 * same city, the same name within about 2 km, or, for a chain location, a row of the same brand within
 * about a kilometre (or in the same city when either side has no pin). Existing rows are never modified.
 *
 * New rows are shaped like the rows discovery already writes (osm.ts, searchapi.ts upsertPlace): unclaimed,
 * request-only, category, family and icon from the taxonomy, metro = nearest within 160 km.
 *
 *   npx tsx scripts/import-discovered.mts --dry            # counts only, writes nothing
 *   npx tsx scripts/import-discovered.mts                  # insert
 *   options: --dir=data/discovered  --sources=chains,osm,web
 */

const here = dirname(fileURLToPath(import.meta.url));
const backend = join(here, "..");
const arg = (name: string, fallback: string): string => {
  const a = process.argv.find((x) => x.startsWith("--" + name + "="));
  return a ? a.split("=").slice(1).join("=") : fallback;
};
const dry = process.argv.includes("--dry");
const dir = resolve(backend, arg("dir", "data/discovered"));
const sources = arg("sources", "chains,osm,web").split(",").map((s) => s.trim()).filter(Boolean);

const { db, nowIso } = await import("../src/db/client.ts");
const { categoryById, nearestMetro } = await import("../src/taxonomy/catalog.ts");

const ORIGIN: Record<Candidate["source"], string> = { chain: "chain", osm: "osm", web: "search" };

const norm = (s: string | null | undefined) => (s || "").toLowerCase().replace(/&/g, " and ").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const brandKey = (s: string) => norm(s).split(" ").filter((w) => w.length > 2 && !/^(the|and)$/.test(w)).slice(0, 2).join(" ");
const hostOf = (u: string | null | undefined) => {
  if (!u) return null;
  try {
    return new URL(u.startsWith("http") ? u : "https://" + u).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
};
const siteKey = (u: string | null | undefined) => (u || "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "");

type Row = { id: string; domain: string; name: string; website: string | null; phone: string | null; city: string | null; lat: number | null; lon: number | null; osm_ref: string | null };

// Every Florida-ish row, loaded once: a statewide import is thousands of candidates, and per-candidate LIKE
// queries over 140,000 operators would take minutes. Florida by region, or by pin inside the state's box.
const rows = db
  .prepare(
    `SELECT id, domain, name, website, phone, city, lat, lon, osm_ref FROM operators
      WHERE region IN ('FL', 'Florida') OR (lat BETWEEN 24.3 AND 31.1 AND lon BETWEEN -87.7 AND -79.8)`,
  )
  .all() as Row[];
const byDomain = new Set((db.prepare("SELECT domain FROM operators").all() as { domain: string }[]).map((r) => r.domain));
const bySite = new Set<string>();
// Hosts of every operator website anywhere, so an independent's site found by name or search is known even
// when its row sits under an OSM or Google id.
const byHost = new Set(
  (db.prepare("SELECT website FROM operators WHERE website IS NOT NULL AND website != ''").all() as { website: string }[]).map((r) => hostOf(r.website)).filter((h): h is string => !!h),
);
const byOsm = new Set<string>();
const byPhone = new Set<string>();
const byNameCity = new Set<string>();
const pins: { name: string; brand: string; lat: number; lon: number }[] = [];
const brandCity = new Set<string>();

const remember = (r: { domain: string; name: string; website: string | null; phone: string | null; city: string | null; lat: number | null; lon: number | null; osm_ref?: string | null }) => {
  byDomain.add(r.domain);
  if (r.website) bySite.add(siteKey(r.website));
  if (r.website && !r.domain.startsWith("chain-")) byHost.add(hostOf(r.website) || "");
  if (r.osm_ref) byOsm.add(r.osm_ref);
  if (r.phone) byPhone.add(r.phone);
  if (r.city) byNameCity.add(norm(r.name) + "|" + norm(r.city));
  if (r.lat != null && r.lon != null) pins.push({ name: norm(r.name), brand: brandKey(r.name), lat: r.lat, lon: r.lon });
  if (r.city) brandCity.add(brandKey(r.name) + "|" + norm(r.city));
};
for (const r of rows) remember(r);
// Chain branches already attached to an operator (locations table) count as known too.
const locs = db
  .prepare(`SELECT o.name, l.city, l.lat, l.lon FROM locations l JOIN operators o ON o.id = l.operator_id WHERE l.region IN ('FL', 'Florida') OR (l.lat BETWEEN 24.3 AND 31.1 AND l.lon BETWEEN -87.7 AND -79.8)`)
  .all() as { name: string; city: string | null; lat: number; lon: number }[];
for (const l of locs) {
  pins.push({ name: norm(l.name), brand: brandKey(l.name), lat: l.lat, lon: l.lon });
  if (l.city) brandCity.add(brandKey(l.name) + "|" + norm(l.city));
}

function whyKnown(c: Candidate): string | null {
  if (byDomain.has(c.domain)) return "domain";
  if (c.source !== "chain" && c.website && byDomain.has(hostOf(c.website) || "")) return "domain";
  if (c.website && c.source !== "web" && bySite.has(siteKey(c.website))) return "website";
  if (c.source !== "chain" && c.website && byHost.has(hostOf(c.website) || "")) return "website host";
  const osm = c.sourceUrl.match(/openstreetmap\.org\/(node|way|relation)\/(\d+)/);
  if (osm && byOsm.has(`${osm[1]}/${osm[2]}`)) return "osm element";
  if (c.phone && byPhone.has(c.phone)) return "phone";
  if (c.city && byNameCity.has(norm(c.name) + "|" + norm(c.city))) return "name and city";
  if (c.lat != null && c.lon != null) {
    const n = norm(c.name);
    const b = c.brand ? brandKey(c.brand) : null;
    for (const p of pins) {
      if (Math.abs(p.lat - c.lat) > 0.03 || Math.abs(p.lon - c.lon) > 0.03) continue;
      const km = kmBetween(p.lat, p.lon, c.lat, c.lon);
      if (p.name === n && km < 2) return "name nearby";
      if (b && p.brand === b && km < 1.2) return "same brand nearby";
      if (km < 0.15 && (p.brand === brandKey(c.name) || p.name.includes(n) || n.includes(p.name))) return "same place";
    }
  } else if (c.brand && c.city && brandCity.has(brandKey(c.brand) + "|" + norm(c.city))) {
    return "same brand in city";
  }
  return null;
}

const insert = db.prepare(
  `INSERT INTO operators (
    id, domain, name, website, phone, street, postal, metro_id, city, region, country, family, category_id, icon_key,
    claim_status, booking_mode, origin, completeness, lat, lon, osm_ref, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'FL', 'US', ?, ?, ?, 'unclaimed', 'request', ?, 0, ?, ?, ?, ?, ?)`,
);
const cite = db.prepare(
  "INSERT INTO sources (id, operator_id, url, fetched_at, http_status, extractor, robots_allowed, note) VALUES (?, ?, ?, ?, NULL, ?, 1, ?)",
);

const stats = { read: 0, inserted: 0, known: {} as Record<string, number>, invalid: 0 };
const byKind: Record<string, number> = {};
const byCity: Record<string, number> = {};
const bySource: Record<string, number> = {};
const byActivity: Record<string, number> = {};
const bump = (m: Record<string, number>, k: string) => void (m[k] = (m[k] || 0) + 1);

if (!dry) db.exec("BEGIN");
try {
  for (const source of sources) {
    const file = join(dir, `florida-${source}.json`);
    if (!existsSync(file)) {
      console.log(`${source}: no ${file}, skipped`);
      continue;
    }
    const list = JSON.parse(readFileSync(file, "utf8")) as Candidate[];
    let added = 0;
    for (const c of list) {
      stats.read += 1;
      const cat = categoryById(c.kind);
      if (!cat || !c.name || c.name.length < 3 || c.region !== "FL") {
        stats.invalid += 1;
        continue;
      }
      const why = whyKnown(c);
      if (why) {
        bump(stats.known, why);
        continue;
      }
      // Web results carry no pin; the destination they were searched from gives the metro.
      const dest = c.lat == null && c.city ? FL_DESTINATIONS.find((d) => d.name === c.city) : undefined;
      const lat = c.lat ?? null;
      const lon = c.lon ?? null;
      const metro = lat != null && lon != null ? nearestMetro(lat, lon, 160) : dest ? nearestMetro(dest.lat, dest.lon, 160) : null;
      const osm = c.sourceUrl.match(/openstreetmap\.org\/(node|way|relation)\/(\d+)/);
      const now = nowIso();
      if (!dry) {
        const id = randomUUID();
        insert.run(
          id, c.domain, c.name, c.website, c.phone, c.street, c.postal, metro?.id || null, c.city, cat.family, cat.id, cat.iconKey,
          ORIGIN[c.source], lat, lon, osm ? `${osm[1]}/${osm[2]}` : null, now, now,
        );
        cite.run(randomUUID(), id, c.sourceUrl, now, `discover-florida:${c.source}`, c.activity || null);
      }
      remember({ domain: c.domain, name: c.name, website: c.website, phone: c.phone, city: c.city, lat, lon, osm_ref: osm ? `${osm[1]}/${osm[2]}` : null });
      stats.inserted += 1;
      added += 1;
      bump(byKind, cat.id);
      bump(byCity, c.city || "(no city)");
      bump(bySource, c.source);
      bump(byActivity, c.activity || cat.id);
    }
    console.log(`${source}: ${list.length} candidates, ${added} new`);
  }
  if (!dry) db.exec("COMMIT");
} catch (e) {
  if (!dry) db.exec("ROLLBACK");
  throw e;
}

const table = (m: Record<string, number>, limit = 60) =>
  Object.entries(m)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k, v]) => `  ${String(v).padStart(5)}  ${k}`)
    .join("\n");

console.log(`\n${dry ? "DRY RUN, nothing written. " : ""}${stats.read} candidates read, ${stats.inserted} ${dry ? "would be inserted" : "inserted"}, ${stats.invalid} invalid`);
console.log("already known, by match:\n" + table(stats.known));
console.log("new by source:\n" + table(bySource));
console.log("new by kind:\n" + table(byKind));
console.log("new by activity:\n" + table(byActivity));
console.log("new by city (top 60):\n" + table(byCity));
