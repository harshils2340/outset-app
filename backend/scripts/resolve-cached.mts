import "../src/env.ts";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DirectoryCandidate } from "../src/discover/directories.ts";
import { pickMatch } from "../src/discover/resolve.ts";
import type { Place } from "../src/discover/searchapi.ts";

/**
 * The second free lookup: Google Maps answers already paid for. Every `npm run search` response is cached on
 * disk per term and city (data/searchapi/), and a lead's business is often in one of them already: an art
 * school in Chicago sits in the cached "art classes Chicago IL" page. This reads every cached page once and
 * matches leads against the places in them with the same rule the paid lookup uses, so nothing is sent.
 *
 *   npx tsx scripts/resolve-cached.mts --source=coursehorse            print matches, write nothing
 *   npx tsx scripts/resolve-cached.mts --source=coursehorse --write    move them into directory-<source>.json
 */

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "../data/discovered");
const cacheDir = join(here, "../data/searchapi");
const arg = (name: string, fallback: string): string => {
  const a = process.argv.find((x) => x.startsWith("--" + name + "="));
  return a ? a.split("=").slice(1).join("=") : fallback;
};
const source = arg("source", "");
const write = process.argv.includes("--write");
if (!source) {
  console.error("--source=<directory id> is required");
  process.exit(1);
}
const leadsPath = join(dir, `directory-${source}-needs-website.json`);
const outPath = join(dir, `directory-${source}.json`);
if (!existsSync(leadsPath)) {
  console.log(`no leads file at ${leadsPath}`);
  process.exit(0);
}
const leads = JSON.parse(readFileSync(leadsPath, "utf8")) as DirectoryCandidate[];
if (!existsSync(cacheDir)) {
  console.log("no search cache at " + cacheDir);
  process.exit(0);
}

// Every cached place, bucketed by the town its address names, so a lead compares against its own town only.
const byTown = new Map<string, Place[]>();
let files = 0;
let places = 0;
for (const f of readdirSync(cacheDir)) {
  if (!f.endsWith(".json")) continue;
  files++;
  let list: Place[] = [];
  try {
    list = (JSON.parse(readFileSync(join(cacheDir, f), "utf8")) as { local_results?: Place[] }).local_results || [];
  } catch {
    continue;
  }
  for (const p of list) {
    places++;
    const town = (p.address || "").split(",").map((s) => s.trim().toLowerCase());
    for (const t of town) {
      if (!t || /^\d/.test(t) || t.length > 40) continue;
      const list2 = byTown.get(t);
      if (list2) list2.push(p);
      else byTown.set(t, [p]);
    }
  }
}
console.log(`${files} cached Google Maps pages, ${places} places, ${byTown.size} towns.`);

const resolved: DirectoryCandidate[] = [];
const still: DirectoryCandidate[] = [];
for (const lead of leads) {
  const pool = lead.city ? byTown.get(lead.city.toLowerCase()) || [] : [];
  const m = pool.length ? pickMatch({ name: lead.name, city: lead.city, region: lead.region }, pool) : null;
  if (!m) {
    still.push(lead);
    continue;
  }
  const host = new URL(m.website).hostname.replace(/^www\./, "").toLowerCase();
  console.log(`  ${lead.name} (${lead.city}, ${lead.region}) -> ${m.place.title} · ${m.website} (${m.score.toFixed(2)})`);
  resolved.push({ ...lead, website: m.website, domain: host, phone: lead.phone || m.place.phone || null, lat: lead.lat ?? m.place.gps_coordinates?.latitude ?? null, lon: lead.lon ?? m.place.gps_coordinates?.longitude ?? null });
}
console.log(`${leads.length} leads: ${resolved.length} found in cached Maps answers, ${still.length} still need a lookup.`);
if (!write) {
  console.log("Dry run. Add --write to move the matches into " + outPath + ".");
  process.exit(0);
}
const have = existsSync(outPath) ? (JSON.parse(readFileSync(outPath, "utf8")) as DirectoryCandidate[]) : [];
const seen = new Set(have.map((c) => c.domain));
const fresh = resolved.filter((c) => !seen.has(c.domain));
writeFileSync(outPath, JSON.stringify([...have, ...fresh], null, 1));
writeFileSync(leadsPath, JSON.stringify(still, null, 1));
console.log(`Wrote ${fresh.length} new to ${outPath}; ${still.length} left in ${leadsPath}.`);
