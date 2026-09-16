/**
 * What time it is where the shop is.
 *
 * Slot times are wall clock times in the operator's own town: a shop open 9 to 5 means 9 to 5 there. The API
 * runs on Render in UTC, and building those times with `new Date(y, m, d, hh, mm)` builds them in the server's
 * zone, so a Pacific shop's 1 PM became 1 PM UTC, which is 5 AM to them. Everything after that compared the
 * wrong instants: at 11 AM Pacific a 9-to-5 Pacific shop offered no times at all for the rest of the day, and
 * after 5 PM Pacific the API had already moved on to tomorrow. Every shop in North America is behind UTC, so
 * every one of them lost the back half of its day.
 *
 * The zone comes from the listing's own region, the same mapping the guest app uses in src/lib/openNow.ts.
 * When there is no region and no coordinates, everything here returns null and the caller keeps the old
 * behaviour, which is right for a listing we know nothing about.
 */

const REGION_TZ: Record<string, string> = {
  // United States
  CT: "America/New_York", DE: "America/New_York", FL: "America/New_York", GA: "America/New_York", ME: "America/New_York", MD: "America/New_York", MA: "America/New_York", NH: "America/New_York", NJ: "America/New_York", NY: "America/New_York", NC: "America/New_York", OH: "America/New_York", PA: "America/New_York", RI: "America/New_York", SC: "America/New_York", VT: "America/New_York", VA: "America/New_York", WV: "America/New_York", DC: "America/New_York", MI: "America/Detroit", IN: "America/Indiana/Indianapolis", KY: "America/New_York", TN: "America/Chicago",
  AL: "America/Chicago", AR: "America/Chicago", IL: "America/Chicago", IA: "America/Chicago", KS: "America/Chicago", LA: "America/Chicago", MN: "America/Chicago", MS: "America/Chicago", MO: "America/Chicago", NE: "America/Chicago", ND: "America/Chicago", OK: "America/Chicago", SD: "America/Chicago", TX: "America/Chicago", WI: "America/Chicago",
  AZ: "America/Phoenix", CO: "America/Denver", ID: "America/Boise", MT: "America/Denver", NM: "America/Denver", UT: "America/Denver", WY: "America/Denver",
  CA: "America/Los_Angeles", NV: "America/Los_Angeles", OR: "America/Los_Angeles", WA: "America/Los_Angeles", AK: "America/Anchorage", HI: "Pacific/Honolulu",
  // Canada
  ON: "America/Toronto", QC: "America/Toronto", NS: "America/Halifax", NB: "America/Moncton", PE: "America/Halifax", NL: "America/St_Johns", MB: "America/Winnipeg", SK: "America/Regina", AB: "America/Edmonton", BC: "America/Vancouver", YT: "America/Whitehorse", NT: "America/Yellowknife", NU: "America/Iqaluit",
};

/**
 * The IANA zone for a listing, from its area line ("Clearwater Beach, FL") and coordinates when it has them.
 * The refinements are the states a single zone gets wrong, and they match src/lib/openNow.ts exactly.
 */
/**
 * The state or province an area line names. Usually the code after the comma ("Clearwater Beach, FL"), but an
 * operator whose town was never read publishes the code on its own ("ON"), which is an honest gap rather than
 * a missing region: 4,736 rows in the shipped catalog, 1,030 of them Canadian. Every candidate is checked
 * against the table, so a two letter word inside a place name cannot stand in for a region, and the town is
 * never read, so the catalog's "Mt, NJ" stays in New Jersey instead of moving to Montana.
 *
 * Mirrors regionOf in src/lib/openNow.ts.
 */
export function regionOfArea(area?: string | null): string | undefined {
  const parts = String(area || "").split(",");
  for (const part of parts.slice(parts.length > 1 ? 1 : 0)) {
    const code = part.trim().toUpperCase();
    if (code.length === 2 && REGION_TZ[code]) return code;
  }
  return undefined;
}

export function zoneForArea(area?: string | null, lat?: number | null, lon?: number | null): string | null {
  const region = regionOfArea(area);
  if (region === "FL" && lon != null && lon < -85.1) return "America/Chicago";
  if (region === "TX" && lon != null && lon < -105) return "America/Denver";
  if (region === "KY" && lon != null && lon < -86.4) return "America/Chicago";
  if (region === "TN" && lon != null && lon > -85.3) return "America/New_York";
  if ((region === "ND" || region === "SD" || region === "NE" || region === "KS") && lon != null && lon < -101) return "America/Denver";
  // Mountain time in Oregon is Malheur County, the south east corner, so it is the east of the state that
  // moves and not the west: Portland, Salem and the whole coast are Pacific.
  if (region === "OR" && lon != null && lon > -118.3 && lat != null && lat < 44.3) return "America/Boise";
  if (region === "ID" && lat != null && lat > 45.6) return "America/Los_Angeles";
  if (region === "MI" && lon != null && lon < -88.5) return "America/Chicago";
  if (region === "BC" && lon != null && lon > -116) return "America/Edmonton";
  if (region && REGION_TZ[region]) return REGION_TZ[region];
  if (lon == null) return null;
  if (lon < -140) return "America/Anchorage";
  if (lon < -114) return "America/Los_Angeles";
  if (lon < -102) return "America/Denver";
  if (lon < -87) return "America/Chicago";
  if (lon < -67) return "America/New_York";
  return "America/Halifax";
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function parts(zone: string, at: number): { y: number; m: number; d: number; hh: number; mi: number } {
  let f = fmtCache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    fmtCache.set(zone, f);
  }
  const got: Record<string, string> = {};
  for (const p of f.formatToParts(new Date(at))) if (p.type !== "literal") got[p.type] = p.value;
  // "24" appears at midnight in some runtimes for hour12:false.
  const hh = Number(got.hour) % 24;
  return { y: Number(got.year), m: Number(got.month), d: Number(got.day), hh, mi: Number(got.minute) };
}

/** The calendar date it is right now where the shop is, as YYYY-MM-DD. */
export function todayIn(zone: string, now: Date = new Date()): string {
  const p = parts(zone, now.getTime());
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/**
 * The instant at which a wall clock time happens in a zone: "2026-10-06" and "13:00" in America/Los_Angeles is
 * 20:00 UTC. Done by guessing the instant as if the wall time were UTC, measuring how far off that guess reads
 * in the zone, and correcting, which handles every offset including the half hour ones. The correction is
 * applied twice because the offset itself can change across a daylight saving boundary.
 */
export function instantOf(date: string, hhmm: string, zone: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m || !t) return NaN;
  const want = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2]));
  let guess = want;
  for (let i = 0; i < 2; i++) {
    const p = parts(zone, guess);
    const reads = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mi);
    const drift = want - reads;
    if (drift === 0) break;
    guess += drift;
  }
  return guess;
}
