import "../src/env.ts";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { DuckDBInstance } from "@duckdb/node-api";
import { query } from "../src/db/pg.ts";
import { getPage } from "../src/discover/polite.ts";
import { outreachAddress } from "../src/outreach/address.ts";
import { UNREADABLE_ADDRESS } from "../src/outreach/guards.ts";
import { ensureTouchTables } from "../src/outreach/touches.ts";

/**
 * Restaurants for the Otto pitch (Harshil, 9 October 2026: "lets switch to restaurants"). About 900 activity
 * businesses got a pitch that landed in Gmail's Primary tab, two replied, and not one opened the recording; the
 * one real lead was a restaurant group, where the phone rings all evening. This finds independent restaurants
 * and their own email addresses and publishes them into outreach_pool as family "restaurant", which the daily
 * run (scripts/otto-cloud.mts) mails first.
 *
 *   1. Overture Maps (open data, read in place with DuckDB, no key): every open restaurant or caterer in the box
 *      with a website and a phone, in Canada (the box's edge caught a Bermuda grill) and with Overture's
 *      confidence at 0.7 or more (a 0.6 row was a financial fund filed as canadian_restaurant). Big chains go (Overture's brand field, or a name seen at 15+ places), and a
 *      group with several locations on one website is one row, so one inbox gets one email.
 *   2. The restaurant's own website, read politely (robots.txt, one request at a time per host, src/discover/
 *      polite.ts): the home page and up to two contact or about pages, for a published address. Overture's own
 *      email field is used when it has one. Ordering platforms and social pages are not the restaurant's site.
 *   3. The best address by the same ranking the activity pool uses (src/outreach/address.ts), then upserted.
 *
 * Runs on Render, never on the founder's Mac (/AGENTS.md): a one-off job on the outset-otto service.
 *
 *   npx tsx scripts/restaurants-pool.mts --box gta              # the Greater Toronto Area
 *   npx tsx scripts/restaurants-pool.mts --box gta --limit 200  # the first 200 sites, to check
 *   npx tsx scripts/restaurants-pool.mts --box gta --dry        # read and report, write nothing
 */
const arg = (k: string, d = "") => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const dry = process.argv.includes("--dry");
const boxId = arg("box", "gta");
const limit = Number(arg("limit", "0")) || Infinity;
const CONCURRENCY = Number(arg("concurrency", "12"));

const BOXES: Record<string, { west: number; south: number; east: number; north: number }> = {
  // Hamilton to Oshawa, Lake Ontario to Newmarket.
  gta: { west: -80.25, south: 43.2, east: -78.8, north: 44.1 },
};
const box = BOXES[boxId];
if (!box) throw new Error("unknown box " + boxId);
const RELEASE = process.env.OVERTURE_RELEASE || "2026-08-19.0";
const cache = `/tmp/overture-restaurants-v2-${boxId}-${RELEASE}.json`;

type Place = { id: string; name: string; category: string; website: string | null; email: string | null; phone: string | null; city: string | null; region: string | null; brand: string | null; confidence: number };

async function overture(): Promise<Place[]> {
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, "utf8")) as Place[];
  const db = await DuckDBInstance.create(":memory:");
  const con = await db.connect();
  await con.run("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';");
  const reader = await con.runAndReadAll(
    `SELECT id, names.primary AS name, categories.primary AS category, websites[1] AS website, emails[1] AS email,
            phones[1] AS phone, addresses[1].locality AS city, addresses[1].region AS region,
            brand.names.primary AS brand, confidence
       FROM read_parquet('s3://overturemaps-us-west-2/release/${RELEASE}/theme=places/type=place/*')
      WHERE bbox.xmin BETWEEN ${box.west} AND ${box.east} AND bbox.ymin BETWEEN ${box.south} AND ${box.north}
        AND (categories.primary LIKE '%restaurant%' OR categories.primary IN ('caterer', 'pizza_place', 'food_truck'))
        AND websites[1] IS NOT NULL AND phones[1] IS NOT NULL
        AND coalesce(operating_status, 'open') = 'open'
        AND addresses[1].country = 'CA' AND confidence >= 0.7`,
  );
  const rows = (reader.getRowObjects() as unknown as Place[]).map((r) => ({ ...r, confidence: Number(r.confidence) || 0 }));
  writeFileSync(cache, JSON.stringify(rows));
  return rows;
}

/** Not the restaurant's own site: an ordering platform, a directory or a social page. */
const NOT_OWN_SITE = /(^|\.)(facebook|instagram|twitter|x|tiktok|linktr|linktree|google|goo|yelp|tripadvisor|ubereats|doordash|skipthedishes|grubhub|menulog|order\.online|toasttab|clover|square|squareup|chownow|menufy|ritual|opentable|resy|tock|zomato|allmenus|menupages|sirved|bit|wa|whatsapp|beacons|carrd|business\.site|wixsite|godaddysites)\.[a-z.]+$/i;
const FREE = /@(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|icloud|me|mac|aol|msn|rogers|bell|sympatico|shaw|telus|cogeco|videotron|proton|protonmail)\.[a-z.]+$/i;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

function host(u: string | null): string | null {
  try { return new URL(/^https?:/i.test(u || "") ? u! : "https://" + u).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
}
const base = (h: string) => h.split(".").slice(-2).join(".");

/** Cloudflare's email protection writes an address as hex XOR'd with its first byte. */
function cfDecode(hex: string): string {
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

function emailsIn(html: string, siteHost: string): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(/data-cfemail="([0-9a-f]+)"/gi)) found.add(cfDecode(m[1]).toLowerCase());
  const text = html.replace(/%40/g, "@").replace(/&#64;|&#x40;/gi, "@");
  for (const m of text.match(EMAIL) || []) found.add(m.toLowerCase().replace(/^mailto:/, ""));
  return [...found].filter((e) => {
    if (UNREADABLE_ADDRESS.test(e) || /\.(png|jpe?g|gif|webp|svg|css|js)$/i.test(e) || e.length > 80) return false;
    const d = e.split("@")[1];
    return FREE.test(e) || d === siteHost || d.endsWith("." + base(siteHost)) || base(d) === base(siteHost);
  });
}

async function findEmail(p: Place): Promise<string | null> {
  const site = /^https?:/i.test(p.website!) ? p.website! : "https://" + p.website;
  const h = host(site)!;
  const pool = new Set<string>();
  if (p.email) for (const e of emailsIn(p.email, h)) pool.add(e);
  try {
    const home = await getPage(site, 1200);
    if (home.status >= 200 && home.status < 400) {
      for (const e of emailsIn(home.html, h)) pool.add(e);
      if (!pool.size) {
        const links = [...home.html.matchAll(/href="([^"#]+)"/gi)].map((m) => m[1])
          .filter((u) => /contact|about|catering|location/i.test(u)).slice(0, 2);
        for (const l of links) {
          try {
            const url = new URL(l, home.finalUrl || site);
            if (base(url.hostname.replace(/^www\./, "")) !== base(h)) continue;
            const pg = await getPage(url.href, 1200);
            for (const e of emailsIn(pg.html, h)) pool.add(e);
            if (pool.size) break;
          } catch { /* a bad link is skipped */ }
        }
      }
    }
  } catch { /* an unreachable site has no address */ }
  const all = [...pool];
  if (!all.length) return null;
  return outreachAddress({ email: all[0], domain: h }, all.slice(1)) || all[0];
}

await ensureTouchTables();
const places = await overture();
console.log(`restaurants-pool: ${places.length} restaurants with a website and phone in ${boxId}`);

// Chains out: Overture's brand, or the same name at 15 or more places in the box.
const nameCount = new Map<string, number>();
for (const p of places) nameCount.set(p.name.toLowerCase(), (nameCount.get(p.name.toLowerCase()) || 0) + 1);
const byDomain = new Map<string, Place>();
let chains = 0, platform = 0;
for (const p of places) {
  if (p.brand || (nameCount.get(p.name.toLowerCase()) || 0) >= 15) { chains++; continue; }
  const h = host(p.website);
  if (!h || NOT_OWN_SITE.test(h)) { platform++; continue; }
  const prev = byDomain.get(h);
  if (!prev || p.confidence > prev.confidence) byDomain.set(h, p); // one row per website, so one email per group
}
const known = new Set((await query<{ domain: string }>("select lower(domain) as domain from outreach_pool")).map((r) => r.domain));
const queue = [...byDomain.entries()].filter(([h]) => !known.has(h)).slice(0, limit);
console.log(`restaurants-pool: ${chains} chain locations and ${platform} platform pages skipped; ${byDomain.size} restaurant websites, ${queue.length} not yet in the pool`);

let done = 0, withEmail = 0, written = 0;
const out: (string | number | null)[][] = [];
async function worker() {
  for (;;) {
    const next = queue.shift();
    if (!next) return;
    const [h, p] = next;
    const email = await findEmail(p);
    done++;
    if (email) {
      withEmail++;
      const id = "rest-" + createHash("sha1").update(h).digest("hex").slice(0, 16);
      out.push([id, "r-" + h.replace(/[^a-z0-9]+/g, "-"), h, p.name, p.website, email, p.phone, p.city, p.region, Math.round(p.confidence * 100), "restaurant", p.category]);
    }
    if (done % 100 === 0) console.log(`restaurants-pool: ${done} sites read, ${withEmail} with an address`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

if (!dry && out.length) {
  for (let i = 0; i < out.length; i += 400) {
    const chunk = out.slice(i, i + 400);
    const cols = 12;
    const tuples = chunk.map((_, k) => "(" + Array.from({ length: cols }, (_, j) => "$" + (k * cols + j + 1)).join(", ") + ", now())").join(", ");
    await query(
      `insert into outreach_pool (operator_id, catalog_id, domain, name, website, email, phone, city, region, completeness, family, category, synced_at)
       values ${tuples}
       on conflict (operator_id) do update set name = excluded.name, website = excluded.website, phone = excluded.phone,
         city = excluded.city, region = excluded.region, completeness = excluded.completeness, category = excluded.category,
         email = case when outreach_pool.owner_source is not null then outreach_pool.email else excluded.email end, synced_at = now()`,
      chunk.flat(),
    );
    written += chunk.length;
  }
}
console.log(`restaurants-pool: done. ${done} sites read, ${withEmail} with a published address, ${dry ? "dry run, nothing written" : written + " written to outreach_pool"}`);
const sample = out.slice(0, 15).map((r) => `  ${r[3]} (${r[7]}) ${r[5]} [${r[11]}]`);
if (sample.length) console.log(sample.join("\n"));
process.exit(0);
