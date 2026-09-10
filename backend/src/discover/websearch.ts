import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CITIES, type City } from "./cities.ts";
import { upsertPlace, type SearchStats } from "./searchapi.ts";

/**
 * Web-search discovery for the categories OpenStreetMap tags poorly: classes, studios, tours, indoor venues.
 * Brave's HTML results page is public and needs no key. One query every couple of seconds, cached on disk,
 * aggregator and social domains dropped so only the operator's own site is kept.
 */

const here = dirname(fileURLToPath(import.meta.url));
const cacheDir = join(here, "../../data/websearch");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** Query terms and the category each one lands in. */
export const WEB_TERMS: { term: string; category: string }[] = [
  { term: "cooking classes", category: "cooking" },
  { term: "pottery classes", category: "pottery" },
  { term: "paint and sip", category: "pottery" },
  { term: "glassblowing class", category: "pottery" },
  { term: "candle making class", category: "pottery" },
  { term: "art workshops", category: "pottery" },
  { term: "food tours", category: "tour" },
  { term: "walking tours", category: "tour" },
  { term: "ghost tours", category: "tour" },
  { term: "bike tours", category: "tour" },
  { term: "segway tours", category: "tour" },
  { term: "escape rooms", category: "escape" },
  { term: "axe throwing", category: "axe" },
  { term: "rage room", category: "rage" },
  { term: "laser tag", category: "lasertag" },
  { term: "karaoke private rooms", category: "karaoke" },
  { term: "trampoline park", category: "trampoline" },
  { term: "float spa", category: "spa" },
  { term: "dance classes adults", category: "dance" },
  { term: "surf lessons", category: "surf" },
  { term: "helicopter tours", category: "heli" },
  { term: "go karting", category: "kart" },
];

const DROP = /(^|\.)(yelp|tripadvisor|eventbrite|classpass|groupon|facebook|instagram|reddit|quora|timeout|blogto|narcity|wikipedia|youtube|google|coursehorse|airbnb|viator|getyourguide|cozymeal|classbento|thumbtack|bark|expedia|booking|hotels|kayak|tiktok|pinterest|linkedin|x|twitter|meetup|amazon|apple|nextdoor|mapquest|yellowpages|bbb|foursquare|zomato|opentable|resy|tock|peek|fareharbor|xola|rezdy|bookeo|mindbodyonline|vagaro|fresha|booksy|squareup|shopify|wix|squarespace|eventbrite|dojobusiness|craigslist|indeed|glassdoor|patch|nytimes|cntraveler|lonelyplanet|thrillist|eater|forbes|usatoday|cbc|ctvnews|globalnews|citynews|nypost|chicagotribune|latimes|sfgate|seattletimes|denverpost|dallasnews|houstonchronicle|ajc|tampabay|orlandosentinel|miamiherald|sun-sentinel|bostonglobe|philly|inquirer|washingtonpost|baltimoresun|cleveland|freep|detroitnews|startribune|kansascity|stltoday|azcentral|reviewjournal|oregonlive|sandiegouniontribune|mercurynews|sacbee|fresnobee|mlive|jsonline|dispatch|cincinnati|courier-journal|tennessean|commercialappeal|charlotteobserver|newsobserver|postandcourier|thestate|greenvilleonline|richmond|pilotonline|dailypress|wtop|wjla|wusa9|nbcwashington)\.(com|ca|org|net|co|io)$/i;
const GOV = /\.(gov|edu|mil)$|\.(ca|us)\.gov$|\b(city|county|town)of[a-z]+\.(com|org|ca)$|\.[a-z]+\.ca\.gov/i;

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function cleanTitle(t: string, city: City): string {
  let s = t.replace(/&amp;/g, "&").replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
  s = s.split(/\s+[|•·–—-]\s+|\s+\|\s*/)[0];
  s = s.replace(new RegExp("\\b(in|near|of)?\\s*" + city.name + "\\b.*$", "i"), "").replace(/[:,\-–—|]+\s*$/, "").trim();
  s = s.replace(/^(the )?(\d+ )?(best|top)\b.*$/i, "").trim();
  return s.slice(0, 80);
}

type Hit = { url: string; title: string; snippet: string };

function parseBrave(html: string): Hit[] {
  const blocks = html.split(/<div class="snippet[^"]*" data-pos="\d+" data-type="web"/).slice(1);
  const out: Hit[] = [];
  for (const b of blocks) {
    const href = b.match(/href="(https?:\/\/[^"]+)"/)?.[1];
    const t = b.match(/class="title[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1] || "";
    const d = b.match(/class="snippet-description[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1] || "";
    if (!href) continue;
    out.push({ url: href, title: t.replace(/<[^>]+>/g, "").trim(), snippet: d.replace(/<[^>]+>/g, "").trim().slice(0, 200) });
  }
  return out;
}

let cooldownUntil = 0;

async function braveSearch(q: string): Promise<{ hits: Hit[]; cached: boolean }> {
  mkdirSync(cacheDir, { recursive: true });
  const cachePath = join(cacheDir, q.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 90) + ".json");
  if (existsSync(cachePath)) return { hits: JSON.parse(readFileSync(cachePath, "utf8")) as Hit[], cached: true };
  // Brave answers about one request in three with a 429 even at a slow pace. Short backoff and retry wins.
  let html = "";
  for (let attempt = 0; ; attempt++) {
    const wait = cooldownUntil - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const res = await fetch("https://search.brave.com/search?q=" + encodeURIComponent(q) + "&source=web", {
      headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9", accept: "text/html" },
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 429 || res.status === 403) {
      cooldownUntil = Date.now() + 4000 + attempt * 3000;
      if (attempt >= 6) throw new Error("rate limited " + res.status);
      continue;
    }
    if (!res.ok) throw new Error("HTTP " + res.status);
    html = await res.text();
    break;
  }
  const hits = parseBrave(html);
  writeFileSync(cachePath, JSON.stringify(hits));
  return { hits, cached: false };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function discoverWeb(opts: { terms?: string[]; cities?: string[]; delayMs?: number } = {}): Promise<SearchStats> {
  const stats: SearchStats = { queries: 0, results: 0, inserted: 0, merged: 0, skipped: 0, stoppedEarly: false };
  const terms = opts.terms?.length ? WEB_TERMS.filter((t) => opts.terms!.includes(t.category) || opts.terms!.includes(t.term)) : WEB_TERMS;
  const cities = opts.cities?.length ? CITIES.filter((c) => opts.cities!.includes(c.name) || opts.cities!.includes(c.region)) : CITIES;
  const seenHost = new Set<string>();
  for (const city of cities) {
    for (const t of terms) {
      const q = `${t.term} ${city.name} ${city.region}`;
      try {
        const { hits, cached } = await braveSearch(q);
        if (!cached) stats.queries++;
        for (const h of hits) {
          const host = hostOf(h.url);
          if (!host || DROP.test(host) || GOV.test(host)) continue;
          // Aggregator pages and listicles name several businesses; the operator's own site names one.
          if (/\b(best|top \d|things to do|guide to|near me)\b/i.test(h.title) && !/\.(com|ca|net|org|co)\/?$/.test(h.url)) continue;
          const key = host + "|" + city.name;
          if (seenHost.has(key)) continue;
          seenHost.add(key);
          const title = cleanTitle(h.title, city);
          if (title.length < 3) continue;
          stats.results++;
          upsertPlace({ title, website: "https://" + host + "/", type: t.term }, t.category, city, stats);
        }
        if (!cached) await sleep(opts.delayMs ?? 2500);
      } catch (e) {
        console.error(`${q}: ${(e as Error).message}`);
        await sleep(5000);
      }
    }
    console.log(`${city.name}, ${city.region}: ${stats.queries} queries, ${stats.inserted} new, ${stats.merged} merged`);
  }
  return stats;
}
