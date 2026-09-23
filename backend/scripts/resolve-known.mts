import "../src/env.ts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../src/db/client.ts";
import type { DirectoryCandidate } from "../src/discover/directories.ts";
import { nameOverlap } from "../src/discover/resolve.ts";

/**
 * The free lookup: a directory lead whose business is already in our own operators table gets that row's
 * website, phone and pin, with no request to anyone. The catalog already holds 423,000 operators from
 * OpenStreetMap, Overture and Google Maps, so a fishing guide in Gloucester or an art school in Somerville is
 * likely already there under its own site. Only leads that nothing here matches remain for the paid lookup.
 *
 *   npx tsx scripts/resolve-known.mts --source=captainexperiences            print the matches, write nothing
 *   npx tsx scripts/resolve-known.mts --source=captainexperiences --write    move them into directory-<source>.json
 *
 * A match needs the same town (or the same region when the row has no town) and most of the lead's distinctive
 * name words in the row's name; two rows that both qualify is ambiguity, and ambiguity is no match. A row with
 * no website is not a match either: it would give the lead nothing the importer could use.
 */

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "../data/discovered");
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

type Row = { domain: string; name: string; website: string | null; phone: string | null; city: string | null; region: string | null; lat: number | null; lon: number | null };
const byCity = db.prepare("SELECT domain, name, website, phone, city, region, lat, lon FROM operators WHERE website IS NOT NULL AND lower(city) = lower(?) AND (region IS NULL OR upper(region) = upper(?))");
const byRegion = db.prepare("SELECT domain, name, website, phone, city, region, lat, lon FROM operators WHERE website IS NOT NULL AND upper(region) = upper(?) AND lower(name) LIKE ?");

function firstWord(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim().split(/\s+/).find((w) => w.length > 2 && !/^(the|and)$/.test(w)) || name.toLowerCase().slice(0, 4);
}

export function matchLead(lead: DirectoryCandidate): { row: Row; score: number } | null {
  const rows: Row[] = [];
  if (lead.city && lead.region) rows.push(...(byCity.all(lead.city, lead.region) as Row[]));
  if (lead.region) rows.push(...(byRegion.all(lead.region, "%" + firstWord(lead.name) + "%") as Row[]));
  const seen = new Set<string>();
  const hits: { row: Row; score: number }[] = [];
  for (const r of rows) {
    if (seen.has(r.domain)) continue;
    seen.add(r.domain);
    // Both ways: "Milton Art Center" covers every distinctive word of itself in "Milton Art Museum", and is a
    // different place. The row's own extra words count against the match too.
    const score = Math.min(nameOverlap(lead.name, r.name), nameOverlap(r.name, lead.name));
    if (score < 0.75) continue;
    const sameTown = !!lead.city && !!r.city && r.city.toLowerCase() === lead.city.toLowerCase();
    if (!sameTown && score < 0.99) continue;
    hits.push({ row: r, score: score + (sameTown ? 0.2 : 0) });
  }
  hits.sort((a, b) => b.score - a.score);
  if (!hits.length) return null;
  if (hits.length > 1 && hits[1].score >= hits[0].score - 0.05) return null;
  return hits[0];
}

const resolved: DirectoryCandidate[] = [];
const still: DirectoryCandidate[] = [];
for (const lead of leads) {
  const m = matchLead(lead);
  if (!m || !m.row.website) {
    still.push(lead);
    continue;
  }
  console.log(`  ${lead.name} (${lead.city}, ${lead.region}) -> ${m.row.name} · ${m.row.website} (${m.score.toFixed(2)})`);
  resolved.push({ ...lead, website: m.row.website, domain: m.row.domain, phone: lead.phone || m.row.phone, lat: lead.lat ?? m.row.lat, lon: lead.lon ?? m.row.lon });
}
console.log(`${leads.length} leads: ${resolved.length} already in our catalog with a website, ${still.length} still need a lookup.`);
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
