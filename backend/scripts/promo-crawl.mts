import "../src/env.ts";
import { randomUUID } from "node:crypto";
import { db } from "../src/db/client.ts";
import { fetchHtml, withDeadline } from "../src/scrape/fetch.ts";
import { minePromos, pageText, promoPages, type Promo } from "../src/enrich/promos.ts";
import { guardLaptopJob } from "../src/scrape/guard.ts";
import { spawnWorkers } from "../src/scrape/cpu.ts";

/**
 * Promo pass: day-specific deals from each operator's own site, rules only, no model calls.
 * Home page first, then up to four pages whose link says deals, specials, events, happy hour or a weekday.
 * Writes one `promo` fact per deal (JSON of the Promo, source_url = the page) and a `promo_checked` fact so
 * reruns skip the operator. Old promo facts for the operator are replaced. Nothing else is touched.
 *
 *   npx tsx scripts/promo-crawl.mts --limit=30 [--concurrency=6] [--domain=airriderz.com] [--redo]
 */
const arg = (k: string, d: string) => (process.argv.find((a) => a.startsWith("--" + k + "=")) || "").split("=")[1] || d;
const limit = Number(arg("limit", "20000"));
const concurrency = Number(arg("concurrency", "6"));
const domain = arg("domain", "");
const redo = process.argv.includes("--redo") || !!domain;
if (!domain) guardLaptopJob({ name: "promo-crawl", limit, concurrency });
db.exec("PRAGMA busy_timeout = 180000");
const rows = db
  .prepare(
    `SELECT id, domain, website FROM operators o
     WHERE origin != 'demo' AND website IS NOT NULL
       ${domain ? "AND domain = ?" : ""}
       ${redo ? "" : "AND NOT EXISTS (SELECT 1 FROM facts f WHERE f.operator_id = o.id AND f.fact_key = 'promo_checked')"}
     ORDER BY (metro_id IS NULL), review_count DESC NULLS LAST LIMIT ?`,
  )
  .all(...(domain ? [domain, limit] : [limit])) as { id: string; domain: string; website: string }[];
const del = db.prepare("DELETE FROM facts WHERE operator_id = ? AND fact_key IN ('promo', 'promo_checked')");
const ins = db.prepare("INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?, ?, ?, ?, ?, 'site')");
function save(opId: string, website: string, promos: Promo[]): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    del.run(opId);
    for (const p of promos) ins.run(randomUUID(), opId, "promo", JSON.stringify(p), p.source);
    ins.run(randomUUID(), opId, "promo_checked", String(promos.length), website);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

async function one(op: { id: string; domain: string; website: string }): Promise<Promo[]> {
  const start = op.website.startsWith("http") ? op.website : "https://" + op.website;
  const home = await fetchHtml(start).catch(() => null);
  if (!home || home.status !== 200 || !home.html) return [];
  const base = home.finalUrl || start;
  const found: Promo[] = minePromos(pageText(home.html), base);
  for (const url of promoPages(home.html, base)) {
    const r = await fetchHtml(url).catch(() => null);
    if (!r || r.status !== 200 || !r.html) continue;
    found.push(...minePromos(pageText(r.html), r.finalUrl || url));
  }
  const seen = new Set<string>();
  return found.filter((p) => {
    const k = p.text.toLowerCase();
    return seen.has(k) ? false : (seen.add(k), true);
  }).slice(0, 12);
}

let i = 0;
let done = 0;
let withPromos = 0;
let total = 0;
const worker = async () => {
  while (i < rows.length) {
    const op = rows[i++];
    try {
      const promos = await withDeadline(one(op), 60000, op.domain);
      save(op.id, op.website, promos);
      if (promos.length) {
        withPromos += 1;
        total += promos.length;
        for (const p of promos) console.log(op.domain + " [" + (p.days.length ? p.days.join(",") : "daily") + (p.start || p.end ? " " + (p.start || "") + "-" + (p.end || "") : "") + "] " + p.text);
      }
    } catch (e) {
      console.error(op.domain + ": " + (e as Error).message.slice(0, 80));
      try {
        save(op.id, op.website, []);
      } catch {
        /* lock contention: the operator is retried next run */
      }
    }
    done += 1;
    if (done % 100 === 0) console.log(`${done}/${rows.length} sites, ${withPromos} with promos`);
  }
};
await Promise.all(Array.from({ length: Math.min(spawnWorkers(concurrency), rows.length) }, worker));
console.log(`Promos: ${withPromos}/${done} sites had day-specific deals, ${total} promos written.`);
process.exit(0);
