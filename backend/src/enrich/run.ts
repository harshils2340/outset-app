import { randomUUID } from "node:crypto";
import { db, nowIso } from "../db/client.ts";
import { normalizePhone } from "../scrape/run.ts";
import { crawlSite } from "./crawl.ts";
import { extractFromPages, hasApiKey, model, provider, type ExtractionT, type ExtractUsage } from "./extract.ts";

/**
 * Enrichment: crawl an operator's own site, extract facts with Claude, and store them with source URLs.
 * Confidence 'ai' rows are replaced on each run. Seed rows (hand-verified) are never touched.
 * Existing operator columns are only filled when empty, never overwritten.
 */

export type EnrichResult = {
  operatorId: string;
  domain: string;
  pages: number;
  offerings: number;
  facts: number;
  status: "ok" | "no_pages" | "refused" | "error" | "skipped";
  error?: string;
  usage?: ExtractUsage;
};

type OpRow = { id: string; domain: string; name: string; website: string | null };

/** Rough list prices per million tokens for the cost readout. */
export function rate(): { in: number; out: number } {
  return provider() === "openai" ? { in: 2, out: 8 } : { in: 5, out: 25 };
}

function unitToPriceUnit(u: string | null): string {
  switch (u) {
    case "person": return "each";
    case "hour": return "/hr";
    case "boat": return "/boat";
    case "vehicle": return "/vehicle";
    case "group": return "/group";
    case "room": return "/room";
    case "half_day": return "/half day";
    case "full_day": return "/day";
    case "trip": return "/trip";
    default: return "each";
  }
}

function storeExtraction(op: OpRow, x: ExtractionT, social: Record<string, string | undefined>, vendor: string | null): { offerings: number; facts: number } {
  const now = nowIso();
  const src = op.website || "https://" + op.domain;
  const hours = x.hours.length ? x.hours.join(" | ").slice(0, 500) : null;

  db.prepare(
    `UPDATE operators SET
      phone = COALESCE(phone, ?), email = COALESCE(email, ?),
      street = COALESCE(street, ?), city = COALESCE(city, ?), region = COALESCE(region, ?), postal = COALESCE(postal, ?),
      hours = COALESCE(hours, ?), calendar_vendor = COALESCE(calendar_vendor, ?), updated_at = ?
     WHERE id = ?`,
  ).run(
    normalizePhone(x.phone), x.email, x.address.street, x.address.city, x.address.region, x.address.postal,
    hours, x.booking.vendor || vendor, now, op.id,
  );

  db.prepare("DELETE FROM offerings WHERE operator_id = ? AND confidence = 'ai'").run(op.id);
  const seen = new Set<string>();
  let offerings = 0;
  const insOff = db.prepare(
    `INSERT INTO offerings (id, operator_id, name, detail, duration, price_cents, price_unit, currency, source_url, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai')`,
  );
  for (const o of x.offerings) {
    const key = o.name.toLowerCase() + "|" + (o.duration || "");
    if (seen.has(key)) continue;
    seen.add(key);
    insOff.run(
      randomUUID(), op.id, o.name.slice(0, 120), o.detail?.slice(0, 200) || null, o.duration?.slice(0, 60) || null,
      o.price.amount == null ? null : Math.round(o.price.amount * 100), unitToPriceUnit(o.price.unit),
      o.price.currency || "USD", o.source_url || src,
    );
    offerings += 1;
  }

  db.prepare("DELETE FROM facts WHERE operator_id = ? AND confidence = 'ai'").run(op.id);
  const insFact = db.prepare(
    "INSERT INTO facts (id, operator_id, fact_key, fact_value, source_url, confidence) VALUES (?, ?, ?, ?, ?, 'ai')",
  );
  let facts = 0;
  const add = (key: string, value: string | null | undefined, url?: string | null) => {
    if (!value || !value.trim()) return;
    insFact.run(randomUUID(), op.id, key, value.trim().slice(0, 500), url || src);
    facts += 1;
  };
  add("one_line", x.one_line);
  add("description", x.description);
  add("meeting_point", x.meeting_point);
  add("season", x.season);
  if (hours) add("hours", hours);
  for (const f of x.includes) add("includes", f.value, f.source_url);
  for (const f of x.requirements) add("requirement", f.value, f.source_url);
  for (const f of x.policies) add("policy", f.value, f.source_url);
  for (const f of x.what_to_bring) add("bring", f.value, f.source_url);
  for (const f of x.group_info) add("group", f.value, f.source_url);
  for (const f of x.highlights) add("spec", f.value, f.source_url);
  for (const g of x.gaps) add("published_gap", g);
  if (x.booking.booking_url) add("booking_url", x.booking.booking_url);
  if (x.booking.online_booking != null) add("online_booking", x.booking.online_booking ? "yes" : "no");
  for (const [k, v] of Object.entries(social)) if (v) add("social:" + k, v);
  add("extract_confidence", x.confidence);
  add("extract_model", model());

  db.prepare(
    "INSERT INTO sources (id, operator_id, url, fetched_at, http_status, extractor, robots_allowed, note) VALUES (?, ?, ?, ?, 200, ?, 1, ?)",
  ).run(randomUUID(), op.id, src, now, "crawl+" + model(), "Facts extracted from the operator's own pages. Nulls kept where the site is silent.");

  return { offerings, facts };
}

export async function enrichOperator(op: OpRow): Promise<EnrichResult> {
  const base: EnrichResult = { operatorId: op.id, domain: op.domain, pages: 0, offerings: 0, facts: 0, status: "ok" };
  if (!op.website) return { ...base, status: "skipped", error: "no website" };
  try {
    const crawl = await crawlSite(op.website);
    base.pages = crawl.pages.length;
    if (!crawl.pages.length) return { ...base, status: "no_pages" };
    const { data, usage, refused } = await extractFromPages(op.name, crawl.pages);
    base.usage = usage;
    if (refused) return { ...base, status: "refused" };
    if (!data) return { ...base, status: "error", error: "no parsed output" };
    const stored = storeExtraction(op, data, crawl.social, crawl.bookingVendor);
    return { ...base, ...stored };
  } catch (e) {
    return { ...base, status: "error", error: (e as Error).message.slice(0, 300) };
  }
}

/** Operators with a website that have no 'ai' facts yet. Metro operators and richer rows first. */
export function pendingForEnrichment(limit: number): OpRow[] {
  return db
    .prepare(
      `SELECT id, domain, name, website FROM operators o
       WHERE origin != 'demo' AND website IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM facts f WHERE f.operator_id = o.id AND f.confidence = 'ai')
       ORDER BY (metro_id IS NULL), completeness DESC, name ASC
       LIMIT ?`,
    )
    .all(limit) as OpRow[];
}

export async function enrichPending(limit: number, concurrency = 3): Promise<EnrichResult[]> {
  if (!hasApiKey()) throw new Error("No API key. Put OPENAI_API_KEY or ANTHROPIC_API_KEY in backend/.env.");
  console.log(`Extraction provider: ${provider()} (${model()})`);
  const queue = pendingForEnrichment(limit);
  const out: EnrichResult[] = [];
  let i = 0;
  const worker = async () => {
    while (i < queue.length) {
      const op = queue[i++];
      const r = await enrichOperator(op);
      out.push(r);
      const cost = r.usage ? ((r.usage.input * rate().in + r.usage.output * rate().out) / 1e6).toFixed(3) : "-";
      console.log(`${op.domain}: ${r.status} pages=${r.pages} offerings=${r.offerings} facts=${r.facts} ~$${cost}${r.error ? " " + r.error : ""}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return out;
}
