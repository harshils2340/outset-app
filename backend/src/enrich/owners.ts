import { randomUUID } from "node:crypto";
import { db, nowIso } from "../db/client.ts";
import { sleep, withDeadline } from "../scrape/fetch.ts";
import { spawnWorkers } from "../scrape/cpu.ts";
import { ownersForOperator } from "./ownerSite.ts";

/**
 * Owner-level contacts. Small operators put the owner on the About page: "Captain Mike, owner",
 * "Founded by Sarah and Tom", a personal email like mike@..., a cell number "call or text Mike".
 * This reads the home page plus About, Team, Our Story and Contact pages and keeps what it finds
 * as facts (owner_name, owner_title, owner_email, owner_phone), each with the page it came from.
 * Nothing is invented: a name is stored only when it sits next to an owner word on the operator's own site.
 *
 * Reading one site is ownerSite.ts, which needs no database, so the cloud pool's lookup (scripts/owners-pool.mts)
 * reads sites exactly the way this crawl does. This file is the laptop catalog's side: the queue and the facts.
 */
export { ownersForOperator, ownersForSite, type OwnerFound } from "./ownerSite.ts";

/**
 * `ottoFirst` puts the Otto outreach pool (unclaimed water operators with a phone and an email) ahead, in the
 * order the Otto ramp will mail them, so the owners looked up next are the ones about to be written to
 * (Harshil, 25 September 2026: write to the owner, not booking@, whenever the site names one).
 */
export function pendingOwners(limit: number, ottoFirst = false): { id: string; domain: string; website: string }[] {
  const OTTO_POOL = "(o.family = 'water' AND o.claim_status = 'unclaimed' AND o.email LIKE '%@%' AND o.phone IS NOT NULL AND o.phone != '')";
  const order = ottoFirst
    ? `ORDER BY ${OTTO_POOL} DESC, o.completeness DESC NULLS LAST, review_count DESC NULLS LAST`
    : "ORDER BY review_count DESC NULLS LAST";
  // The structure crawl is the usual proof a site answers, but two thirds of the Otto pool (9,262 of 13,880 on
  // 26 September 2026) have never had it, which left this crawl with nothing from the pool to do. For the
  // pool the site's own contact pages are the point, so the proof is waived and this crawl finds out itself;
  // a site that does not answer is marked like any other failure and not asked again.
  const reachable = ottoFirst
    ? `AND (EXISTS (SELECT 1 FROM sources s WHERE s.operator_id = o.id AND s.extractor = 'site-structure' AND s.http_status = 200) OR ${OTTO_POOL})`
    : "AND EXISTS (SELECT 1 FROM sources s WHERE s.operator_id = o.id AND s.extractor = 'site-structure' AND s.http_status = 200)";
  return db
    .prepare(
      `SELECT id, domain, website FROM operators o WHERE origin != 'demo' AND website IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM sources s WHERE s.operator_id = o.id AND s.extractor = 'owners')
         ${reachable}
       ${order} LIMIT ?`,
    )
    .all(limit) as { id: string; domain: string; website: string }[];
}

export async function ownersPending(limit: number, concurrency = 12, ottoFirst = false): Promise<{ sites: number; withOwner: number; names: number; emails: number; phones: number }> {
  const queue = pendingOwners(limit, ottoFirst);
  const out = { sites: 0, withOwner: 0, names: 0, emails: 0, phones: 0 };
  const ins = db.prepare("INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?, ?, ?, ?, ?, 'site')");
  const mark = db.prepare("INSERT INTO sources (id, operator_id, url, fetched_at, http_status, extractor, robots_allowed, note) VALUES (?, ?, ?, ?, 200, 'owners', 1, ?)");
  let i = 0;
  const worker = async (w: number) => {
    await sleep(w * 300);
    while (i < queue.length) {
      const op = queue[i++];
      try {
        const found = await withDeadline(ownersForOperator(op), 90000, op.domain);
        out.sites += 1;
        if (found.length) out.withOwner += 1;
        for (const f of found) {
          if (f.name) { ins.run(randomUUID(), op.id, "owner_name", f.name + (f.title ? " (" + f.title + ")" : ""), f.url); out.names += 1; }
          if (f.email) { ins.run(randomUUID(), op.id, "owner_email", f.email, f.url); out.emails += 1; }
          if (f.phone) { ins.run(randomUUID(), op.id, "owner_phone", f.phone + (f.name ? " (" + f.name + ")" : ""), f.url); out.phones += 1; }
        }
        mark.run(randomUUID(), op.id, "owners:" + op.domain, nowIso(), found.length + " contacts");
      } catch (e) {
        out.sites += 1;
        try { mark.run(randomUUID(), op.id, "owners:" + op.domain, nowIso(), "failed " + (e as Error).message.slice(0, 60)); } catch { /* locked */ }
      }
      if (out.sites % 100 === 0) console.log(`${out.sites}/${queue.length} sites, ${out.withOwner} with a contact, ${out.names} names, ${out.emails} emails, ${out.phones} phones`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(spawnWorkers(concurrency), queue.length) }, (_, w) => worker(w)));
  return out;
}

/** CSV of every owner-level contact, one row per operator, best contact first. */
export function ownersCsv(): string {
  const rows = db
    .prepare(
      `SELECT o.name AS business, o.city, o.region, o.category_id AS category, o.website, o.phone AS front_desk, o.email AS front_email, o.review_count,
              (SELECT group_concat(fact_value, ' | ') FROM facts f WHERE f.operator_id = o.id AND f.fact_key = 'owner_name') AS owner,
              (SELECT group_concat(fact_value, ' | ') FROM facts f WHERE f.operator_id = o.id AND f.fact_key = 'owner_email') AS owner_email,
              (SELECT group_concat(fact_value, ' | ') FROM facts f WHERE f.operator_id = o.id AND f.fact_key = 'owner_phone') AS owner_phone,
              (SELECT source_url FROM facts f WHERE f.operator_id = o.id AND f.fact_key IN ('owner_name','owner_email','owner_phone') LIMIT 1) AS source
       FROM operators o
       WHERE EXISTS (SELECT 1 FROM facts f WHERE f.operator_id = o.id AND f.fact_key IN ('owner_name','owner_email','owner_phone'))
       ORDER BY (owner_phone IS NULL), (owner_email IS NULL), o.review_count DESC NULLS LAST`,
    )
    .all() as Record<string, string | number | null>[];
  const esc = (v: unknown) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
  const cols = ["business", "city", "region", "category", "owner", "owner_email", "owner_phone", "front_desk", "front_email", "website", "review_count", "source"];
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}
