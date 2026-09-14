import { randomUUID } from "node:crypto";
import { db, nowIso } from "../db/client.ts";
import { sleep, withDeadline } from "../scrape/fetch.ts";
import { spawnWorkers } from "../scrape/cpu.ts";
import { normalizePhone } from "../scrape/run.ts";
import { scrapeSite, serviceCount, type ScrapeResult } from "./sitescrape.ts";

/**
 * Rule-based site reading, no language model. It reads what the operator's own site is organized around:
 * navigation links, page titles and headings. "Jet Ski Rentals", "Kayak Rentals", "Sunset Cruise", "Online Waiver",
 * "Reserve Now". Prices are copied only when a dollar amount sits right next to a service heading.
 * Everything stored has confidence 'site' and the page it came from. Nothing is guessed.
 *
 * The reading itself lives in `sitescrape.ts`, which touches no database so it can run on a GitHub Actions
 * runner. This file is the other half: it takes what a scrape found and writes it into offerings, facts,
 * operators and sources. Behaviour for callers here is unchanged.
 */

export { photoNear } from "./sitescrape.ts";

export type StructureResult = {
  operatorId: string;
  domain: string;
  pages: number;
  services: number;
  status: "ok" | "no_pages" | "error";
  error?: string;
};

/**
 * Store what a scrape found. Site rows are replaced wholesale, because a re-read of the same site is the
 * newer truth; photo and video facts come from the media crawl and outlive a structure re-read. Offerings are
 * only written when nothing better (a booking widget, a seed, an extraction) already priced this operator.
 */
export function saveSiteStructure(op: { id: string; domain: string; website: string }, scrape: ScrapeResult): StructureResult {
  const base: StructureResult = { operatorId: op.id, domain: op.domain, pages: scrape.pages, services: 0, status: scrape.status, error: scrape.error };
  if (scrape.status !== "ok") return base;
  const now = nowIso();
  const start = scrape.start;
  db.prepare("DELETE FROM offerings WHERE operator_id = ? AND confidence = 'site'").run(op.id);
  db.prepare("DELETE FROM facts WHERE operator_id = ? AND confidence = 'site' AND fact_key NOT IN ('photo', 'cover', 'video', 'video_embed')").run(op.id);
  const insOff = db.prepare(
    `INSERT INTO offerings (id, operator_id, name, detail, duration, price_cents, price_unit, currency, source_url, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'site')`,
  );
  const insFact = db.prepare(
    "INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?, ?, ?, ?, ?, 'site')",
  );
  const hasAi = db.prepare("SELECT 1 FROM offerings WHERE operator_id = ? AND confidence IN ('ai','seed','widget') LIMIT 1").get(op.id);
  if (!hasAi) {
    for (const s of scrape.services) {
      insOff.run(randomUUID(), op.id, s.name, s.detail, s.duration, s.price_cents, s.price_unit, s.currency, s.source_url);
    }
  }
  for (const f of scrape.facts) insFact.run(randomUUID(), op.id, f.fact_key, f.fact_value, f.source_url);
  base.services = serviceCount(scrape);
  db.prepare(
    `UPDATE operators SET phone = COALESCE(phone, ?), hours = COALESCE(hours, ?), email = COALESCE(email, ?), updated_at = ? WHERE id = ?`,
  ).run(normalizePhone(scrape.contact.phone), scrape.contact.hours || null, scrape.contact.email || null, now, op.id);
  db.prepare("DELETE FROM sources WHERE operator_id = ? AND extractor = 'site-structure'").run(op.id);
  db.prepare(
    "INSERT INTO sources (id, operator_id, url, fetched_at, http_status, extractor, robots_allowed, note) VALUES (?, ?, ?, ?, 200, 'site-structure', 1, ?)",
  ).run(randomUUID(), op.id, start, now, "deep " + base.pages + " pages: service names, descriptions, prices, waiver and booking links read from the site's own pages.");
  return base;
}

export async function readSiteStructure(op: { id: string; domain: string; website: string }): Promise<StructureResult> {
  const scrape = await scrapeSite(op);
  try {
    return saveSiteStructure(op, scrape);
  } catch (e) {
    return { operatorId: op.id, domain: op.domain, pages: scrape.pages, services: 0, status: "error", error: (e as Error).message.slice(0, 200) };
  }
}

export function pendingStructure(limit: number, redo = false): { id: string; domain: string; website: string }[] {
  // redo: sites read before the deep crawl existed (their source note lacks "deep"). Metro operators with the most reviews first.
  const cond = redo
    ? `AND NOT EXISTS (SELECT 1 FROM sources s WHERE s.operator_id = o.id AND s.extractor = 'site-structure' AND s.note LIKE 'deep %')`
    : `AND NOT EXISTS (SELECT 1 FROM sources s WHERE s.operator_id = o.id AND s.extractor = 'site-structure')`;
  return db
    .prepare(
      `SELECT id, domain, website FROM operators o
       WHERE origin != 'demo' AND website IS NOT NULL ${cond}
       ORDER BY (metro_id IS NULL), review_count DESC NULLS LAST, name ASC
       LIMIT ?`,
    )
    .all(limit) as { id: string; domain: string; website: string }[];
}

export async function readPendingStructures(limit: number, concurrency = 6, redo = false): Promise<StructureResult[]> {
  const queue = pendingStructure(limit, redo);
  const out: StructureResult[] = [];
  let i = 0;
  let done = 0;
  let errors = 0;
  const worker = async (w: number) => {
    await sleep(w * 400);
    while (i < queue.length) {
      const op = queue[i++];
      const r = await withDeadline(readSiteStructure(op), 40000, op.domain).catch((e) => ({ operatorId: op.id, domain: op.domain, pages: 0, services: 0, status: "error" as const, error: (e as Error).message }));
      out.push(r);
      done += 1;
      if (r.status !== "ok") {
        // Mark the attempt so the next run moves on instead of retrying the same dead or blocked sites first.
        db.prepare(
          "INSERT INTO sources (id, operator_id, url, fetched_at, http_status, extractor, robots_allowed, note) VALUES (?, ?, ?, ?, 0, 'site-structure', 1, ?)",
        ).run(randomUUID(), op.id, op.website, nowIso(), (r.status + ": " + (r.error || "no readable pages")).slice(0, 200));
      }
      if (r.status === "error" && errors < 12) {
        errors += 1;
        console.error(op.domain + ": " + r.error);
      }
      if (done % 50 === 0) {
        const ok = out.filter((x) => x.status === "ok").length;
        const svc = out.reduce((n, x) => n + x.services, 0);
        console.log(`${done}/${queue.length} sites, ${ok} readable, ${svc} services found`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(spawnWorkers(concurrency), queue.length) }, (_, w) => worker(w)));
  return out;
}
