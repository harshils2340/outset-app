import { randomUUID } from "node:crypto";
import { db, nowIso } from "../db/client.ts";
import { inferCategory } from "../taxonomy/catalog.ts";
import { extractPage } from "./extract.ts";
import { fetchHtml, sleep } from "./fetch.ts";

export type ScrapeResult = {
  operatorId: string;
  domain: string;
  pages: number;
  robotsBlocked: boolean;
  httpStatus: number;
};

function domainOf(url: string): string {
  return new URL(url.startsWith("http") ? url : "https://" + url).hostname.replace(/^www\./, "");
}

/** Keep phones in E.164 when they are North American. Reject junk like the INT_MAX overflow some CMSs emit. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  const n = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (n === "2147483647") return null;
  if (n.length !== 10 || /^[01]/.test(n) || /^[01]/.test(n.slice(3))) return raw.trim() || null;
  return "+1" + n;
}

function firstUrl(domain: string): string {
  return "https://" + domain.replace(/^https?:\/\//, "");
}

export async function scrapeOperator(opts: {
  operatorId: string;
  website: string;
  fallbackName: string;
}): Promise<ScrapeResult> {
  const start = opts.website.startsWith("http") ? opts.website : firstUrl(opts.website);
  const domain = domainOf(start);
  const jobId = randomUUID();
  const created = nowIso();
  db.prepare(
    "INSERT INTO scrape_jobs (id, operator_id, url, status, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(jobId, opts.operatorId, start, "running", created);

  try {
    const home = await fetchHtml(start);
    if (home.status === 0) {
      db.prepare("UPDATE scrape_jobs SET status = ?, last_error = ?, finished_at = ? WHERE id = ?").run(
        "blocked",
        "robots.txt disallowed this path",
        nowIso(),
        jobId,
      );
      db.prepare(
        "INSERT INTO sources (id, operator_id, url, fetched_at, http_status, extractor, robots_allowed, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(randomUUID(), opts.operatorId, start, nowIso(), 0, "fetch", 0, "robots blocked");
      return { operatorId: opts.operatorId, domain, pages: 0, robotsBlocked: true, httpStatus: 0 };
    }

    const pages = [home];
    const extracted = extractPage(home.html, home.finalUrl || start);
    for (const extra of extracted.extraPages.slice(0, 3)) {
      await sleep(400);
      pages.push(await fetchHtml(extra));
    }

    const merged = pages.map((p) => extractPage(p.html, p.finalUrl || start));
    const pageName = merged.map((m) => m.name).find(Boolean) || "";
    const phones = merged.map((m) => normalizePhone(m.telephone)).filter(Boolean) as string[];
    const emails = merged.map((m) => m.email).filter(Boolean) as string[];
    const cities = merged.map((m) => m.city).filter(Boolean) as string[];
    const regions = merged.map((m) => m.region).filter(Boolean) as string[];
    const streets = merged.map((m) => m.street).filter(Boolean) as string[];
    const postals = merged.map((m) => m.postal).filter(Boolean) as string[];
    const vendors = merged.map((m) => m.calendarVendor).filter(Boolean) as string[];
    const hours = [...new Set(merged.flatMap((m) => m.hours))];
    const offers = merged.flatMap((m) => m.offers);
    const desc = merged.map((m) => m.description).find(Boolean) || null;

    const cat = inferCategory([opts.fallbackName, pageName, desc || ""].join(" "));

    db.prepare(
      `UPDATE operators SET
        phone = COALESCE(phone, ?),
        email = COALESCE(email, ?),
        city = COALESCE(city, ?),
        region = COALESCE(region, ?),
        street = COALESCE(street, ?),
        postal = COALESCE(postal, ?),
        hours = COALESCE(hours, ?),
        category_id = COALESCE(category_id, ?),
        family = COALESCE(family, ?),
        calendar_vendor = COALESCE(calendar_vendor, ?),
        website = COALESCE(website, ?),
        updated_at = ?
      WHERE id = ?`,
    ).run(
      phones[0] || null,
      emails[0] || null,
      cities[0] || null,
      regions[0] || null,
      streets[0] || null,
      postals[0] || null,
      hours.length ? hours.join(" | ").slice(0, 500) : null,
      cat.id,
      cat.family,
      vendors[0] || null,
      start,
      nowIso(),
      opts.operatorId,
    );

    db.prepare("DELETE FROM offerings WHERE operator_id = ? AND confidence = 'scraped'").run(opts.operatorId);
    const seen = new Set<string>();
    for (const o of offers) {
      const key = o.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      db.prepare(
        `INSERT INTO offerings (id, operator_id, name, detail, duration, price_cents, price_unit, currency, source_url, confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'USD', ?, 'scraped')`,
      ).run(randomUUID(), opts.operatorId, o.name, o.detail || null, o.duration, o.priceCents, o.priceUnit, start);
    }

    db.prepare("DELETE FROM facts WHERE operator_id = ? AND confidence = 'scraped'").run(opts.operatorId);
    if (desc) {
      db.prepare(
        "INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?, ?, ?, ?, ?, 'scraped')",
      ).run(randomUUID(), opts.operatorId, "description", desc.slice(0, 800), start);
    }
    if (hours.length) {
      db.prepare(
        "INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?, ?, ?, ?, ?, 'scraped')",
      ).run(randomUUID(), opts.operatorId, "hours", hours.join(" | ").slice(0, 500), start);
    }

    for (const p of pages) {
      db.prepare(
        "INSERT INTO sources (id, operator_id, url, fetched_at, http_status, extractor, robots_allowed, note) VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
      ).run(randomUUID(), opts.operatorId, p.finalUrl, nowIso(), p.status, "html+jsonld", "live fetch");
    }

    db.prepare("UPDATE scrape_jobs SET status = ?, finished_at = ?, last_error = NULL WHERE id = ?").run(
      "ok",
      nowIso(),
      jobId,
    );
    return { operatorId: opts.operatorId, domain, pages: pages.length, robotsBlocked: false, httpStatus: home.status };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    db.prepare("UPDATE scrape_jobs SET status = ?, last_error = ?, finished_at = ? WHERE id = ?").run(
      "error",
      msg,
      nowIso(),
      jobId,
    );
    throw err;
  }
}

export async function scrapePending(limit = 25): Promise<ScrapeResult[]> {
  const rows = db
    .prepare(
      "SELECT id, website, name FROM operators WHERE origin != 'demo' AND website IS NOT NULL ORDER BY updated_at ASC LIMIT ?",
    )
    .all(limit) as { id: string; website: string; name: string }[];
  const out: ScrapeResult[] = [];
  for (const row of rows) {
    out.push(await scrapeOperator({ operatorId: row.id, website: row.website, fallbackName: row.name }));
    await sleep(500);
  }
  return out;
}
