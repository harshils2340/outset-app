import { hostOf, type Candidate, dedupeCandidates } from "./chains.ts";
import { FL_DESTINATIONS, FL_TERMS, type Destination, type ExperienceTerm } from "./florida.ts";
import { sleep } from "./polite.ts";

/**
 * Web search through the official Brave Search API (free tier), Florida destinations crossed with experience
 * terms. This replaces nothing and scrapes nothing: websearch.ts reads Brave's HTML page, which this module
 * deliberately does not extend. Without BRAVE_SEARCH_API_KEY the step is skipped.
 *
 * Only the operator's own site is kept. Aggregators, marketplaces, directories, social networks, news sites,
 * tourism boards and booking-widget hosts are dropped; so is a listicle title, a result that never mentions the
 * activity, a result that never places itself in Florida, and a host that turns up in five or more destinations
 * (a directory, not a local operator).
 *
 * No database. Raw results are kept per query in a state file the workflow commits, so a free monthly quota
 * is spread across weekly runs (oldest queries first) and candidates are always rebuilt from every query ever
 * answered, which lets a better filter re-judge old results without spending a query.
 */

const ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

export type BraveHit = { url: string; title: string; description: string };
export type BraveState = { queries: Record<string, { at: string; hits: BraveHit[] }> };

export const DROP_HOSTS = new RegExp(
  "(^|\\.)(" +
    [
      // travel marketplaces and aggregators
      "tripadvisor", "viator", "getyourguide", "klook", "tiqets", "headout", "musement", "expedia", "booking", "hotels", "kayak", "priceline", "orbitz", "travelocity", "trip", "agoda", "vrbo", "airbnb", "groupon", "livingsocial", "cozymeal", "classpop", "classbento", "coursehorse", "classpass", "eventbrite", "allevents", "feverup", "fever", "meetup", "sofarsounds", "tourradar", "toursbylocals", "withlocals", "civitatis", "isango", "tripshock", "undercovertourist", "floridatix", "reserveamerica", "recreation", "hipcamp", "boatsetter", "getmyboat", "sailo", "fishingbooker", "captainexperiences", "wavve", "click-and-boat", "clickandboat", "nautal", "yachtlife", "peek", "fareharbor", "xola", "rezdy", "bookeo", "checkfront", "resova", "trekksoft", "rootrez", "zaui", "ticketmaster", "stubhub", "vividseats", "seatgeek", "goldstar", "tock", "exploretock", "opentable", "resy", "sevenrooms", "mindbodyonline", "mindbody", "vagaro", "fresha", "booksy", "styleseat", "schedulicity", "acuityscheduling", "squareup", "square", "wixsite", "godaddysites", "weebly", "business", "linktr", "spafinder", "spaandwellness", "dayspasfinder", "zenoti", "massagebook", "urbansitter", "activekids", "sawyer", "activityhero", "kidpass", "macaroni", "mommypoppins", "redtri",
      // reviews, directories, maps
      "yelp", "yellowpages", "superpages", "mapquest", "bbb", "foursquare", "manta", "chamberofcommerce", "angi", "angieslist", "homeadvisor", "thumbtack", "bark", "nextdoor", "birdeye", "trustpilot", "sitejabber", "hotfrog", "brownbook", "cylex", "merchantcircle", "local", "citysearch", "yahoo", "bing", "google", "apple", "waze", "zomato", "restaurantji", "menupix", "allmenus", "roadtrippers", "wanderlog", "atlasobscura", "alltrails", "tripbuzz", "familyvacationcritic", "escaperoomers", "roomescapeartist", "morty", "escapetalk", "escaperoomdirectory", "axethrowingnear", "worldaxethrowingleague", "watl", "natf", "mountainproject", "climbfind", "gymsnearme", "trampolineparks", "breweries", "brewerydb", "untappd", "beeradvocate", "ratebeer", "winery", "wineries", "floridawine", "vinoflorida", "ghosttoursinfo", "tourscanner", "tourhound", "dolphinwatchtours", "divessi", "padi", "scubaboard", "shoreexcursionsgroup", "cruisecritic", "shoreexcursioneer", "portsamerica",
      // social and media
      "facebook", "fb", "instagram", "tiktok", "youtube", "youtu", "reddit", "twitter", "x", "threads", "pinterest", "linkedin", "quora", "medium", "substack", "tumblr", "wikipedia", "wikivoyage", "wikitravel", "fandom", "imdb",
      // travel editorial and news
      "timeout", "thrillist", "cntraveler", "lonelyplanet", "travelandleisure", "fodors", "frommers", "afar", "tripsavvy", "theculturetrip", "cultureTrip", "roughguides", "travelawaits", "matadornetwork", "thepointsguy", "10best", "usatoday", "nytimes", "washingtonpost", "forbes", "businessinsider", "buzzfeed", "eater", "infatuation", "theinfatuation", "secretmiami", "secrettampa", "secretorlando", "miaminewtimes", "cltampa", "orlandoweekly", "timeoutmiami", "tampabay", "miamiherald", "orlandosentinel", "sun-sentinel", "palmbeachpost", "news-press", "heraldtribune", "naplesnews", "jacksonville", "news4jax", "firstcoastnews", "tallahassee", "pnj", "nwfdailynews", "keysnews", "flkeysnews", "tcpalm", "floridatoday", "clickorlando", "wesh", "wftv", "fox13news", "wfla", "wtsp", "baynews9", "mynews13", "nbcmiami", "local10", "wsvn", "cbsnews", "abcnews", "nbcnews", "patch", "axios", "bizjournals", "floridatrend", "floridarambler", "onlyinyourstate", "tripstodiscover", "familydestinationsguide", "floridabeachesinsider", "florida-backroads-travel", "floridaforboomers", "floridaescapes", "orlandoinformer", "attractionsmagazine", "wdwinfo", "disneyfoodblog", "touringplans", "mousesavers", "undercovertourist", "tampamagazines", "miamiandbeaches", "gomiami",
      // tourism boards and chambers
      "visitflorida", "visitorlando", "visittampabay", "visitstpeteclearwater", "visitjacksonville", "visitjax", "fla-keys", "floridakeys", "visitsarasota", "visitpensacola", "visitpanamacitybeach", "destinfwb", "visitsouthwalton", "visitlauderdale", "sunny", "thepalmbeaches", "paradisecoast", "visitnaples", "visitftmyers", "fortmyers-sanibel", "floridashistoriccoast", "visitstaugustine", "daytonabeach", "visitspacecoast", "visitgainesville", "visittallahassee", "experiencekissimmee", "keywestchamber", "keywesttravelguide", "miamibeachfl", "visitlakeland", "visitcentralflorida", "visitvero", "visitstlucie", "discovermartin", "palmbeachfl", "bocaratonchamber", "delraybeach", "visitdelraybeach", "bradentongulfislands", "visitcitrus", "discovercrystalriverfl", "visitnaturecoast", "floridasadventurecoast", "visitseminole", "visitlakecounty", "floridasportscoast", "visitflagler", "ameliaisland", "visitsebring", "visitmelbourne", "sanibel-captiva", "marcoislandchamber", "islamoradachamber", "keylargochamber", "floridakeysmarathon", "visitkeywest",
    ].join("|") +
    ")\\.(com|net|org|co|io|us|travel|info|site|app|me|ly|be|ee|fl\\.us)$",
  "i",
);

const GOV_EDU = /\.(gov|edu|mil|k12\.fl\.us|fl\.us)$|^(www\.)?(cityof|townof|countyof|myfwc|floridastateparks|fws|nps)[a-z.-]*$/i;
/** Chamber, CVB and generic tourism-board naming, whatever the destination. */
const BOARD_HOST = /^(visit|go|discover|explore|experience|love)[a-z-]*(florida|fl|beach|keys|coast|county|city|island|orlando|tampa|miami|naples|destin|pensacola|sarasota|clearwater|jax|kissimmee)|chamber|cvb|tourism|touristdevelopment/i;
const LISTICLE = /\b(best|top[- ]?\d+|top[- ]?rated|\d+\s+(best|things|places|fun|amazing|unique|great|cool)|things to do|guide to|ultimate guide|near me|list of|review(s|ed)?\b|vs\.?|coupons?|deals?|tickets? (from|for) \$|updated 20\d\d|20\d\d (guide|edition))\b/i;
const NOT_OPERATOR_PATH = /\/(blog|news|articles?|stories|listings?|directory|things-to-do|attractions?\/.+|events?\/.+|best-|top-)/i;

function flMentioned(text: string, dest: Destination): boolean {
  if (text.toLowerCase().includes(dest.name.toLowerCase().replace(/^st\. /, "st"))) return true;
  if (text.toLowerCase().includes(dest.name.toLowerCase())) return true;
  if (/\bflorida\b|,\s*FL\b|\bFL\s+3[234]\d{3}\b/i.test(text)) return true;
  return FL_DESTINATIONS.some((d) => new RegExp("\\b" + d.name.replace(/\./g, "\\.") + "\\b", "i").test(text));
}

/** Pick the operator's own name out of a page title: the segment that looks most like the host. */
export function nameFromTitle(title: string, host: string, dest: Destination, term: ExperienceTerm): string | null {
  const t = title.replace(/&amp;/g, "&").replace(/&#39;|&#x27;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const segs = t.split(/\s+[|•·–—-]\s+|\s*\|\s*|:\s+/).map((s) => s.trim()).filter((s) => s.length >= 3);
  const label = host.split(".").slice(0, -1).join("").replace(/[^a-z0-9]/g, "");
  const squash = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
  const generic = new RegExp(`^(home|homepage|welcome|official site|book now|${term.term}s?|${dest.name}|${dest.name},? fl(orida)?|florida)$`, "i");
  let best: string | null = null;
  let bestScore = -1;
  for (const s of segs) {
    if (generic.test(s) || LISTICLE.test(s)) continue;
    const sq = squash(s);
    // Longest common run of letters between the segment and the host label.
    let score = 0;
    for (let len = Math.min(sq.length, label.length); len >= 4 && !score; len--) {
      for (let i = 0; i + len <= sq.length; i++) {
        if (label.includes(sq.slice(i, i + len))) {
          score = len;
          break;
        }
      }
    }
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  if (!best) return null;
  const cleaned = best.replace(new RegExp("\\s*(in|near|of)?\\s*" + dest.name.replace(/\./g, "\\.") + ",?\\s*(fl|florida)?\\s*$", "i"), "").replace(/^welcome to\s+/i, "").replace(/[,:;\-–—|]+\s*$/, "").trim();
  return cleaned.length >= 3 ? cleaned.slice(0, 80) : null;
}

export type BraveRunStats = { skipped?: string; spent: number; failed: number; quota?: string };

/**
 * Spend up to `budget` queries on the oldest (never-asked first) destination x term pairs, recording raw hits
 * into `state`. Stops at the first 401/402/403 (bad key or quota) or on repeated 429.
 */
/**
 * Which searches to spend this run's budget on, most new businesses per request first.
 *
 * The first run went down the grid in order and spent 38 searches on Miami Beach right after 38 on Miami, next door,
 * which found 32 new businesses against Miami's 145. Two terms for one intent ("cocktail class", "mixology class")
 * also return the same sites. So instead of oldest first:
 *   - a term's value is what its answered searches actually returned, candidates per request; unmeasured terms
 *     start at an average so they get tried;
 *   - a search is discounted when a destination within 20 km has already been searched for the same activity, or
 *     is picked earlier in this run, because the results overlap;
 *   - and discounted again when the same destination already has another term for the same activity.
 * Picking is greedy, so each choice updates the discounts for the rest. Never-searched cells come before refreshes.
 */
const INLAND = /^(Orlando|Kissimmee|Gainesville|Tallahassee)$/;
/**
 * How much a destination matters to the launch, beyond raw yield. Tampa Bay is the first market and the beach
 * towns around it are where the call list is; college towns and quiet suburbs matter least for bookable experiences.
 */
const MARKET: Record<string, number> = {
  Tampa: 1.6, Clearwater: 1.6, "St. Petersburg": 1.4, "Siesta Key": 1.4, Sarasota: 1.3, "Key West": 1.3, Destin: 1.3,
  "Panama City Beach": 1.2, Miami: 1.2, "Miami Beach": 1.1, Orlando: 1.2, Kissimmee: 1.1,
  Melbourne: 0.7, "Boca Raton": 0.7, "Delray Beach": 0.7, Gainesville: 0.6, Tallahassee: 0.6,
};

export function pickQueries(state: BraveState, budget: number, refreshMs: number): string[] {
  const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
    const r = 6371, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLon = ((b.lon - a.lon) * Math.PI) / 180;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return 2 * r * Math.asin(Math.sqrt(x));
  };
  const { candidates } = candidatesFromBrave(state);
  const perActivity = new Map<string, number>();
  for (const c of candidates) if (c.activity) perActivity.set(c.activity, (perActivity.get(c.activity) || 0) + 1);
  const askedPerActivity = new Map<string, number>();
  const covered = new Set<string>(); // activity|destination already searched, by any term
  for (const d of FL_DESTINATIONS) for (const t of FL_TERMS) {
    if (!state.queries[`${t.term} ${d.name} FL`]) continue;
    askedPerActivity.set(t.activity, (askedPerActivity.get(t.activity) || 0) + 1);
    covered.add(t.activity + "|" + d.name);
  }
  const measured = [...askedPerActivity].map(([a, n]) => (perActivity.get(a) || 0) / n);
  const prior = measured.length ? measured.reduce((x, y) => x + y, 0) / measured.length : 3;
  const value = (activity: string) => (askedPerActivity.get(activity) ? (perActivity.get(activity) || 0) / askedPerActivity.get(activity)! : prior);

  type Cell = { q: string; d: (typeof FL_DESTINATIONS)[number]; t: (typeof FL_TERMS)[number]; fresh: boolean };
  const cells: Cell[] = [];
  for (const d of FL_DESTINATIONS) for (const t of FL_TERMS) {
    const q = `${t.term} ${d.name} FL`;
    const e = state.queries[q];
    if (e && Date.now() - Date.parse(e.at) <= refreshMs) continue;
    cells.push({ q, d, t, fresh: !e });
  }
  const score = (c: Cell) => {
    let v = value(c.t.activity);
    const nearDone = FL_DESTINATIONS.some((o) => o.name !== c.d.name && covered.has(c.t.activity + "|" + o.name) && km(o, c.d) <= 20);
    if (nearDone) v *= 0.3;
    if (covered.has(c.t.activity + "|" + c.d.name)) v *= 0.5;
    // Measured yields came from the coast. Inland towns do not have fishing charters, jet skis or dolphin tours
    // worth a search; airboats are the exception, they run inland.
    if (INLAND.test(c.d.name) && /fishing|boat|jet-ski|paddle|kayak|snorkel|dolphin|sunset|parasail|scuba/.test(c.t.activity)) v *= 0.25;
    v *= MARKET[c.d.name] ?? 1;
    return (c.fresh ? 1000 : 0) + v;
  };
  const out: string[] = [];
  const left = new Set(cells);
  while (out.length < budget && left.size) {
    let best: Cell | null = null, bestScore = -Infinity;
    for (const c of left) { const sc = score(c); if (sc > bestScore) { bestScore = sc; best = c; } }
    if (!best) break;
    left.delete(best);
    out.push(best.q);
    covered.add(best.t.activity + "|" + best.d.name);
  }
  return out;
}

export async function refreshBrave(state: BraveState, opts: { key: string | undefined; budget: number; refreshDays?: number; log?: (m: string) => void }): Promise<BraveRunStats> {
  const log = opts.log || console.log;
  if (!opts.key) {
    log("web: BRAVE_SEARCH_API_KEY is not set, so the Brave Search API step was skipped. Nothing was searched.");
    return { skipped: "no BRAVE_SEARCH_API_KEY", spent: 0, failed: 0 };
  }
  const refreshMs = (opts.refreshDays ?? 90) * 86_400_000;
  const all = FL_DESTINATIONS.flatMap((d) => FL_TERMS.map((t) => `${t.term} ${d.name} FL`));
  const due = pickQueries(state, opts.budget, refreshMs);
  log(`web: ${all.length} queries in the grid, ${due.length} picked by expected yield for a budget of ${opts.budget}`);
  const stats: BraveRunStats = { spent: 0, failed: 0 };
  let limited = 0;
  for (const q of due.slice(0, opts.budget)) {
    const params = new URLSearchParams({ q, count: "20", country: "us", search_lang: "en", safesearch: "moderate", text_decorations: "false" });
    let res: Response;
    try {
      res = await fetch(`${ENDPOINT}?${params}`, {
        headers: { accept: "application/json", "accept-encoding": "gzip", "X-Subscription-Token": opts.key },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      stats.failed += 1;
      log(`  ${q}: ${(e as Error).message.slice(0, 80)}`);
      await sleep(3000);
      continue;
    }
    stats.spent += 1;
    if (res.status === 429) {
      limited += 1;
      if (limited >= 5) {
        stats.quota = "rate limited five times in a row; stopping for this run";
        break;
      }
      await sleep(5000 * limited);
      continue;
    }
    if (res.status === 401 || res.status === 402 || res.status === 403) {
      stats.quota = `Brave answered ${res.status}: the key is wrong or the plan's quota is used up; stopping`;
      break;
    }
    if (!res.ok) {
      stats.failed += 1;
      await sleep(1500);
      continue;
    }
    limited = 0;
    const json = (await res.json()) as { web?: { results?: { url?: string; title?: string; description?: string }[] } };
    const hits = (json.web?.results || [])
      .filter((r) => r.url)
      .map((r) => ({ url: r.url!, title: (r.title || "").slice(0, 160), description: (r.description || "").replace(/<[^>]+>/g, "").slice(0, 300) }));
    state.queries[q] = { at: new Date().toISOString(), hits };
    // The free plan allows one request a second.
    await sleep(1100);
  }
  if (stats.quota) log("web: " + stats.quota);
  return stats;
}

/** Candidates from every answered query in the state. Pure: no network. */
/**
 * Hosts that answer an activity search but do not run the activity: booking marketplaces and resellers, class and
 * gym directories, vacation rentals and property managers, hotels, and retail chains. Found by reading a sample of
 * the first 865 web candidates, where about four in ten were one of these.
 */
const NOT_OPERATOR_HOST = new RegExp(
  [
    "samboat", "fishanywhere", "tripoutside", "friendwitha", "traferral", "getmyboat", "boatsetter", "clickandboat", "fishingbooker",
    "captainexperiences", "vrbo", "expedia", "klook", "headout", "musement", "tiqets", "isango", "bookmundi", "toursbylocals",
    "withlocals", "guruwalk", "freetour", "citypass", "gocity", "sightseeingpass", "viator", "getyourguide", "tripadvisor",
    "totalwine", "standardhotels", "marriott", "hilton", "hyatt", "fourseasons", "ritzcarlton", "wyndham", "sheraton",
    "near-?me", "directory", "finder", "locator", "listings?", "vacation-?(homes?|rentals?)", "realty", "real-?estate",
    "properties", "hotels?\\b", "resorts?-?group", "indoorclimbing\\.com",
    // Magazines, blogs and districts that write about an activity, and sites about somewhere else entirely.
    "living\\b", "magazine", "\\bblog", "destinations", "district", "italy", "europe", "letsbatch", "biketours\\.com", "travelpass", "travelsports",
    // A Florida operator does not run its site from Italy, the UK or the EU.
    "\\.(it|eu|uk|de|fr|es|au|nz)$",
    // Server consoles and staging hosts that surface in results by accident.
    "^(phpmyadmin|admin|staging|dev|test|cpanel|webmail)\\.",
    // A booking platform's own reservations host is the platform, not the operator; the crawl finds operators by site.
    "^reservations\\.",
  ].join("|"),
  "i",
);

export function candidatesFromBrave(state: BraveState): { candidates: Candidate[]; considered: number; dropped: Record<string, number> } {
  const dropped: Record<string, number> = {};
  const drop = (why: string) => void (dropped[why] = (dropped[why] || 0) + 1);
  const hostDestinations = new Map<string, Set<string>>();
  const picks: Candidate[] = [];
  let considered = 0;
  for (const dest of FL_DESTINATIONS) {
    for (const term of FL_TERMS) {
      const entry = state.queries[`${term.term} ${dest.name} FL`];
      if (!entry) continue;
      for (const h of entry.hits) {
        considered += 1;
        const host = hostOf(h.url);
        if (!host) { drop("bad url"); continue; }
        if (!hostDestinations.has(host)) hostDestinations.set(host, new Set());
        hostDestinations.get(host)!.add(dest.name);
        if (DROP_HOSTS.test(host) || GOV_EDU.test(host) || BOARD_HOST.test(host)) { drop("aggregator, social, news, board or government"); continue; }
        if (NOT_OPERATOR_HOST.test(host)) { drop("marketplace, directory, rental, hotel or retail"); continue; }
        // Question and roundup titles are articles about operators, not operators: "Where to Find Horseback Riding
        // Lessons", "Any Good Snorkeling In Southwest Florida", "Cool Destinations 2024".
        if (/^(where to|any good|how to|what to|things to|guide to)\b|\b20(1\d|2\d)\b/i.test(h.title)) { drop("listicle or article"); continue; }
        let path = "/";
        try { path = new URL(h.url).pathname; } catch { /* keep root */ }
        if (LISTICLE.test(h.title) || NOT_OPERATOR_PATH.test(path)) { drop("listicle or article"); continue; }
        const text = `${h.title} ${h.description} ${h.url}`;
        if (!term.must.test(text)) { drop("does not mention the activity"); continue; }
        if (!flMentioned(text, dest)) { drop("not placed in Florida"); continue; }
        const name = nameFromTitle(h.title, host, dest, term);
        if (!name) { drop("no usable name"); continue; }
        picks.push({
          name, website: `https://${host}/`, domain: host, street: null, city: dest.name, region: "FL", postal: null,
          lat: null, lon: null, phone: null, kind: term.kind, source: "web", sourceUrl: h.url, activity: term.activity,
        });
      }
    }
  }
  // A host that answers for five or more destinations is a directory or a statewide reseller, not a local operator.
  const local = picks.filter((c) => {
    const n = hostDestinations.get(c.domain)?.size || 0;
    if (n >= 5) { drop("host appears in 5+ destinations"); return false; }
    return true;
  });
  return { candidates: dedupeCandidates(local), considered, dropped };
}
