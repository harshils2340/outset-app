import "../src/env.ts";
import { randomUUID } from "node:crypto";
import { load } from "cheerio";
import { db, nowIso } from "../src/db/client.ts";
import { fetchHtml, withDeadline } from "../src/scrape/fetch.ts";
import { harvestHours } from "../src/enrich/hoursMarkup.ts";

/**
 * Hours-only pass over operators that have a website but no hours. Home page first, then up to four pages
 * whose link text or path says hours, contact, visit, location or about. Writes operators.hours and an
 * hours_text fact; never touches anything else. Safe to rerun: skips operators that gained hours.
 */
const limit = Number(process.argv[2] || 20000);
const concurrency = Number(process.argv[3] || 10);
db.exec("PRAGMA busy_timeout = 180000");
const rows = db
  .prepare(
    `SELECT id, domain, website FROM operators o
     WHERE origin != 'demo' AND website IS NOT NULL AND (hours IS NULL OR hours = '')
       AND NOT EXISTS (SELECT 1 FROM facts f WHERE f.operator_id = o.id AND f.fact_key = 'hours_checked')
     ORDER BY (metro_id IS NULL), review_count DESC NULLS LAST LIMIT ?`,
  )
  .all(limit) as { id: string; domain: string; website: string }[];
const WANT = /hour|contact|visit|location|about|find-us|plan|info/i;
const setHours = db.prepare("UPDATE operators SET hours = ?, updated_at = ? WHERE id = ?");
const ins = db.prepare("INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?, ?, ?, ?, ?, 'site')");
let i = 0;
let found = 0;
let done = 0;
async function one(op: { id: string; domain: string; website: string }): Promise<string[]> {
  const start = op.website.startsWith("http") ? op.website : "https://" + op.website;
  const home = await fetchHtml(start).catch(() => null);
  if (!home || home.status !== 200 || !home.html) return [];
  let lines = harvestHours(home.html);
  if (lines.length) return lines;
  const $ = load(home.html);
  const origin = new URL(start).origin;
  const cands: string[] = [];
  $("a[href]").each((_, el) => {
    try {
      const u = new URL($(el).attr("href") || "", home.finalUrl || start);
      if (u.origin !== origin) return;
      if (WANT.test(u.pathname + " " + $(el).text()) && !cands.includes(u.origin + u.pathname)) cands.push(u.origin + u.pathname);
    } catch {
      /* ignore */
    }
  });
  for (const url of cands.slice(0, 4)) {
    const r = await fetchHtml(url).catch(() => null);
    if (!r || r.status !== 200 || !r.html) continue;
    lines = harvestHours(r.html);
    if (lines.length) return lines;
  }
  return [];
}
const worker = async () => {
  while (i < rows.length) {
    const op = rows[i++];
    try {
      const lines = await withDeadline(one(op), 45000, op.domain);
      const now = nowIso();
      if (lines.length) {
        setHours.run(lines.join(" | ").slice(0, 500), now, op.id);
        ins.run(randomUUID(), op.id, "hours_text", lines.join(" | ").slice(0, 500), op.website);
        found += 1;
      }
      ins.run(randomUUID(), op.id, "hours_checked", lines.length ? "found" : "none", op.website);
    } catch (e) {
      console.error(op.domain + ": " + (e as Error).message.slice(0, 80));
    }
    done += 1;
    if (done % 200 === 0) console.log(`${done}/${rows.length} sites, ${found} with hours`);
  }
};
await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
console.log(`Hours: ${found}/${done} sites gained hours.`);
process.exit(0);
