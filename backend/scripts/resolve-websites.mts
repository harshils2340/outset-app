import "../src/env.ts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CITIES, type City } from "../src/discover/cities.ts";
import type { DirectoryCandidate } from "../src/discover/directories.ts";
import { pickMatch } from "../src/discover/resolve.ts";
import { isCached, KeyRing, PRICE_PER_1K_USD, providerOf, searchPlaces, type Place } from "../src/discover/searchapi.ts";
import { METROS, nearestMetro } from "../src/taxonomy/catalog.ts";

/**
 * Find the websites of directory leads: one Google Maps query per lead ("<name>" around its town) through the
 * same provider, cache and spend ledger `npm run search` uses. A lead whose top result is plainly the same
 * business, in the same town, with a website that is its own, moves from the -needs-website file into the
 * directory-<source>.json file that import-discovered.mts inserts. Everything else stays a lead.
 *
 * This is the one paid step in directory discovery, and it is priced before it runs:
 *   npx tsx scripts/resolve-websites.mts --source=captainexperiences            price the run, send nothing
 *   npx tsx scripts/resolve-websites.mts --source=captainexperiences --budget=500 --write
 * --budget is a hard cap on requests that cost money (cache hits are free and not counted). Needs SEARCHAPI_KEYS.
 */

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "../data/discovered");
const arg = (name: string, fallback: string): string => {
  const a = process.argv.find((x) => x.startsWith("--" + name + "="));
  return a ? a.split("=").slice(1).join("=") : fallback;
};
const source = arg("source", "");
const write = process.argv.includes("--write");
const budget = Number(arg("budget", "0"));
if (!source) {
  console.error("--source=<directory id> is required");
  process.exit(1);
}
const leadsPath = join(dir, `directory-${source}-needs-website.json`);
const outPath = join(dir, `directory-${source}.json`);
if (!existsSync(leadsPath)) {
  console.log(`no leads file at ${leadsPath}; run discover-directories.mts --write first`);
  process.exit(0);
}
const leads = JSON.parse(readFileSync(leadsPath, "utf8")) as DirectoryCandidate[];
const keys = (process.env.SEARCHAPI_KEYS || process.env.SEARCHAPI_KEY || "").split(",").map((s) => s.trim()).filter(Boolean);
const provider = keys[0] ? providerOf(keys[0]) : "serper";
const perReq = PRICE_PER_1K_USD[provider] / 1000;

/** The town to search around: the CITIES grid entry, else the nearest metro's centre to that entry, else nothing. */
function cityFor(lead: DirectoryCandidate): City | null {
  if (lead.lat != null && lead.lon != null) return { name: lead.city || "", region: lead.region || "", lat: lead.lat, lon: lead.lon } as City;
  if (!lead.city) return null;
  const grid = CITIES.find((c) => c.name.toLowerCase() === lead.city!.toLowerCase() && (!lead.region || c.region === lead.region));
  if (grid) return grid;
  // Not on the grid: the nearest metro by name is not knowable without coordinates, so a metro that shares the region is the best centre.
  const m = METROS.find((x) => x.region === lead.region);
  return m ? ({ name: lead.city, region: lead.region || m.region, lat: m.lat, lon: m.lon } as City) : null;
}

const plan = leads.map((l) => ({ lead: l, city: cityFor(l), q: l.name })).filter((p) => p.city);
const uncached = plan.filter((p) => !isCached(p.q, p.city!, 1));
console.log(`${leads.length} leads, ${plan.length} with a town to search around, ${uncached.length} not yet cached.`);
console.log(`Price for the uncached ones on ${provider}: $${(uncached.length * perReq).toFixed(3)} ($${PRICE_PER_1K_USD[provider]} per 1,000). Budget: ${budget} requests.`);
if (!write) {
  for (const p of plan.slice(0, 8)) console.log(`  would search "${p.q}" around ${p.city!.name}, ${p.city!.region}${isCached(p.q, p.city!, 1) ? " (cached)" : ""}`);
  console.log("\nDry run. Add --write --budget=N to spend up to N requests.");
  process.exit(0);
}
if (!keys.length) {
  console.error("SEARCHAPI_KEYS is not set in backend/.env.");
  process.exit(1);
}
const ring = new KeyRing(keys);
const resolved: DirectoryCandidate[] = [];
const still: DirectoryCandidate[] = [];
let paid = 0;
for (const p of plan) {
  const cached = isCached(p.q, p.city!, 1);
  if (!cached && paid >= budget) {
    still.push(p.lead);
    continue;
  }
  let places: Place[] = [];
  try {
    const r = await searchPlaces(p.q, p.city!, 1, ring);
    places = r.places;
    if (!r.cached) paid++;
  } catch (e) {
    console.error(`  ${p.q}: ${(e as Error).message}`);
    still.push(p.lead);
    continue;
  }
  const m = pickMatch({ name: p.lead.name, city: p.lead.city, region: p.lead.region }, places);
  if (!m) {
    still.push(p.lead);
    continue;
  }
  const host = new URL(m.website).hostname.replace(/^www\./, "").toLowerCase();
  const lat = m.place.gps_coordinates?.latitude ?? p.lead.lat;
  const lon = m.place.gps_coordinates?.longitude ?? p.lead.lon;
  resolved.push({
    ...p.lead,
    website: m.website,
    domain: host,
    phone: p.lead.phone || (m.place.phone ? m.place.phone : null),
    lat: lat ?? null,
    lon: lon ?? null,
  });
  console.log(`  ${p.lead.name} -> ${m.website} (${m.score.toFixed(2)})`);
}
for (const l of leads) if (!plan.some((p) => p.lead === l)) still.push(l);
const have = existsSync(outPath) ? (JSON.parse(readFileSync(outPath, "utf8")) as DirectoryCandidate[]) : [];
const seen = new Set(have.map((c) => c.domain));
const fresh = resolved.filter((c) => !seen.has(c.domain));
writeFileSync(outPath, JSON.stringify([...have, ...fresh], null, 1));
writeFileSync(leadsPath, JSON.stringify(still, null, 1));
console.log(`\n${resolved.length} resolved (${fresh.length} new in ${outPath}), ${still.length} still need a website, ${paid} paid requests ($${(paid * perReq).toFixed(2)}).`);
const metroless = fresh.filter((c) => c.lat != null && c.lon != null && !nearestMetro(c.lat!, c.lon!, 160)).length;
if (metroless) console.log(`${metroless} of the new ones are outside every metro's 160 km; the importer keeps them with no metro.`);
