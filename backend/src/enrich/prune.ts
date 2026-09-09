import { db } from "../db/client.ts";

/**
 * Search discovery casts a wide net. Some catches are not bookable experiences: airports, flight schools,
 * marinas that only sell moorage, travel agencies, cafés, government sites. Remove them. A place survives
 * a noisy category only when it has priced offerings and an activity word in its name.
 */
const NOISE_TYPES = new Set([
  "Travel agency", "Flight school", "Aircraft rental service", "Transportation service", "Airport", "Vacation home rental agency",
  "Tourist information center", "Cruise line company", "Heliport", "Festival", "Event venue", "Aviation consultant", "Bus tour agency",
  "Airline", "Non-profit organization", "Aerospace company", "Visitor center", "Historical landmark", "Cottage", "Lodging",
  "Fixed-base operator", "Cruise terminal", "Corporate office", "Balloon artist", "Regional airport", "Museum", "House",
  "Boat maintenance", "Boat ramp", "Scenic spot", "Ski rental service", "Snowmobile rental service", "Recreational vehicle rental agency",
  "Bicycle rental service", "Fishing pond", "Dive shop", "Marina", "Boat dealer", "Yacht broker", "Boat storage facility", "Campground",
  "RV park", "Hotel", "Resort hotel", "Restaurant", "Bar", "Cafe", "Coffee shop", "Government office", "Military base", "Park", "State park",
  "National park", "Beach", "Lake", "Wedding venue", "Real estate agency", "Insurance agency", "Church", "School", "University",
]);
const NOISE_NAME = /\b(caf[eé]|restaurant|bar & grill|grill|pizza|church|school district|university|college|police|fire department|air national guard|air force|navy|coast guard|city of|county of|chamber of commerce|realty|real estate|insurance|dental|clinic|hospital)\b/i;
const NOISE_DOMAIN = /\.(mil|gov|edu)$|\.gov\.|\.gc\.ca$|\.mil\./i;
const ACTIVITY = /jet|ski|kayak|canoe|paddle|boat|charter|fish|cruise|sail|sunset|dolphin|snorkel|parasail|skydiv|tandem|helicopter|heli|balloon|kart|escape|axe|paintball|horse|trail|tour|adventure|watersport|rental/i;

export function pruneNoise(dryRun = false): { types: number; names: number; domains: number; total: number } {
  const rows = db
    .prepare(
      `SELECT o.id, o.name, o.domain,
              (SELECT fact_value FROM facts f WHERE f.operator_id = o.id AND f.fact_key = 'google_category' LIMIT 1) AS gtype,
              (SELECT COUNT(*) FROM offerings x WHERE x.operator_id = o.id AND x.price_cents IS NOT NULL) AS priced,
              (SELECT COUNT(*) FROM facts f WHERE f.operator_id = o.id AND f.fact_key = 'service' AND f.fact_value LIKE '%rental%' OR f.fact_value LIKE '%tour%' OR f.fact_value LIKE '%charter%') AS svc
       FROM operators o WHERE o.origin IN ('search', 'osm')`,
    )
    .all() as { id: string; name: string; domain: string; gtype: string | null; priced: number; svc: number }[];
  const out = { types: 0, names: 0, domains: 0, total: 0 };
  db.exec("PRAGMA foreign_keys = ON");
  const del = db.prepare("DELETE FROM operators WHERE id = ?");
  db.exec("BEGIN");
  for (const r of rows) {
    const keepAnyway = (r.priced > 0 && ACTIVITY.test(r.name)) || r.svc > 0;
    let why: keyof typeof out | null = null;
    if (NOISE_DOMAIN.test(r.domain)) why = "domains";
    else if (NOISE_NAME.test(r.name)) why = "names";
    else if (r.gtype && NOISE_TYPES.has(r.gtype) && !keepAnyway) why = "types";
    if (!why) continue;
    out[why] += 1;
    out.total += 1;
    if (!dryRun) del.run(r.id);
  }
  db.exec(dryRun ? "ROLLBACK" : "COMMIT");
  return out;
}
