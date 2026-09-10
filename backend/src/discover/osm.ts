import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db, nowIso } from "../db/client.ts";
import { CATEGORIES, METROS, categoryById, nearestMetro } from "../taxonomy/catalog.ts";

/**
 * Operator discovery from OpenStreetMap (ODbL). Every business here was mapped by a person with a name and a
 * position. We copy name, website, phone, address and hours tags. We never invent prices, slots, or eligibility.
 * Runs one Overpass query per state or province because continent-wide queries time out.
 */

const here = dirname(fileURLToPath(import.meta.url));
const cacheDir = join(here, "../../data/osm");
// mail.ru runs a full-planet mirror that stays up when overpass-api.de rate-limits a burst of queries.
const ENDPOINTS = ["https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

export const AREAS: { code: string; country: "US" | "CA"; region: string }[] = [
  ...["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"].map((r) => ({ code: "US-" + r, country: "US" as const, region: r })),
  ...["AB","BC","MB","NB","NL","NS","NT","NU","ON","PE","QC","SK","YT"].map((r) => ({ code: "CA-" + r, country: "CA" as const, region: r })),
];

/** OSM tag selectors and the Outset category they map to. Order matters: first match wins. */
const SELECTORS: { category: string; selector: string }[] = [
  { category: "escape", selector: '["leisure"="escape_game"]' },
  { category: "axe", selector: '["sport"="axe_throwing"]' },
  { category: "kart", selector: '["sport"="karting"]' },
  { category: "paintball", selector: '["sport"="paintball"]' },
  { category: "skydive", selector: '["sport"="skydiving"]' },
  { category: "skydive", selector: '["sport"="parachuting"]' },
  { category: "horse", selector: '["leisure"="horse_riding"]' },
  { category: "balloon", selector: '["sport"="hot_air_balloon"]' },
  { category: "parasail", selector: '["sport"="parasailing"]' },
  { category: "kayak", selector: '["amenity"="boat_rental"]' },
  { category: "kayak", selector: '["shop"="boat"]["rental"]' },
  { category: "kayak", selector: '["sport"="canoe"]["shop"]' },
  { category: "kayak", selector: '["shop"="rental"]["rental"]' },
  { category: "fishing", selector: '["shop"="fishing"]' },
  { category: "cruise", selector: '["tourism"="attraction"]["attraction"="boat_tour"]' },
];

/** Wave two, cached separately so the first wave never refetches. Tag first, then a name check in pickCategory. */
const SELECTORS_W2: { category: string; selector: string }[] = [
  { category: "bowling", selector: '["leisure"="bowling_alley"]' },
  { category: "minigolf", selector: '["leisure"="miniature_golf"]' },
  { category: "arcade", selector: '["leisure"="amusement_arcade"]' },
  { category: "trampoline", selector: '["leisure"="trampoline_park"]' },
  { category: "lasertag", selector: '["leisure"="laser_tag"]' },
  { category: "lasertag", selector: '["sport"="laser_tag"]' },
  { category: "icerink", selector: '["leisure"="ice_rink"]' },
  { category: "waterpark", selector: '["leisure"="water_park"]' },
  { category: "themepark", selector: '["tourism"="theme_park"]' },
  { category: "zoo", selector: '["tourism"="zoo"]' },
  { category: "aquarium", selector: '["tourism"="aquarium"]' },
  { category: "karaoke", selector: '["amenity"="karaoke_box"]' },
  { category: "climbing", selector: '["sport"="climbing"]["leisure"="sports_centre"]' },
  { category: "climbing", selector: '["leisure"="sports_centre"]["climbing"]' },
  { category: "range", selector: '["sport"="shooting"]["leisure"!="pitch"]' },
  { category: "archery", selector: '["sport"="archery"]["leisure"!="pitch"]' },
  { category: "golf", selector: '["leisure"="golf_course"]' },
  { category: "zipline", selector: '["aerialway"="zip_line"]' },
  { category: "ski", selector: '["landuse"="winter_sports"]' },
  { category: "bike", selector: '["amenity"="bicycle_rental"]["network"!~"."]["operator"!~"bike ?share|citi ?bike|lime|bird|divvy|nice ride|indego|capital bikeshare"]' },
  { category: "snowmobile", selector: '["sport"="snowmobile"]' },
  { category: "rafting", selector: '["sport"~"rafting"]' },
  { category: "scuba", selector: '["shop"="scuba_diving"]' },
  { category: "scuba", selector: '["sport"="scuba_diving"]["shop"]' },
  { category: "surf", selector: '["sport"="surfing"]["shop"]' },
  { category: "surf", selector: '["shop"="surf"]' },
  { category: "paragliding", selector: '["sport"="free_flying"]' },
  { category: "gliding", selector: '["sport"="gliding"]' },
  { category: "brewery", selector: '["craft"="brewery"]' },
  { category: "brewery", selector: '["microbrewery"="yes"]["name"]' },
  { category: "winery", selector: '["craft"="winery"]' },
  { category: "distillery", selector: '["craft"="distillery"]' },
  { category: "spa", selector: '["leisure"="spa"]' },
  { category: "spa", selector: '["shop"="massage"]' },
  { category: "yoga", selector: '["sport"="yoga"]' },
  { category: "dance", selector: '["leisure"="dance"]' },
  { category: "dance", selector: '["amenity"="dancing_school"]' },
  { category: "pottery", selector: '["craft"="pottery"]["shop"]' },
  { category: "cooking", selector: '["amenity"="cooking_school"]' },
];

/** Category from wave-two tags. Tags first; names disambiguate the broad ones. */
function pickCategoryW2(tags: Record<string, string>): string | null {
  const leisure = tags.leisure || "";
  const sport = (tags.sport || "").toLowerCase();
  const tourism = tags.tourism || "";
  const craft = tags.craft || "";
  const shop = tags.shop || "";
  const amenity = tags.amenity || "";
  const name = (tags.name || "").toLowerCase();
  if (leisure === "bowling_alley") return "bowling";
  if (leisure === "miniature_golf") return "minigolf";
  if (leisure === "amusement_arcade") return "arcade";
  if (leisure === "trampoline_park") return "trampoline";
  if (leisure === "laser_tag" || /laser_tag/.test(sport)) return "lasertag";
  if (leisure === "ice_rink") return "icerink";
  if (leisure === "water_park") return "waterpark";
  if (tourism === "theme_park") return "themepark";
  if (tourism === "zoo") return "zoo";
  if (tourism === "aquarium") return "aquarium";
  if (amenity === "karaoke_box") return "karaoke";
  if (/climbing/.test(sport) || tags.climbing) return "climbing";
  if (/shooting/.test(sport)) return /archery/.test(sport) ? "archery" : "range";
  if (/archery/.test(sport)) return "archery";
  if (leisure === "golf_course") return /private|country club/.test(name) && !/public|golf course|golf club/.test(name) ? null : "golf";
  if (tags.aerialway === "zip_line") return "zipline";
  if (tags.landuse === "winter_sports") return "ski";
  if (amenity === "bicycle_rental") return "bike";
  if (/snowmobile/.test(sport)) return "snowmobile";
  if (/rafting/.test(sport)) return "rafting";
  if (shop === "scuba_diving" || /scuba/.test(sport)) return "scuba";
  if (shop === "surf" || /surfing/.test(sport)) return "surf";
  if (/free_flying|paragliding|hang_gliding/.test(sport)) return "paragliding";
  if (/gliding/.test(sport)) return "gliding";
  if (craft === "brewery" || tags.microbrewery === "yes") return "brewery";
  if (craft === "winery") return "winery";
  if (craft === "distillery") return "distillery";
  if (leisure === "spa" || shop === "massage") return "spa";
  if (/yoga/.test(sport)) return "yoga";
  if (leisure === "dance" || amenity === "dancing_school") return "dance";
  if (craft === "pottery") return "pottery";
  if (amenity === "cooking_school") return "cooking";
  return null;
}

type OsmElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

function buildQuery(areaCode: string, selectors: string[]): string {
  const body = selectors.map((s) => `nwr(area.a)${s};`).join("");
  return `[out:json][timeout:90];area["ISO3166-2"="${areaCode}"]->.a;(${body});out tags center;`;
}

async function runOverpass(query: string, startAt = 0): Promise<OsmElement[]> {
  let lastErr: unknown = null;
  const order = ENDPOINTS.map((_, i) => ENDPOINTS[(i + startAt) % ENDPOINTS.length]);
  for (const endpoint of order) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "OutsetBot/0.1 (supply discovery)" },
        body: "data=" + encodeURIComponent(query),
        signal: AbortSignal.timeout(100000),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const json = (await res.json()) as { elements?: OsmElement[]; remark?: string };
      if (json.remark && /timed out|error/i.test(json.remark) && !json.elements?.length) throw new Error(json.remark);
      return json.elements || [];
    } catch (e) {
      lastErr = e;
      await sleep(3000);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Fetch one area, splitting selectors in half when Overpass times out. Cached on disk per area. */
export async function fetchArea(areaCode: string, force = false, endpointIdx = 0, wave = 1): Promise<OsmElement[]> {
  mkdirSync(cacheDir, { recursive: true });
  const cachePath = join(cacheDir, areaCode + (wave === 2 ? "-w2" : "") + ".json");
  if (!force && existsSync(cachePath)) return JSON.parse(readFileSync(cachePath, "utf8")) as OsmElement[];

  if (wave === 2) {
    // Wave two is forty selectors. Ask in chunks of eight and cache each chunk, so a slow state resumes where it stopped.
    const sels = SELECTORS_W2.map((s) => s.selector);
    const out: OsmElement[] = [];
    for (let i = 0; i < sels.length; i += 8) {
      const chunkPath = join(cacheDir, `${areaCode}-w2-c${i / 8}.json`);
      if (!force && existsSync(chunkPath)) {
        out.push(...(JSON.parse(readFileSync(chunkPath, "utf8")) as OsmElement[]));
        continue;
      }
      // Big states make the mirror time out on eight selectors. Halve until it answers.
      const fetchSels = async (part: string[]): Promise<OsmElement[]> => {
        try {
          return await runOverpass(buildQuery(areaCode, part), endpointIdx);
        } catch (e) {
          if (part.length <= 1) throw e;
          await sleep(2000);
          const mid = Math.ceil(part.length / 2);
          return [...(await fetchSels(part.slice(0, mid))), ...(await fetchSels(part.slice(mid)))];
        }
      };
      const got = await fetchSels(sels.slice(i, i + 8));
      writeFileSync(chunkPath, JSON.stringify(got));
      out.push(...got);
      await sleep(1000);
    }
    const seen2 = new Set<string>();
    const unique2 = out.filter((e) => { const k = e.type + "/" + e.id; if (seen2.has(k)) return false; seen2.add(k); return true; });
    writeFileSync(cachePath, JSON.stringify(unique2));
    return unique2;
  }
  const all = SELECTORS.map((s) => s.selector);
  const collect = async (sels: string[]): Promise<OsmElement[]> => {
    try {
      return await runOverpass(buildQuery(areaCode, sels), endpointIdx);
    } catch (e) {
      if (sels.length <= 2) throw e;
      const mid = Math.ceil(sels.length / 2);
      await sleep(5000);
      const a = await collect(sels.slice(0, mid));
      await sleep(5000);
      const b = await collect(sels.slice(mid));
      return [...a, ...b];
    }
  };
  const elements = await collect(all);
  const seen = new Set<string>();
  const unique = elements.filter((e) => {
    const k = e.type + "/" + e.id;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  writeFileSync(cachePath, JSON.stringify(unique));
  return unique;
}

const SOCIAL = /facebook\.com|instagram\.com|twitter\.com|x\.com|yelp\.com|tripadvisor\.|linktr\.ee|google\.com|bit\.ly/i;

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("http") ? url : "https://" + url);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function pickCategory(tags: Record<string, string>): string | null {
  const leisure = tags.leisure || "";
  const sport = (tags.sport || "").toLowerCase();
  const rental = (tags.rental || "").toLowerCase();
  const name = (tags.name || "").toLowerCase();
  if (leisure === "escape_game") return "escape";
  if (/axe_throwing/.test(sport)) return "axe";
  if (/karting/.test(sport)) return "kart";
  if (/paintball/.test(sport)) return "paintball";
  if (/skydiv|parachut/.test(sport)) return "skydive";
  if (leisure === "horse_riding") return "horse";
  if (/balloon/.test(sport)) return "balloon";
  if (/parasail/.test(sport)) return "parasail";
  if (/jet_?ski|pwc|waverunner/.test(rental) || /jet ?ski|waverunner/.test(name)) return "jetski";
  if (/pontoon/.test(rental) || /pontoon/.test(name)) return "pontoon";
  if (/paddle|sup\b/.test(rental) && !/kayak|canoe/.test(rental)) return "paddleboard";
  if (tags.amenity === "boat_rental" || /kayak|canoe|sup|paddle/.test(rental) || tags.shop === "boat" || /canoe|kayak/.test(sport)) {
    if (/fish|charter/.test(name)) return "fishing";
    if (/sail|cruise/.test(name)) return "cruise";
    return "kayak";
  }
  if (tags.shop === "fishing") return /charter|guide/.test(name) ? "fishing" : null;
  if (tags.tourism === "attraction") return "cruise";
  if (tags.aeroway === "heliport") return "heli";
  return null;
}

export type DiscoverStats = { area: string; found: number; inserted: number; updated: number; skipped: number };

/** Insert or refresh operators from one area's OSM elements. Keyed by website domain, else by OSM ref. */
export function loadArea(area: (typeof AREAS)[number], elements: OsmElement[], wave = 1): DiscoverStats {
  const stats: DiscoverStats = { area: area.code, found: elements.length, inserted: 0, updated: 0, skipped: 0 };
  const now = nowIso();
  const insert = db.prepare(
    `INSERT INTO operators (
      id, domain, name, website, phone, email, street, postal, hours, metro_id, city, region, country, family, category_id,
      icon_key, claim_status, booking_mode, origin, completeness, lat, lon, osm_ref, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unclaimed', 'request', 'osm', 0, ?, ?, ?, ?, ?)
    ON CONFLICT(domain) DO UPDATE SET
      phone = COALESCE(operators.phone, excluded.phone),
      email = COALESCE(operators.email, excluded.email),
      street = COALESCE(operators.street, excluded.street),
      postal = COALESCE(operators.postal, excluded.postal),
      hours = COALESCE(operators.hours, excluded.hours),
      city = COALESCE(operators.city, excluded.city),
      lat = COALESCE(operators.lat, excluded.lat),
      lon = COALESCE(operators.lon, excluded.lon),
      osm_ref = COALESCE(operators.osm_ref, excluded.osm_ref),
      metro_id = COALESCE(operators.metro_id, excluded.metro_id),
      updated_at = excluded.updated_at`,
  );
  const exists = db.prepare("SELECT 1 FROM operators WHERE domain = ?");

  for (const el of elements) {
    const t = el.tags || {};
    const name = (t.name || "").trim();
    if (!name || name.length < 3) {
      stats.skipped += 1;
      continue;
    }
    const category = wave === 2 ? pickCategoryW2(t) : pickCategory(t);
    if (!category) {
      stats.skipped += 1;
      continue;
    }
    const cat = categoryById(category);
    if (!cat) {
      stats.skipped += 1;
      continue;
    }
    const website = t.website || t["contact:website"] || t.url || null;
    const host = hostOf(website || undefined);
    const osmRef = el.type + "/" + el.id;
    const domain = host && !SOCIAL.test(host) ? host : "osm-" + osmRef.replace("/", "-");
    const lat = el.lat ?? el.center?.lat ?? null;
    const lon = el.lon ?? el.center?.lon ?? null;
    const metro = lat != null && lon != null ? nearestMetro(lat, lon, 160) : null;
    const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ") || null;
    const city = t["addr:city"] || metro?.name || null;
    const phone = t.phone || t["contact:phone"] || null;
    const email = t.email || t["contact:email"] || null;
    const hours = t.opening_hours || null;
    const was = exists.get(domain);
    insert.run(
      randomUUID(), domain, name, website, phone, email, street, t["addr:postcode"] || null, hours,
      metro?.id || null, city, t["addr:state"] || area.region, area.country, cat.family, cat.id, cat.iconKey,
      lat, lon, osmRef, now, now,
    );
    if (was) stats.updated += 1;
    else stats.inserted += 1;
  }
  return stats;
}

export async function discoverAll(opts: { only?: string[]; force?: boolean; concurrency?: number; wave?: number } = {}): Promise<DiscoverStats[]> {
  const out: DiscoverStats[] = [];
  const areas = opts.only?.length ? AREAS.filter((a) => opts.only!.includes(a.code) || opts.only!.includes(a.region)) : AREAS;
  const workers = Math.max(1, Math.min(opts.concurrency ?? 3, 4));
  let next = 0;
  const worker = async (w: number) => {
    while (next < areas.length) {
      const area = areas[next++];
      const started = Date.now();
      try {
        const elements = await fetchArea(area.code, opts.force, w % ENDPOINTS.length, opts.wave ?? 1);
        const stats = loadArea(area, elements, opts.wave ?? 1);
        out.push(stats);
        console.log(`${area.code}: ${stats.found} found, ${stats.inserted} new, ${stats.updated} updated, ${stats.skipped} skipped (${Math.round((Date.now() - started) / 1000)}s)`);
      } catch (e) {
        console.error(`${area.code}: failed, ${(e as Error).message}`);
        out.push({ area: area.code, found: 0, inserted: 0, updated: 0, skipped: 0 });
      }
      await sleep(1500);
    }
  };
  await Promise.all(Array.from({ length: Math.min(workers, areas.length) }, (_, w) => worker(w)));
  return out;
}

export function metroCoverage(): { metros: number; covered: number; categories: number } {
  const rows = db.prepare("SELECT DISTINCT metro_id FROM operators WHERE metro_id IS NOT NULL").all();
  return { metros: METROS.length, covered: rows.length, categories: CATEGORIES.length };
}
