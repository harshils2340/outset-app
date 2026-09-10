import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CITIES, type City } from "./cities.ts";
import { upsertPlace, type SearchStats } from "./searchapi.ts";

/**
 * Model-backed web discovery for the categories no free source covers well: classes, studios, tours.
 * One call per city and term asks the model to search the web several ways and return the operators'
 * own homepages as JSON. Cached per query; a hard call cap keeps spend predictable (about 4 cents a call).
 */

const here = dirname(fileURLToPath(import.meta.url));
const cacheDir = join(here, "../../data/aisearch");
const ledger = join(here, "../../data/aisearch-ledger.txt");

export const AI_TERMS: { term: string; phrasings: string; category: string }[] = [
  { term: "cooking classes", phrasings: "cooking school, culinary classes, pasta making class, sushi class, baking class, kids cooking class", category: "cooking" },
  { term: "pottery classes", phrasings: "pottery studio, ceramics class, wheel throwing class, clay studio", category: "pottery" },
  { term: "paint and sip", phrasings: "paint and sip studio, art class for adults, painting party studio, candle making class, glassblowing class", category: "pottery" },
  { term: "food tours", phrasings: "food tour company, culinary walking tour, tasting tour", category: "tour" },
  { term: "walking tours", phrasings: "walking tour company, ghost tour, history tour, bike tour company, segway tour", category: "tour" },
  { term: "rage rooms and smash rooms", phrasings: "rage room, smash room, break room, anger room", category: "rage" },
  { term: "boat tours and cruises", phrasings: "harbor cruise, sightseeing cruise, sunset cruise, dinner cruise, whale watching, dolphin tour, airboat tour", category: "cruise" },
  { term: "adventure tours", phrasings: "ATV tour, jeep tour, hiking tour, kayak tour, snorkel tour, zipline tour, e-bike tour, scooter tour", category: "tour" },
  { term: "brewery and wine tours", phrasings: "brewery tour, wine tour, distillery tour, tasting tour, bar crawl company", category: "tour" },
  { term: "kids classes and camps", phrasings: "kids art class, kids cooking class, kids science class, day camp, gymnastics class for kids, kids coding class", category: "gymnastics" },
  { term: "comedy clubs and live shows", phrasings: "comedy club, dinner theater, magic show, live music venue with tickets, murder mystery dinner", category: "theatre" },
  { term: "wellness experiences", phrasings: "float tank, sauna and cold plunge studio, sound bath, meditation studio, hot springs, bathhouse", category: "sauna" },
];

function env(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(join(here, "../../.env"), "utf8").split("\n").find((l) => l.startsWith(name + "="));
    return line ? line.slice(name.length + 1).trim() : undefined;
  } catch {
    return undefined;
  }
}

type Row = { name?: string; website?: string; neighborhood?: string };

async function askModel(city: City, t: (typeof AI_TERMS)[number]): Promise<Row[]> {
  const key = env("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY missing");
  const where = `${city.name}, ${city.region}, ${city.country === "CA" ? "Canada" : "USA"}`;
  const input = `List ${t.term} businesses in ${where} that the public can book in person. Search the web several times with different phrasings (${t.phrasings}) and merge the results. Only the business's own website, never aggregators or marketplaces (no Yelp, Tripadvisor, Eventbrite, ClassBento, Cozymeal, Airbnb, Viator, GetYourGuide, Groupon, Facebook, Instagram). One entry per business, homepage URL only. Return JSON only: an array of {"name","website","neighborhood"}. Aim for 20 or more distinct businesses; include small independent studios and operators, not just the famous ones.`;
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + key },
    body: JSON.stringify({
      model: "gpt-4.1",
      tools: [{ type: "web_search_preview", search_context_size: "medium", user_location: { type: "approximate", city: city.name, region: city.region, country: city.country } }],
      input,
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error("OpenAI " + res.status + " " + (await res.text()).slice(0, 200));
  const j = (await res.json()) as { output?: { content?: { text?: string }[] }[]; usage?: { total_tokens?: number } };
  const text = (j.output || []).flatMap((o) => o.content || []).map((c) => c.text || "").join("\n");
  const m = text.match(/\[[\s\S]*\]/);
  appendFileSync(ledger, `${new Date().toISOString()}\t${city.name}\t${t.term}\t${j.usage?.total_tokens || 0}\n`);
  if (!m) return [];
  try {
    return JSON.parse(m[0]) as Row[];
  } catch {
    return [];
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

const DROP = /(^|\.)(yelp|tripadvisor|eventbrite|classpass|groupon|facebook|instagram|reddit|wikipedia|youtube|google|coursehorse|airbnb|viator|getyourguide|cozymeal|classbento|meetup|amazon|tiktok|pinterest|linkedin|x|twitter|nextdoor|yellowpages|foursquare|peek|fareharbor|xola|rezdy|bookeo|mindbodyonline|vagaro|fresha|booksy|squareup|shopify|wix|squarespace|toronto|nyc|lacity|chicago)\.(com|ca|org|net|co|io|gov)$/i;

async function withRetry<T>(fn: () => T, tries = 8): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return fn();
    } catch (e) {
      if (i >= tries || !/locked|busy/i.test((e as Error).message)) throw e;
      await new Promise((r) => setTimeout(r, 1000 + i * 500));
    }
  }
}

export async function discoverAi(opts: { cities?: string[]; terms?: string[]; maxCalls?: number; concurrency?: number } = {}): Promise<SearchStats & { calls: number }> {
  mkdirSync(cacheDir, { recursive: true });
  const stats: SearchStats & { calls: number } = { queries: 0, results: 0, inserted: 0, merged: 0, skipped: 0, stoppedEarly: false, calls: 0 };
  const terms = opts.terms?.length ? AI_TERMS.filter((t) => opts.terms!.includes(t.category) || opts.terms!.includes(t.term)) : AI_TERMS;
  const cities = opts.cities?.length ? CITIES.filter((c) => opts.cities!.includes(c.name) || opts.cities!.includes(c.region)) : CITIES;
  const maxCalls = opts.maxCalls ?? 700;
  const jobs: { city: City; t: (typeof AI_TERMS)[number] }[] = [];
  for (const city of cities) for (const t of terms) jobs.push({ city, t });
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      const cachePath = join(cacheDir, `${job.city.name}-${job.city.region}-${job.t.category}-${job.t.term}`.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".json");
      let rows: Row[];
      try {
        if (existsSync(cachePath)) rows = JSON.parse(readFileSync(cachePath, "utf8")) as Row[];
        else {
          if (stats.calls >= maxCalls) { stats.stoppedEarly = true; return; }
          stats.calls++;
          rows = await askModel(job.city, job.t);
          writeFileSync(cachePath, JSON.stringify(rows));
        }
      } catch (e) {
        console.error(`${job.city.name} ${job.t.term}: ${(e as Error).message.slice(0, 120)}`);
        continue;
      }
      for (const r of rows) {
        const host = r.website ? hostOf(r.website.startsWith("http") ? r.website : "https://" + r.website) : null;
        const name = (r.name || "").trim();
        if (!host || DROP.test(host) || name.length < 3) continue;
        stats.results++;
        try {
          await withRetry(() => upsertPlace({ title: name, website: "https://" + host + "/", type: job.t.term, address: r.neighborhood ? `${r.neighborhood}, ${job.city.name}, ${job.city.region}` : undefined }, job.t.category, job.city, stats));
        } catch (e) {
          console.error(`${name}: ${(e as Error).message.slice(0, 80)}`);
        }
      }
      console.log(`${job.city.name}, ${job.city.region} ${job.t.category}: ${rows.length} rows; total ${stats.calls} calls, ${stats.inserted} new, ${stats.merged} merged`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 3, jobs.length) }, worker));
  return stats;
}
