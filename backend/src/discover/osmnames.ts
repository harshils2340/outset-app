import { hostOf, phoneE164, type Candidate, dedupeCandidates } from "./chains.ts";
import { nearestDestination } from "./florida.ts";
import { BOT, sleep } from "./polite.ts";

/**
 * OpenStreetMap by name, Florida only.
 *
 * The tag waves in osm.ts find what mappers tag well (escape_game, craft=winery). Classes, studios and tours
 * are rarely tagged as such, but they are named plainly: "Tampa Bay Axe Throwing", "Key West Food Tours",
 * "Clay Studio Sarasota". One Overpass request over the Florida area asks for any named business whose name
 * carries one of these words; each result is then classified here by a stricter JavaScript pattern, and
 * anything that is plainly not the activity (a restaurant called "Chef Tony's", a street, a school) is dropped.
 *
 * No database: this runs on a GitHub runner. OSM data is ODbL.
 */

// mail.ru runs a full-planet mirror that stays up when overpass-api.de rate-limits a burst.
const ENDPOINTS = ["https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

type OsmElement = { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

/** Name pattern, the category it lands in, and the activity label. First match wins, so specific before broad. */
export const NAME_PATTERNS: { re: RegExp; kind: string; activity: string; allowFood?: boolean }[] = [
  { re: /\bescape (room|rooms|game|games|experience|quest|zone|house)\b|escapology|breakout games|puzzle rooms?\b|room escape|\bthe escape game\b/i, kind: "escape", activity: "escape-room" },
  { re: /\baxe[- ]?throw|\baxe (house|bar|lounge|club|arena|nation|kickers)|hatchet house|\baxes\b|\bthrow(ing)? axes?\b|axe-?cellent|lumberjaxes/i, kind: "axe", activity: "axe-throwing", allowFood: true },
  { re: /\brage (room|cage)|\bsmash (room|shack|house)|\bwreck room|\banger room/i, kind: "rage", activity: "rage-room" },
  { re: /\bpaint(ing)? ?(and|&|n'?|'?n'?) ?sip|\bsip ?(and|&|n'?|'?n'?) ?paint|painting with a twist|pinot'?s palette|\bwine (and|&) design\b|\bpaint ?bar\b|board (and|&) brush|canvas (and|&) (cocktails|wine)|brush(es)? (and|&) (wine|bubbles)|\bmuse paintbar/i, kind: "pottery", activity: "paint-and-sip", allowFood: true },
  { re: /\bmixology|\bcocktail (class|classes|school|lab|academy|workshop)|\bbartending (school|academy|class)/i, kind: "cooking", activity: "cocktail-class", allowFood: true },
  { re: /\bcooking (school|class|classes|studio|academy|lab|workshop)|\bculinary (school|studio|center|centre|academy|institute|kitchen|arts|classroom)|\bchef'?s? (school|academy|studio|workshop)|\bkitchen (classroom|studio)\b|\bsur la table\b|\bthe chef'?s table cooking/i, kind: "cooking", activity: "cooking-class" },
  { re: /\bpottery|\bceramics? (studio|studios|class|classes|school|art|arts|center)|\bclay (studio|studios|works|school|center|art)|\bcolor me mine\b|\bpaint your own\b|\bpaint-your-own/i, kind: "pottery", activity: "pottery" },
  { re: /\bglass ?blow|\bglassblowing|\bhot glass\b|\bglass (studio|art studio|school)\b/i, kind: "pottery", activity: "glass-blowing" },
  { re: /\bcandle (making|bar|studio|lab|workshop|pouring|co\.? studio)|\bpour your own\b/i, kind: "pottery", activity: "candle-making" },
  { re: /\bterrarium/i, kind: "pottery", activity: "terrarium" },
  { re: /\b(diy|creative|craft|art) (workshop|workshops)\b|\bmakerspace\b|\bmaker ?space\b|\bdiy studio\b/i, kind: "pottery", activity: "workshop" },
  { re: /\bclimbing\b|\bbouldering\b|\brock gym\b|\bboulder (gym|house|lounge|project)|\bclimb (gym|center|centre)/i, kind: "climbing", activity: "climbing-gym" },
  { re: /\btrampoline|\bsky zone\b|\burban air\b|\bjump(ing)? (park|zone|arena)\b|\bflying squirrel\b/i, kind: "trampoline", activity: "trampoline-park" },
  { re: /\bla[sz]er ?tag|\blaser quest|\blaser (game|games|arena|maze)\b/i, kind: "lasertag", activity: "laser-tag" },
  { re: /\bkaraoke/i, kind: "karaoke", activity: "karaoke", allowFood: true },
  { re: /\bvirtual reality|\bvr (arena|arcade|experience|lounge|world|center|centre|zone|gaming|game)|\bsandbox vr\b|\bzero latency\b/i, kind: "arcade", activity: "vr" },
  { re: /\bgo[- ]?karts?\b|\bkarting\b|\bkart (track|racing|center|centre|raceway)|\bk1 speed\b/i, kind: "kart", activity: "go-karts" },
  { re: /\bghosts?\b.*\b(tours?|walks?)\b|\bhaunted\b.*\b(tours?|walks?)\b|\bghosts? (and|&) gravestones|\bparanormal tours?/i, kind: "tour", activity: "ghost-tour" },
  { re: /\bfood (tours?|walks?)\b|\bculinary (tours?|walks?)\b|\btasting tours?\b/i, kind: "tour", activity: "food-tour" },
  { re: /\bwalking tours?\b|\bhistoric(al)? tours?\b|\btrolley tours?\b|\bsegway\b/i, kind: "tour", activity: "walking-tour" },
  { re: /\bairboat/i, kind: "cruise", activity: "airboat-tour" },
  { re: /\bdolphin (tours?|cruises?|watch|watching|adventures?|excursions?|encounters?|quest|safari)|\bdolphin\b.*\b(tours|cruises|charters)\b/i, kind: "cruise", activity: "dolphin-tour" },
  { re: /\bsnorkel/i, kind: "scuba", activity: "snorkel-tour" },
  { re: /\beco[- ]?(tours?|adventures?|excursions?)\b|\becotours?\b/i, kind: "cruise", activity: "eco-tour" },
  { re: /\bpaddle ?board|\bstand[- ]up paddle|\bsup (rentals?|tours?|yoga|shop|co)\b/i, kind: "paddleboard", activity: "paddleboard" },
  { re: /\bkayak|\bcanoe/i, kind: "kayak", activity: "kayak" },
  { re: /\bwinery\b|\bvineyards?\b|\bwine ?works\b/i, kind: "winery", activity: "winery", allowFood: true },
  { re: /\bdistill/i, kind: "distillery", activity: "distillery", allowFood: true },
  { re: /\bbrewery\b|\bbrewing (company|co\b|co\.)|\bbrewpub\b|\bbrew ?works\b|\bbeer ?works\b|\bbrewhouse\b/i, kind: "brewery", activity: "brewery", allowFood: true },
];

/** Overpass (POSIX ERE, case-insensitive) prefilter. Broad on purpose; NAME_PATTERNS decides. */
const OVERPASS_WORDS = [
  "escape", "escapology", "breakout", "puzzle room", "axe", "hatchet", "rage room", "rage cage", "smash", "wreck room",
  "paint.{0,5}sip", "sip.{0,5}paint", "painting with a twist", "pinot.?s palette", "wine .{1,3} design", "paint ?bar", "board .{1,3} brush", "canvas .{1,3} ",
  "mixology", "cocktail", "bartending", "cooking", "culinary", "chef", "sur la table", "kitchen (classroom|studio)",
  "pottery", "ceramic", "clay", "color me mine", "paint.your.own", "glass", "candle", "pour your own", "terrarium", "workshop", "maker ?space", "diy studio",
  "climb", "boulder", "rock gym", "trampoline", "sky zone", "urban air", "jump", "flying squirrel", "la[sz]er", "karaoke",
  "virtual reality", "vr ", "zero latency", "kart", "k1 speed",
  "ghost", "haunted", "paranormal", "food tour", "food walk", "culinary tour", "tasting tour", "walking tour", "historic.{0,3} tour", "trolley", "segway",
  "airboat", "dolphin", "snorkel", "eco.?tour", "eco.?adventure", "eco.?excursion", "paddle", "sup ", "kayak", "canoe",
  "winery", "vineyard", "wine ?works", "distill", "brew", "beer ?works",
];

/** Names that are never the activity, whatever word they contain. */
const NOT_A_BUSINESS = /\b(school district|elementary|middle school|high school|academy charter|church|chapel|apartments?|condominium|condos?|hotel|motel|suites|inn|liquor|package store|supply|supplies|repair|storage|hospital|clinic|dental|dentist|salon|barber|nails?|realty|real estate|insurance|attorney|law office|parking|(kayak|canoe|boat|paddle) (launch|landing)|boat ramp|put[- ]?in|trailhead|trail head|access point|preserve|state park|county park|cemetery|thrift|pawn|auto|tire|collision|plumbing|roofing|glass (and|&) mirror|auto glass|window|windshield|glazing|closed|former|permanently)\b/i;

/** Tags that mark a place people go to: a business, venue or attraction rather than a road or a boundary. */
const BUSINESS_KEYS = ["amenity", "leisure", "shop", "tourism", "craft", "office", "club", "sport"];

/** Tag values that can carry a matching name but are never a bookable experience. */
const NOT_EXPERIENCE: Record<string, RegExp> = {
  amenity: /^(parking|parking_entrance|place_of_worship|school|kindergarten|college|university|fuel|bank|atm|toilets|bench|shelter|waste_basket|drinking_water|post_office|police|fire_station|hospital|clinic|doctors|dentist|pharmacy|car_wash|vending_machine|recycling|townhall|courthouse|social_facility|grave_yard|charging_station|boat_ramp|marketplace|fast_food|ice_cream)$/,
  shop: /^(hairdresser|beauty|nails|clothes|shoes|car|car_repair|car_parts|tyres|hardware|doityourself|furniture|glaziery|mobile_phone|electronics|supermarket|convenience|alcohol|wine|beverages|tobacco|e-cigarette|vacant|laundry|dry_cleaning|pawnbroker|second_hand|charity|kitchen|houseware|bathroom_furnishing|trade|window_blind|curtain|jewelry|optician|chemist|pet|florist|garden_centre|boat|fishing|outdoor|sports|bicycle|variety_store|department_store|gift|mall|interior_decoration|appliance|cannabis)$/,
  tourism: /^(information|hotel|motel|guest_house|apartment|camp_site|caravan_site|chalet|hostel|viewpoint|picnic_site)$/,
  leisure: /^(slipway|marina|park|nature_reserve|pitch|playground|picnic_table|swimming_pool|garden|dog_park|track|firepit|common|outdoor_seating|fishing)$/,
  office: /^(lawyer|insurance|estate_agent|accountant|government|financial|it|company|association|educational_institution|religion|ngo|political_party|telecommunication|coworking)$/,
};

const FOOD = /^(restaurant|bar|pub|biergarten|cafe|nightclub)$/;

function classify(tags: Record<string, string>): { kind: string; activity: string } | null {
  const name = (tags.name || "").trim();
  if (name.length < 3 || NOT_A_BUSINESS.test(name)) return null;
  if (Object.keys(tags).some((k) => /^(disused|abandoned|was|removed|demolished):/.test(k))) return null;
  if (!BUSINESS_KEYS.some((k) => tags[k])) return null;
  if (tags.highway || tags.route || tags.railway || tags.waterway || tags.natural || tags.place || tags.boundary) return null;
  for (const p of NAME_PATTERNS) {
    if (!p.re.test(name)) continue;
    if (FOOD.test(tags.amenity || "") && !p.allowFood) return null;
    for (const [k, re] of Object.entries(NOT_EXPERIENCE)) {
      const v = tags[k];
      if (!v || !re.test(v)) continue;
      // A kayak outfitter is often tagged shop=outdoor or leisure=marina; keep those for water activities.
      if (/^(kayak|paddleboard|cruise|scuba)$/.test(p.kind) && /^(outdoor|sports|boat|marina|fishing)$/.test(v)) continue;
      if (p.kind === "winery" && v === "wine") continue;
      return null;
    }
    return { kind: p.kind, activity: p.activity };
  }
  return null;
}

/**
 * Key first, then name. Asking for every named element in Florida and filtering by name makes Overpass read
 * every named road and stream in the state (the first test of that shape timed out at four minutes); asking
 * per business key uses the key index and runs the name pattern over a small set.
 */
export function buildNamesQuery(keys: string[] = BUSINESS_KEYS, words: string[] = OVERPASS_WORDS, timeout = 300): string {
  const re = words.join("|").replace(/"/g, '\\"');
  return `[out:json][timeout:${timeout}];area["ISO3166-2"="US-FL"]->.a;(${keys.map((k) => `nwr(area.a)["${k}"]["name"~"${re}",i];`).join("")});out tags center;`;
}

async function overpass(query: string): Promise<OsmElement[]> {
  let last: unknown = null;
  for (const endpoint of ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": BOT },
        body: "data=" + encodeURIComponent(query),
        signal: AbortSignal.timeout(330_000),
      });
      if (!res.ok) throw new Error(endpoint + " HTTP " + res.status);
      const json = (await res.json()) as { elements?: OsmElement[]; remark?: string };
      if (json.remark && /timed out|error|out of memory/i.test(json.remark)) throw new Error(json.remark.slice(0, 120));
      return json.elements || [];
    } catch (e) {
      last = e;
      await sleep(10_000);
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/**
 * Fetch Florida elements whose names match. One request for all business keys; if every mirror refuses it,
 * the keys are split in half and each half asked separately (at most seven requests, never a sweep).
 */
export async function fetchFloridaByName(opts: { keys?: string[]; split?: boolean; log?: (m: string) => void } = {}): Promise<{ elements: OsmElement[]; requests: number }> {
  const log = opts.log || console.log;
  let requests = 0;
  const run = async (keys: string[]): Promise<OsmElement[]> => {
    requests += 1;
    try {
      return await overpass(buildNamesQuery(keys));
    } catch (e) {
      if (opts.split === false || keys.length <= 2) throw e;
      log(`  Overpass refused keys ${keys.join(",")} (${(e as Error).message.slice(0, 80)}); splitting`);
      const mid = Math.ceil(keys.length / 2);
      const a = await run(keys.slice(0, mid));
      await sleep(15_000);
      return [...a, ...(await run(keys.slice(mid)))];
    }
  };
  const all = await run(opts.keys || BUSINESS_KEYS);
  const seen = new Set<string>();
  return { elements: all.filter((e) => (seen.has(e.type + e.id) ? false : (seen.add(e.type + e.id), true))), requests };
}

const SOCIAL = /facebook\.com|instagram\.com|twitter\.com|x\.com|yelp\.com|tripadvisor\.|linktr\.ee|google\.com|goo\.gl|bit\.ly|tiktok\.com|youtube\.com|square\.site|business\.site/i;

export function candidatesFromElements(elements: OsmElement[]): { candidates: Candidate[]; matched: number; dropped: number } {
  const out: Candidate[] = [];
  let dropped = 0;
  for (const el of elements) {
    const t = el.tags || {};
    const hit = classify(t);
    if (!hit) {
      dropped += 1;
      continue;
    }
    const lat = el.lat ?? el.center?.lat ?? null;
    const lon = el.lon ?? el.center?.lon ?? null;
    const state = (t["addr:state"] || "").toUpperCase();
    if (state && state !== "FL" && state !== "FLORIDA") {
      dropped += 1;
      continue;
    }
    const website = t.website || t["contact:website"] || t.url || null;
    const host = hostOf(website);
    const ref = `${el.type}/${el.id}`;
    const domain = host && !SOCIAL.test(host) ? host : "osm-" + ref.replace("/", "-");
    const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ") || null;
    const city = t["addr:city"] || (lat != null && lon != null ? nearestDestination(lat, lon)?.name : null) || null;
    out.push({
      name: t.name.trim().slice(0, 90),
      website: host && !SOCIAL.test(host) ? website : null,
      domain,
      street,
      city,
      region: "FL",
      postal: t["addr:postcode"] ? t["addr:postcode"].slice(0, 5) : null,
      lat,
      lon,
      phone: phoneE164(t.phone || t["contact:phone"]),
      kind: hit.kind,
      source: "osm",
      sourceUrl: `https://www.openstreetmap.org/${ref}`,
      activity: hit.activity,
    });
  }
  const candidates = dedupeCandidates(out);
  return { candidates, matched: out.length, dropped };
}
