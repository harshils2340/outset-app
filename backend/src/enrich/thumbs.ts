import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db, nowIso } from "../db/client.ts";

/**
 * Covers from the Google Maps results we already paid for. Every place result carries the business's own
 * Google photo thumbnail. For operators whose site gave us no usable photo, that thumbnail is the cover.
 */
const here = dirname(fileURLToPath(import.meta.url));
const cacheDir = join(here, "../../data/searchapi");

type Place = { title?: string; address?: string; website?: string; place_id?: string; thumbnail?: string; thumbnailUrl?: string; cid?: string };

function host(u?: string): string | null {
  if (!u) return null;
  try {
    return new URL(u.startsWith("http") ? u : "https://" + u).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function importThumbnails(): { scanned: number; covers: number } {
  const byDomain = new Map<string, string>();
  const byPlace = new Map<string, string>();
  const byName = new Map<string, string>();
  let scanned = 0;
  for (const f of readdirSync(cacheDir)) {
    let d: { local_results?: Place[]; places?: Place[] };
    try {
      d = JSON.parse(readFileSync(join(cacheDir, f), "utf8"));
    } catch {
      continue;
    }
    for (const r of d.local_results || d.places || []) {
      const thumb = r.thumbnail || r.thumbnailUrl;
      if (!thumb || !/^https?:/.test(thumb)) continue;
      scanned += 1;
      const h = host(r.website);
      if (h && !byDomain.has(h)) byDomain.set(h, thumb);
      if (r.place_id && !byPlace.has(r.place_id)) byPlace.set(r.place_id, thumb);
      if (r.cid && !byPlace.has(r.cid)) byPlace.set(r.cid, thumb);
      if (r.title) {
        const key = r.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        if (!byName.has(key)) byName.set(key, thumb);
      }
    }
  }
  const rows = db
    .prepare(
      `SELECT id, domain, name FROM operators o WHERE origin != 'demo'
       AND NOT EXISTS (SELECT 1 FROM facts f WHERE f.operator_id = o.id AND f.fact_key = 'cover')`,
    )
    .all() as { id: string; domain: string; name: string }[];
  const ins = db.prepare("INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?, ?, ?, ?, 'google-maps:thumbnail', 'listed')");
  let covers = 0;
  const now = nowIso();
  db.exec("BEGIN");
  for (const op of rows) {
    const placeId = op.domain.startsWith("gplace-") ? op.domain.slice(7) : null;
    const thumb =
      (placeId && byPlace.get(placeId)) ||
      byDomain.get(op.domain) ||
      byName.get(op.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
    if (!thumb) continue;
    ins.run(randomUUID(), op.id, "cover", thumb);
    ins.run(randomUUID(), op.id, "photo", thumb);
    covers += 1;
  }
  db.exec("COMMIT");
  void now;
  return { scanned, covers };
}
