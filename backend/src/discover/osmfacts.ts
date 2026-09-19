import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db, nowIso } from "../db/client.ts";
import { normalizePhone } from "../scrape/run.ts";

/**
 * Facts OpenStreetMap already gave us and we never read.
 *
 * `npm run discover` keeps every Overpass answer under `backend/data/osm/`, and takes the name, the pin and the
 * kind of business out of it. The same elements carry opening hours, a phone number, an email, a website and a
 * description, and those were left on the floor: 32,813 sets of opening hours, 68,909 phone numbers and 15,112
 * email addresses sitting on the disk, for 111,358 listings that have no hours at all.
 *
 * This reads those files and nothing else. No network, no crawler, no cost, and it works when there is no
 * machine to crawl from. Hours matter beyond the listing page: a listing publishes once we know something real
 * about the business, and hours are one of the three things that count.
 *
 * Nothing here overwrites what a crawl found. Every field is filled only where we have nothing, and each fact
 * carries the OSM element it came from. OSM data is ODbL, the same licence the discovery already honours.
 */

const here = dirname(fileURLToPath(import.meta.url));
const osmDir = join(here, "../../data/osm");

export type OsmTags = Record<string, string>;
export type OsmElement = { type?: string; id?: number; tags?: OsmTags };

/** The reference `discover` stores on an operator, e.g. "way/389715216". */
export function refOf(el: OsmElement): string | null {
  return el.type && el.id != null ? `${el.type}/${el.id}` : null;
}

/** OSM writes the same fact under two keys; the plain one wins, then the contact: form. */
export function pick(tags: OsmTags, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = (tags[k] || "").trim();
    if (v) return v;
  }
  return null;
}

/**
 * `opening_hours` is its own small language ("Mo-Fr 09:00-17:00; Sa 10:00-14:00"). It is stored as the
 * operator's hours text exactly as written, which is what the hours crawl stores too, so the same reader
 * downstream turns either into a week.
 */
export type OsmFacts = {
  hours: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  description: string | null;
};

export function factsOf(tags: OsmTags): OsmFacts {
  return {
    hours: pick(tags, "opening_hours"),
    phone: pick(tags, "phone", "contact:phone"),
    email: pick(tags, "email", "contact:email"),
    website: pick(tags, "website", "contact:website"),
    description: pick(tags, "description"),
  };
}

export type OsmFactStats = { files: number; elements: number; matched: number; hours: number; phone: number; email: number; website: number; description: number };

/** Read every cached Overpass answer and fill the blanks on the operators they belong to. */
export function importOsmFacts(opts: { onProgress?: (done: number, total: number, stats: OsmFactStats) => void } = {}): OsmFactStats {
  const stats: OsmFactStats = { files: 0, elements: 0, matched: 0, hours: 0, phone: 0, email: 0, website: 0, description: 0 };
  const files = readdirSync(osmDir).filter((f) => f.endsWith(".json"));

  const byRef = db.prepare("SELECT id, hours, phone, email, website FROM operators WHERE osm_ref = ?");
  const setHours = db.prepare("UPDATE operators SET hours = ?, updated_at = ? WHERE id = ? AND hours IS NULL");
  const setField = (col: "phone" | "email" | "website") =>
    db.prepare(`UPDATE operators SET ${col} = ?, updated_at = ? WHERE id = ? AND (${col} IS NULL OR ${col} = '')`);
  const setPhone = setField("phone");
  const setEmail = setField("email");
  const setWebsite = setField("website");
  const hasFact = db.prepare("SELECT 1 FROM facts WHERE operator_id = ? AND fact_key = ? LIMIT 1");
  const insFact = db.prepare(
    "INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?, ?, ?, ?, ?, 'listed')",
  );

  let open = false;
  const begin = () => { if (!open) { db.exec("BEGIN"); open = true; } };
  const commit = () => { if (open) { db.exec("COMMIT"); open = false; } };

  try {
    for (const f of files) {
      stats.files++;
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(join(osmDir, f), "utf8"));
      } catch {
        continue; // a half-written cache file is not worth failing the run over
      }
      const els = (Array.isArray(parsed) ? parsed : ((parsed as { elements?: OsmElement[] }).elements || [])) as OsmElement[];
      begin();
      for (const el of els) {
        stats.elements++;
        const tags = el.tags;
        const ref = refOf(el);
        if (!tags || !ref) continue;
        const v = factsOf(tags);
        if (!v.hours && !v.phone && !v.email && !v.website && !v.description) continue;
        const op = byRef.get(ref) as { id: string; hours: string | null; phone: string | null; email: string | null; website: string | null } | undefined;
        if (!op) continue;
        stats.matched++;
        const now = nowIso();
        const src = "https://www.openstreetmap.org/" + ref;
        if (v.hours && !op.hours) {
          setHours.run(v.hours, now, op.id);
          if (!hasFact.get(op.id, "hours_text")) insFact.run(randomUUID(), op.id, "hours_text", v.hours, src);
          stats.hours++;
        }
        const phone = normalizePhone(v.phone || undefined);
        if (phone && !op.phone) {
          setPhone.run(phone, now, op.id);
          stats.phone++;
        }
        if (v.email && !op.email) {
          setEmail.run(v.email, now, op.id);
          stats.email++;
        }
        if (v.website && !op.website) {
          setWebsite.run(v.website, now, op.id);
          stats.website++;
        }
        if (v.description && !hasFact.get(op.id, "site_desc")) {
          insFact.run(randomUUID(), op.id, "site_desc", v.description.slice(0, 600), src);
          stats.description++;
        }
      }
      commit();
      opts.onProgress?.(stats.files, files.length, stats);
    }
    commit();
  } catch (e) {
    if (open) db.exec("ROLLBACK");
    throw e;
  }
  return stats;
}
