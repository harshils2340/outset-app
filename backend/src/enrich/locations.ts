import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { load } from "cheerio";
import { db, nowIso } from "../db/client.ts";
import { fetchHtml, sleep, withDeadline } from "../scrape/fetch.ts";
import { spawnWorkers } from "../scrape/cpu.ts";

/**
 * Extra locations for chains. One operator row per domain keeps the catalog deduplicated, but Bad Axe Throwing
 * runs fifty venues and a guest in Kitchener should see the Kitchener one. Two free sources:
 *  1. The OpenStreetMap cache: every node that shares the operator's website domain.
 *  2. The operator's own locations page: street addresses, geocoded with Photon (OpenStreetMap's free geocoder).
 * Nothing is invented. An address that does not geocode is dropped.
 */

type OsmEl = { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };
type OpRow = { id: string; domain: string; website: string | null; lat: number | null; lon: number | null; city: string | null };

const OSM_DIR = new URL("../../data/osm/", import.meta.url);

function hostOf(w: string | undefined): string | null {
  if (!w) return null;
  try {
    return new URL(w.startsWith("http") ? w : "https://" + w).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function kmBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(x));
}

function existing(operatorId: string): { lat: number; lon: number }[] {
  return db.prepare("SELECT lat, lon FROM locations WHERE operator_id = ?").all(operatorId) as { lat: number; lon: number }[];
}

function addLocation(op: OpRow, loc: { name?: string | null; street?: string | null; city?: string | null; region?: string | null; postal?: string | null; lat: number; lon: number }, source: string): boolean {
  // Skip the primary pin and anything within 300 m of a known location.
  const pins = [...existing(op.id), ...(op.lat != null && op.lon != null ? [{ lat: op.lat, lon: op.lon }] : [])];
  if (pins.some((p) => kmBetween(p, loc) < 0.3)) return false;
  db.prepare("INSERT INTO locations (id, operator_id, name, street, city, region, postal, lat, lon, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    randomUUID(), op.id, loc.name || null, loc.street || null, loc.city || null, loc.region || null, loc.postal || null, loc.lat, loc.lon, source, nowIso(),
  );
  return true;
}

/** Every cached OpenStreetMap node that shares an operator's domain becomes a location. */
export function loadOsmLocations(): { operators: number; locations: number } {
  const byDomain = new Map<string, OsmEl[]>();
  for (const f of readdirSync(OSM_DIR)) {
    if (!f.endsWith(".json")) continue;
    let els: OsmEl[] = [];
    try {
      const j = JSON.parse(readFileSync(new URL(f, OSM_DIR), "utf8"));
      els = Array.isArray(j) ? j : j.elements || [];
    } catch {
      continue;
    }
    for (const e of els) {
      const t = e.tags || {};
      const host = hostOf(t.website || t["contact:website"] || t.url);
      if (!host || !t.name) continue;
      const arr = byDomain.get(host) || [];
      arr.push(e);
      byDomain.set(host, arr);
    }
  }
  const out = { operators: 0, locations: 0 };
  const find = db.prepare("SELECT id, domain, website, lat, lon, city FROM operators WHERE domain = ?");
  for (const [domain, els] of byDomain) {
    if (els.length < 2) continue;
    const op = find.get(domain) as OpRow | undefined;
    if (!op) continue;
    let added = 0;
    for (const e of els) {
      const lat = e.lat ?? e.center?.lat;
      const lon = e.lon ?? e.center?.lon;
      if (lat == null || lon == null) continue;
      const t = e.tags || {};
      if (addLocation(op, { name: t.name, street: [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ") || null, city: t["addr:city"] || null, region: t["addr:state"] || null, postal: t["addr:postcode"] || null, lat, lon }, "osm")) added += 1;
    }
    if (added) {
      out.operators += 1;
      out.locations += added;
    }
  }
  return out;
}

/* ---------- the operator's own locations page ---------- */

const LOC_LINK = /\b(locations?|find[- ]a[- ]location|our[- ]locations|find[- ]us|venues?|branches|cities|areas? we serve)\b/i;
/** Pickup points, hotel lists and parking pages list addresses that are not the operator's own venues. */
const NOT_VENUES = /\b(pick[- ]?up|shuttle|hotel|parking|directions?|drop[- ]?off|meeting point|transportation|partners?|dealers?|retailers?|stockists?)\b/i;
const STREET_RE = /\b(\d{1,6}[A-Za-z]?\s+(?:[A-Z][A-Za-z0-9'.-]*\s+){0,5}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Hwy|Highway|Way|Ln|Lane|Pkwy|Parkway|Ct|Court|Pl|Place|Trail|Trl|Cir|Circle|Terrace|Ter|Pike|Route|Rte|Loop|Square|Sq|Beach|Pier|Marina|Wharf|Landing)\b\.?(?:\s*(?:Suite|Ste|Unit|#)\s*[A-Za-z0-9-]+)?)[,\s]+([A-Z][A-Za-z.' -]{2,40}?)[,\s]+([A-Z]{2})[,\s]+(\d{5}(?:-\d{4})?|[A-Z]\d[A-Z]\s?\d[A-Z]\d)\b/g;

let lastGeocode = 0;
async function geocode(q: string): Promise<{ lat: number; lon: number } | null> {
  const wait = 1100 - (Date.now() - lastGeocode);
  if (wait > 0) await sleep(wait);
  lastGeocode = Date.now();
  try {
    const res = await fetch("https://photon.komoot.io/api/?limit=1&q=" + encodeURIComponent(q), { headers: { "User-Agent": "OutsetBot/0.1 (+https://outset.local)" }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { features?: { geometry: { coordinates: [number, number] }; properties: { countrycode?: string } }[] };
    const f = j.features?.[0];
    if (!f || (f.properties.countrycode && !/^(US|CA)$/i.test(f.properties.countrycode))) return null;
    return { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] };
  } catch {
    return null;
  }
}

/** Find a locations page from the homepage nav, read its street addresses, geocode them. */
export async function locationsFromSite(op: OpRow): Promise<{ page: string | null; found: number; added: number }> {
  const start = op.website?.startsWith("http") ? op.website : "https://" + (op.website || op.domain);
  const home = await fetchHtml(start);
  if (home.status !== 200 || !home.html) return { page: null, found: 0, added: 0 };
  const $ = load(home.html);
  const origin = new URL(home.finalUrl || start).origin;
  const candidates: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const text = $(el).text().trim();
    if (!LOC_LINK.test(href) && !LOC_LINK.test(text)) return;
    if (NOT_VENUES.test(href) || NOT_VENUES.test(text)) return;
    try {
      const u = new URL(href, home.finalUrl || start);
      if (u.origin === origin && !/#|mailto:|tel:/.test(href)) candidates.push(u.origin + u.pathname.replace(/\/$/, "") + "/");
    } catch {
      /* ignore */
    }
  });
  // "/locations/" beats "/locations-old/" and "/locations/waterloo/": the shortest clean path is the index.
  const page: string | null = [...new Set(candidates)].sort((a, b) => a.length - b.length)[0] || null;
  const seen = new Set<string>();
  const addrs: { street: string; city: string; region: string; postal: string }[] = [];
  const pull = (html: string, cap: number) => {
    const text = load(html).text().replace(/\s+/g, " ");
    let m: RegExpExecArray | null;
    STREET_RE.lastIndex = 0;
    let n = 0;
    while ((m = STREET_RE.exec(text)) && addrs.length < 40 && n < cap) {
      const key = (m[1] + m[4]).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      addrs.push({ street: m[1].trim(), city: m[2].trim(), region: m[3], postal: m[4] });
      n += 1;
    }
  };
  const pageHtml = page ? (await fetchHtml(page).catch(() => null))?.html || "" : home.html;
  pull(pageHtml, 40);
  // A locations index that only links to one page per city: read each city page for its address.
  if (page && addrs.length < 2) {
    const $$ = load(pageHtml);
    const subs = new Set<string>();
    $$("a[href]").each((_, el) => {
      try {
        const u = new URL($$(el).attr("href") || "", page);
        const path = u.origin + u.pathname.replace(/\/$/, "") + "/";
        if (u.origin === origin && path !== page && /location|venue|store|branch/i.test(u.pathname) && !NOT_VENUES.test(u.pathname)) subs.add(path);
      } catch {
        /* ignore */
      }
    });
    for (const sub of [...subs].slice(0, 40)) {
      await sleep(150);
      const res = await fetchHtml(sub).catch(() => null);
      if (res?.status === 200 && res.html) pull(res.html, 1);
    }
  }
  if (addrs.length < 2) return { page, found: addrs.length, added: 0 };
  // Seven or more addresses all in one city is a pickup or hotel list, not a chain of venues.
  const cities = new Set(addrs.map((a) => a.city.toLowerCase()));
  if (addrs.length >= 7 && cities.size === 1) return { page, found: addrs.length, added: 0 };
  const points: { a: (typeof addrs)[number]; pt: { lat: number; lon: number } }[] = [];
  for (const a of addrs) {
    const pt = await geocode(`${a.street}, ${a.city}, ${a.region} ${a.postal}`);
    if (pt) points.push({ a, pt });
  }
  // Six or more places all within 40 km of each other is a park district or a pickup list, not venues in different towns.
  if (points.length >= 6) {
    let spread = 0;
    for (const x of points) for (const y of points) spread = Math.max(spread, kmBetween(x.pt, y.pt));
    if (spread < 40) return { page, found: addrs.length, added: 0 };
  }
  let added = 0;
  for (const { a, pt } of points) {
    if (addLocation(op, { street: a.street, city: a.city, region: a.region, postal: a.postal, lat: pt.lat, lon: pt.lon }, "site")) added += 1;
  }
  db.prepare("INSERT INTO sources (id, operator_id, url, fetched_at, http_status, extractor, robots_allowed, note) VALUES (?, ?, ?, ?, 200, 'locations', 1, ?)").run(randomUUID(), op.id, page || start, nowIso(), `${addrs.length} addresses on the site, ${added} new locations`);
  return { page, found: addrs.length, added };
}

export function pendingLocations(limit: number): OpRow[] {
  return db
    .prepare(
      `SELECT id, domain, website, lat, lon, city FROM operators o
       WHERE origin != 'demo' AND website IS NOT NULL AND metro_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM sources s WHERE s.operator_id = o.id AND s.extractor = 'locations')
       ORDER BY review_count DESC NULLS LAST, name ASC
       LIMIT ?`,
    )
    .all(limit) as OpRow[];
}

export async function locationsPending(limit: number, concurrency = 8): Promise<{ sites: number; withPage: number; added: number }> {
  const queue = pendingLocations(limit);
  const out = { sites: 0, withPage: 0, added: 0 };
  let i = 0;
  const mark = db.prepare("INSERT INTO sources (id, operator_id, url, fetched_at, http_status, extractor, robots_allowed, note) VALUES (?, ?, ?, ?, 0, 'locations', 1, ?)");
  const worker = async () => {
    while (i < queue.length) {
      const op = queue[i++];
      try {
        const r = await withDeadline(locationsFromSite(op), 120000, op.domain);
        out.sites += 1;
        if (r.page) out.withPage += 1;
        out.added += r.added;
        if (r.found < 2) mark.run(randomUUID(), op.id, op.website || op.domain, nowIso(), "no locations page or a single address");
      } catch (e) {
        out.sites += 1;
        mark.run(randomUUID(), op.id, op.website || op.domain, nowIso(), "error: " + (e as Error).message.slice(0, 80));
      }
      if (out.sites % 200 === 0) console.log(`${out.sites}/${queue.length} sites, ${out.withPage} with a locations page, ${out.added} locations added`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(spawnWorkers(concurrency), queue.length) }, worker));
  return out;
}
