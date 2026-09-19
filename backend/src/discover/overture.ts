import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import { db, nowIso } from "../db/client.ts";
import { normalizePhone } from "../scrape/run.ts";
import { categoryById, nearestMetro } from "../taxonomy/catalog.ts";

/**
 * Discovery from Overture Maps, the open place dataset published by the Overture Maps Foundation (Meta,
 * Microsoft, Amazon, TomTom and others). It is the free answer to the question the paid Google Maps pass was
 * being asked: Silverdale Gun Club in West Lincoln, Ontario is in no OpenStreetMap extract, but Overture has it
 * with its category, address, website and phone. Ontario alone holds 1,303 shooting ranges there against the
 * six OpenStreetMap gave us.
 *
 * The data is GeoParquet on S3, queried in place with DuckDB, so a state costs one ranged read of a few
 * columns and no API key, no credits and no per-row price. Licence is CDLA-Permissive 2.0: it must be
 * attributed, like OpenStreetMap's ODbL. See docs and `ATTRIBUTION` below.
 *
 * What it does not carry is Google's rating and review count, which is what the Serper pass is for. The two
 * are complementary: Overture says who exists and where, Google says how well reviewed they are.
 */

const here = dirname(fileURLToPath(import.meta.url));
const cacheDir = join(here, "../../data/overture");

/** The release to read. Overture publishes monthly; pinning it keeps a rerun reproducible. */
export const OVERTURE_RELEASE = process.env.OVERTURE_RELEASE || "2026-08-19.0";
const BASE = `s3://overturemaps-us-west-2/release/${OVERTURE_RELEASE}/theme=places/type=place/*`;

export const ATTRIBUTION = "© Overture Maps Foundation, CDLA-Permissive 2.0";

/**
 * Overture's category to ours. Only categories a guest can actually book or turn up to are here: a category
 * that is a shop for the gear ("archery_shop", "surf_shop", "motorsports_store") is not an activity, and is
 * deliberately absent. Where Overture is more specific than we are, several of theirs map to one of ours.
 */
export const CATEGORY_MAP: Record<string, string> = {
  // Water
  jet_ski_rental: "jetski", water_sports_rental: "jetski", watersports: "jetski",
  canoe_and_kayak_hire_service: "kayak", kayaking: "kayak", canoeing: "kayak", rafting_kayaking_area: "rafting",
  paddleboarding: "paddleboard", stand_up_paddleboarding: "paddleboard",
  boat_rental_and_training: "pontoon", boat_rental: "pontoon", boating_places: "pontoon",
  fishing_charter: "fishing", fishing_club: "fishing", charter_fishing: "fishing", fishing_tour: "fishing",
  boat_tours: "cruise", sailing_tour: "cruise", yacht_charter: "cruise", whale_watching_tour: "cruise",
  ferry_boat_company: "cruise", sightseeing_boat_tour: "cruise",
  scuba_diving_center: "scuba", scuba_instructor: "scuba", snorkeling: "scuba",
  surfing: "surf", surf_school: "surf", surf_lessons: "surf",
  // A swimming lesson is bookable; "swimming_pool" is mostly municipal and school pools, so it is left out.
  swimming_instructor: "swim", swimming_lessons: "swim",
  sailing_club: "sailing", sailing_school: "sailing", white_water_rafting: "rafting", rafting: "rafting",
  // Air
  skydiving_center: "skydive", skydiving: "skydive", parachuting: "skydive",
  helicopter_tour: "heli", helicopter_tour_agency: "heli",
  hot_air_balloon: "balloon", hot_air_balloon_tour_agency: "balloon", ballooning: "balloon",
  parasailing: "parasail", paragliding: "paragliding", hang_gliding: "paragliding", gliding: "gliding",
  // Motorsport
  go_kart_club: "kart", go_kart_track: "kart", go_karts: "kart",
  atv_rentals_and_tours: "motorsport", atv_recreation_park: "motorsport", off_road_race_track: "motorsport",
  race_track: "motorsport", motorsports_racing_track: "motorsport", motorcycle_tour_agency: "motorsport",
  // Indoor
  escape_rooms: "escape", escape_game: "escape",
  axe_throwing: "axe", axe_throwing_range: "axe",
  rock_climbing_spot: "climbing", rock_climbing_gym: "climbing", climbing_gym: "climbing", bouldering: "climbing",
  rage_room: "rage",
  // Outdoor
  paintball: "paintball", paintball_center: "paintball",
  horseback_riding_service: "horse", horse_riding: "horse", equestrian_facility: "horse", horseback_riding: "horse",
  shooting_range: "range", gun_range: "range", shooting_club: "range",
  archery_range: "archery", archery: "archery",
  golf_course: "golf", golf_club: "golf", public_golf_course: "golf",
  driving_range: "discgolf", disc_golf_course: "discgolf",
  zipline: "zipline", zip_line: "zipline", adventure_sports_center: "zipline", ropes_course: "zipline",
  ski_resort: "ski", ski_school: "ski", ski_area: "ski",
  bike_rentals: "bike", bicycle_rental: "bike", bike_tours: "bike",
  snowmobile_rental: "snowmobile", snowmobiling: "snowmobile",
  campground: "camping", rv_park: "camping", glamping: "camping",
  botanical_garden: "garden",
  tennis_court: "tennis", tennis_club: "tennis", pickleball_court: "tennis", racquet_sports: "tennis",
  // Play
  bowling_alley: "bowling", bowling_club: "bowling",
  miniature_golf_course: "minigolf", mini_golf: "minigolf",
  arcade: "arcade", amusement_arcade: "arcade", kids_recreation_and_party: "arcade", indoor_playcenter: "arcade",
  family_entertainment_center: "arcade",
  trampoline_park: "trampoline", laser_tag: "lasertag",
  ice_skating_rink: "icerink", skating_rink: "icerink", roller_skating_rink: "icerink", curling_club: "icerink",
  water_park: "waterpark", amusement_park: "themepark", theme_park: "themepark",
  zoo: "zoo", petting_zoo: "zoo", wildlife_refuge: "zoo", safari_park: "zoo",
  aquarium: "aquarium", karaoke: "karaoke", karaoke_bar: "karaoke",
  pool_billiards: "billiards", billiards: "billiards",
  // Food and drink
  brewery: "brewery", brewpub: "brewery", beer_garden: "brewery",
  winery: "winery", wine_tasting_room: "winery", vineyard: "winery",
  distillery: "distillery",
  cooking_school: "cooking", cooking_classes: "cooking", culinary_school: "cooking",
  // Wellness and classes
  spas: "spa", day_spa: "spa", health_spa: "spa", massage_therapist: "spa", massage: "spa",
  sauna: "sauna", bathhouse: "sauna", hot_springs: "sauna",
  yoga_studio: "yoga", yoga: "yoga", pilates_studio: "fitness",
  // Deliberately not here: "gym" and "fitness_center". Overture has 125,313 of them in the US and Canada, and a
  // gym is a membership, not something a guest books an afternoon of. They were the single largest source of
  // filler in the first import and were removed again.
  dance_school: "dance", dance_studio: "dance", dance_instruction: "dance",
  pottery_class: "pottery", pottery_studio: "pottery", art_school: "pottery", art_classes: "pottery",
  martial_arts_club: "martialarts", martial_arts_school: "martialarts", boxing_gym: "martialarts", karate: "martialarts",
  gymnastics_center: "gymnastics", gymnastics: "gymnastics",
  // Culture and tours
  museum: "museum", art_museum: "museum", history_museum: "museum", childrens_museum: "museum",
  science_museum: "museum", community_museum: "museum", planetarium: "museum",
  sightseeing_tour_agency: "tour", historical_tours: "tour", walking_tours: "tour", food_tours: "tour",
  bus_tours: "tour", tour_operator: "tour",
  comedy_club: "theatre", performing_arts_theater: "theatre", theatre: "theatre", theater: "theatre",
  venue_and_event_space: "venue", event_venue: "venue",
};

/** Overture's row, only the columns we read. */
type Row = {
  name: string | null;
  category: string | null;
  website: string | null;
  email: string | null;
  social: string | null;
  status: string | null;
  phone: string | null;
  street: string | null;
  city: string | null;
  region: string | null;
  postal: string | null;
  country: string | null;
  confidence: number | null;
  lat: number | null;
  lon: number | null;
};

const SOCIAL = /facebook\.com|instagram\.com|twitter\.com|x\.com|yelp\.com|tripadvisor\.|linktr\.ee|google\.|bit\.ly|booking\.com|viator\.com|getyourguide|airbnb\./i;

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url.startsWith("http") ? url : "https://" + url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** A public Instagram or Facebook page, kept as a fact with its source, the way the site crawl keeps them. */
function noteSocial(operatorId: string, url: string): void {
  if (stmt("SELECT 1 FROM facts WHERE operator_id = ? AND fact_key = 'social' AND fact_value = ? LIMIT 1").get(operatorId, url)) return;
  stmt("INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?, ?, 'social', ?, 'overture', 'listed')").run(randomUUID(), operatorId, url);
}

export type OvertureStats = { read: number; skipped: Record<string, number>; inserted: number; merged: number };

/**
 * The quality gate. A place with no website is skipped, whatever else it has: the website is the thing every
 * later pass needs. The photo crawl, the menu and price reader, the hours crawl and the owner lookup all start
 * from it, so a row without one can never become a listing worth showing, it can only pad the count.
 */
export function keep(r: Row): { ok: true; host: string } | { ok: false; why: string } {
  if (!r.name || r.name.trim().length < 3) return { ok: false, why: "no name" };
  if (!r.category || !CATEGORY_MAP[r.category]) return { ok: false, why: "category not an activity" };
  const host = hostOf(r.website);
  if (!host) return { ok: false, why: "no website" };
  if (SOCIAL.test(host)) return { ok: false, why: "social page, not a site" };
  if (r.lat == null || r.lon == null) return { ok: false, why: "no pin" };
  // Overture tracks whether a business is still trading. A shut one is the worst kind of filler: a guest rings
  // a dead number. 186,790 places in the United States alone are marked permanently closed.
  if (r.status === "permanently_closed" || r.status === "temporarily_closed") return { ok: false, why: "closed" };
  // Overture scores how sure it is the place is real. Below half is a place it is guessing at.
  if (r.confidence != null && r.confidence < 0.5) return { ok: false, why: "low confidence" };
  return { ok: true, host };
}

const stmts = new Map<string, ReturnType<typeof db.prepare>>();
const stmt = (sql: string) => {
  let s = stmts.get(sql);
  if (!s) stmts.set(sql, (s = db.prepare(sql)));
  return s;
};

/** Insert a kept place, or fill blanks on one we already have. Same matching the Google Maps import uses. */
function upsert(r: Row, host: string, stats: OvertureStats): void {
  const cat = categoryById(CATEGORY_MAP[r.category!]);
  if (!cat) return void (stats.skipped["unknown category"] = (stats.skipped["unknown category"] || 0) + 1);
  const phone = normalizePhone(r.phone || undefined);
  const country = r.country === "CA" ? "CA" : "US";
  const metro = nearestMetro(r.lat!, r.lon!, 160);
  const now = nowIso();

  const existing =
    (stmt("SELECT id FROM operators WHERE domain = ?").get(host) as { id: string } | undefined) ||
    (phone ? (stmt("SELECT id FROM operators WHERE phone = ? AND phone IS NOT NULL").get(phone) as { id: string } | undefined) : undefined) ||
    (stmt("SELECT id FROM operators WHERE lower(name) = lower(?) AND lat IS NOT NULL AND abs(lat - ?) < 0.02 AND abs(lon - ?) < 0.02").get(r.name!, r.lat!, r.lon!) as { id: string } | undefined);

  if (existing) {
    stmt(
      `UPDATE operators SET website = COALESCE(website, ?), phone = COALESCE(phone, ?), email = COALESCE(email, ?),
        street = COALESCE(street, ?), city = COALESCE(city, ?), region = COALESCE(region, ?), postal = COALESCE(postal, ?),
        lat = COALESCE(lat, ?), lon = COALESCE(lon, ?), metro_id = COALESCE(metro_id, ?), updated_at = ?
       WHERE id = ?`,
    ).run(r.website, phone, r.email, r.street, r.city, r.region, r.postal, r.lat, r.lon, metro?.id || null, now, existing.id);
    if (r.social) noteSocial(existing.id, r.social);
    stats.merged++;
    return;
  }

  const id = randomUUID();
  stmt(
    `INSERT INTO operators (
      id, domain, name, website, phone, email, street, postal, metro_id, city, region, country, family, category_id, icon_key,
      claim_status, booking_mode, origin, completeness, lat, lon, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unclaimed', 'request', 'overture', 0, ?, ?, ?, ?)`,
  ).run(
    id, host, r.name!.trim(), r.website, phone, r.email, r.street, r.postal, metro?.id || null, r.city, r.region,
    country, cat.family, cat.id, cat.iconKey, r.lat, r.lon, now, now,
  );
  if (r.social) noteSocial(id, r.social);
  stats.inserted++;
}

/**
 * The boxes we read, rather than one per state. The category filter is what makes a read cheap, not the box:
 * Overture holds 2.4 million categorised places in Ontario alone and only 79,000 of them are activities, so
 * one ranged read per region of the continent costs less than fifty narrow ones. Regions are split apart
 * afterwards from each row's own state or province.
 */
export const BOXES: Record<string, { west: number; south: number; east: number; north: number }> = {
  "us-west": { west: -125.0, south: 31.3, east: -102.0, north: 49.1 },
  "us-central": { west: -102.0, south: 25.8, east: -87.0, north: 49.1 },
  "us-east": { west: -87.0, south: 24.4, east: -66.9, north: 47.5 },
  "us-alaska": { west: -172.5, south: 51.0, east: -129.9, north: 71.5 },
  "us-hawaii": { west: -160.3, south: 18.9, east: -154.7, north: 22.3 },
  "ca-west": { west: -141.0, south: 48.0, east: -95.0, north: 70.0 },
  "ca-east": { west: -95.0, south: 41.6, east: -52.6, north: 70.0 },
};
export type BoxId = keyof typeof BOXES;

let instance: DuckDBInstance | null = null;
async function connect() {
  if (!instance) instance = await DuckDBInstance.create(":memory:");
  const con = await instance.connect();
  await con.run("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';");
  return con;
}

/** Read one box's activity places from Overture, cached on disk so a rerun costs no bandwidth. */
export async function pullBox(id: string, opts: { refresh?: boolean } = {}): Promise<Row[]> {
  mkdirSync(cacheDir, { recursive: true });
  const path = join(cacheDir, `${id}-${OVERTURE_RELEASE}.json`);
  if (!opts.refresh && existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as Row[];

  const box = BOXES[id];
  if (!box) throw new Error("unknown box " + id + "; known: " + Object.keys(BOXES).join(", "));
  const wanted = Object.keys(CATEGORY_MAP).map((c) => `'${c}'`).join(",");
  const con = await connect();
  const reader = await con.runAndReadAll(
    `SELECT names.primary AS name,
            categories.primary AS category,
            websites[1] AS website,
            emails[1] AS email,
            socials[1] AS social,
            operating_status AS status,
            phones[1] AS phone,
            addresses[1].freeform AS street,
            addresses[1].locality AS city,
            addresses[1].region AS region,
            addresses[1].postcode AS postal,
            addresses[1].country AS country,
            confidence,
            ST_Y(geometry) AS lat, ST_X(geometry) AS lon
     FROM read_parquet('${BASE}')
     WHERE bbox.xmin BETWEEN ${box.west} AND ${box.east}
       AND bbox.ymin BETWEEN ${box.south} AND ${box.north}
       AND categories.primary IN (${wanted})
       AND websites[1] IS NOT NULL`,
  );
  const rows = reader.getRowObjects() as unknown as Row[];
  writeFileSync(path, JSON.stringify(rows));
  return rows;
}

/** Pull one box and file everything in it that passes the gate. */
export async function importBox(id: string, opts: { refresh?: boolean; onProgress?: (done: number, total: number, stats: OvertureStats) => void } = {}): Promise<OvertureStats> {
  const stats: OvertureStats = { read: 0, skipped: {}, inserted: 0, merged: 0 };
  const rows = await pullBox(id, opts);
  stats.read = rows.length;
  /**
   * In batches inside one transaction each. The database runs with synchronous=FULL, so every statement
   * outside a transaction waits for the disk to confirm the write: filing a place took a seventh of a second,
   * which is fine for a nightly trickle and hopeless for 124,000 of them. One flush per batch instead of one
   * per row, and the batch keeps a crash from costing more than a few seconds of work.
   */
  const BATCH = 2000;
  let open = false;
  const begin = () => { if (!open) { db.exec("BEGIN"); open = true; } };
  const commit = () => { if (open) { db.exec("COMMIT"); open = false; } };
  try {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const v = keep(r);
      if (!v.ok) {
        stats.skipped[v.why] = (stats.skipped[v.why] || 0) + 1;
        continue;
      }
      begin();
      upsert(r, v.host, stats);
      if ((i + 1) % BATCH === 0) {
        commit();
        if (opts.onProgress) opts.onProgress(i + 1, rows.length, stats);
      }
    }
    commit();
  } catch (e) {
    if (open) db.exec("ROLLBACK");
    throw e;
  }
  return stats;
}
