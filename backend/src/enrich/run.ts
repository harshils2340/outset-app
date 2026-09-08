import { randomUUID } from "node:crypto";
import { db, nowIso } from "../db/client.ts";
import { normalizePhone } from "../scrape/run.ts";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { crawlSite, estimateTokens, selectPages, type CrawlResult, type CrawledPage } from "./crawl.ts";
import { buildDoc, extractFromPages, hasApiKey, model, openaiRequestBody, parseOpenAI, priceFor, provider, type ExtractionT, type ExtractUsage } from "./extract.ts";

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

/** List prices per million tokens for the model in use. Batch jobs are billed at half. */
export function rate(batch = false): { in: number; out: number } {
  const p = priceFor(model());
  return batch ? { in: p.in / 2, out: p.out / 2 } : p;
}

/* ---------- hard budget ---------- */

export function budgetUsd(): number {
  return Number(process.env.OUTSET_EXTRACT_BUDGET_USD || 20);
}

export function spentUsd(): number {
  const r = db.prepare("SELECT COALESCE(SUM(usd), 0) AS s FROM extract_spend").get() as { s: number };
  return r.s;
}

function recordSpend(operatorId: string, usage: ExtractUsage, batch: boolean, batchId: string | null): number {
  const r = rate(batch);
  const usd = (usage.input * r.in + usage.output * r.out) / 1e6;
  db.prepare("INSERT INTO extract_spend (id, operator_id, model, input, output, usd, batch_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    randomUUID(), operatorId, model(), usage.input, usage.output, usd, batchId, nowIso(),
  );
  return usd;
}

/** What one site will cost before we send it, from the trimmed text. Output is assumed at 900 tokens. */
export function estimateUsd(name: string, pages: CrawledPage[], batch: boolean): number {
  const r = rate(batch);
  const input = estimateTokens(buildDoc(name, pages)) + 900; // 900 for the system prompt and schema
  return (input * r.in + 900 * r.out) / 1e6;
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
    const pages = selectPages(crawl.pages);
    base.pages = pages.length;
    if (!pages.length || estimateTokens(buildDoc(op.name, pages)) < 350) return { ...base, status: "no_pages", error: "nothing readable" };
    if (spentUsd() + estimateUsd(op.name, pages, false) > budgetUsd()) return { ...base, status: "skipped", error: "budget reached" };
    const { data, usage, refused } = await extractFromPages(op.name, pages);
    base.usage = usage;
    recordSpend(op.id, usage, false, null);
    if (refused) return { ...base, status: "refused" };
    if (!data) return { ...base, status: "error", error: "no parsed output" };
    const stored = storeExtraction(op, data, crawl.social, crawl.bookingVendor);
    return { ...base, ...stored };
  } catch (e) {
    return { ...base, status: "error", error: (e as Error).message.slice(0, 300) };
  }
}

/**
 * Operators worth paying for: a website, no model pass yet, and a real gap left after the free sources:
 * no priced option, or no requirement and policy lines. Metro operators with the most reviews first.
 */
export function pendingForEnrichment(limit: number): OpRow[] {
  return db
    .prepare(
      `SELECT id, domain, name, website FROM operators o
       WHERE origin != 'demo' AND website IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM facts f WHERE f.operator_id = o.id AND f.confidence = 'ai')
         AND NOT EXISTS (SELECT 1 FROM extract_spend x WHERE x.operator_id = o.id)
         AND (
           NOT EXISTS (SELECT 1 FROM offerings x WHERE x.operator_id = o.id AND x.price_cents IS NOT NULL)
           OR NOT EXISTS (SELECT 1 FROM facts f WHERE f.operator_id = o.id AND f.fact_key IN ('requirement', 'policy'))
         )
       ORDER BY (metro_id IS NULL), review_count DESC NULLS LAST, completeness DESC, name ASC
       LIMIT ?`,
    )
    .all(limit) as OpRow[];
}

export async function enrichPending(limit: number, concurrency = 3): Promise<EnrichResult[]> {
  if (!hasApiKey()) throw new Error("No API key. Put OPENAI_API_KEY or ANTHROPIC_API_KEY in backend/.env.");
  console.log(`Extraction provider: ${provider()} (${model()}). Budget $${budgetUsd().toFixed(2)}, spent $${spentUsd().toFixed(2)}.`);
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


/* ---------- OpenAI Batch API: half price, results within a day ---------- */

const BATCH_DIR = new URL("../../data/batches/", import.meta.url);

type BatchMeta = { batchId: string; model: string; submittedAt: string; ops: Record<string, { op: OpRow; social: CrawlResult["social"]; vendor: string | null; estUsd: number }> };

/** Crawl, trim and write one JSONL line per operator, then hand the file to OpenAI. Nothing is billed until the batch runs. */
export async function submitBatch(limit: number, concurrency = 6): Promise<{ batchId: string | null; ops: number; estUsd: number; file: string }> {
  if (provider() !== "openai" || !hasApiKey()) throw new Error("Batch mode needs OPENAI_API_KEY.");
  mkdirSync(BATCH_DIR, { recursive: true });
  const queue = pendingForEnrichment(limit);
  const lines: string[] = [];
  const meta: BatchMeta = { batchId: "", model: model(), submittedAt: nowIso(), ops: {} };
  let est = 0;
  const cap = budgetUsd() - spentUsd() - reservedUsd();
  let i = 0;
  const worker = async () => {
    while (i < queue.length) {
      const op = queue[i++];
      try {
        const crawl = await crawlSite(op.website!);
        const pages = selectPages(crawl.pages);
        if (!pages.length || estimateTokens(buildDoc(op.name, pages)) < 350) {
          markUnreadable(op.id);
          continue;
        }
        const cost = estimateUsd(op.name, pages, true);
        if (est + cost > cap) continue;
        est += cost;
        lines.push(JSON.stringify({ custom_id: op.id, method: "POST", url: "/v1/chat/completions", body: openaiRequestBody(op.name, pages) }));
        meta.ops[op.id] = { op, social: crawl.social, vendor: crawl.bookingVendor, estUsd: cost };
        if (lines.length % 100 === 0) console.log(`${lines.length} sites prepared, ~$${est.toFixed(2)}`);
      } catch (e) {
        console.error(op.domain + ": " + (e as Error).message.slice(0, 100));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  const stamp = meta.submittedAt.replace(/[:.]/g, "-");
  const file = new URL(stamp + ".jsonl", BATCH_DIR);
  writeFileSync(file, lines.join("\n") + "\n");
  if (!lines.length) return { batchId: null, ops: 0, estUsd: 0, file: file.pathname };
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI();
  const upload = await client.files.create({ file: new File([readFileSync(file)], stamp + ".jsonl"), purpose: "batch" });
  const batch = await client.batches.create({ input_file_id: upload.id, endpoint: "/v1/chat/completions", completion_window: "24h" });
  meta.batchId = batch.id;
  writeFileSync(new URL(batch.id + ".json", BATCH_DIR), JSON.stringify(meta));
  // Reserve the estimate so a second submit cannot overshoot the budget before results are in.
  db.prepare("INSERT INTO extract_spend (id, operator_id, model, input, output, usd, batch_id, at) VALUES (?, 'reserved', ?, 0, 0, ?, ?, ?)").run(randomUUID(), model(), est, batch.id, nowIso());
  return { batchId: batch.id, ops: lines.length, estUsd: est, file: file.pathname };
}

/** A site the crawler cannot read (JavaScript-only shell, parked page) is never queued again. Zero spend recorded. */
function markUnreadable(operatorId: string): void {
  db.prepare("INSERT INTO extract_spend (id, operator_id, model, input, output, usd, batch_id, at) VALUES (?, ?, 'unreadable', 0, 0, 0, NULL, ?)").run(randomUUID(), operatorId, nowIso());
}

function reservedUsd(): number {
  const r = db.prepare("SELECT COALESCE(SUM(usd), 0) AS s FROM extract_spend WHERE operator_id = 'reserved'").get() as { s: number };
  return r.s;
}

/** Pull a finished batch, store every extraction, replace the reservation with the real spend. */
export async function collectBatch(batchId: string): Promise<{ status: string; stored: number; failed: number; usd: number }> {
  const metaFile = new URL(batchId + ".json", BATCH_DIR);
  if (!existsSync(metaFile)) throw new Error("No local record of batch " + batchId);
  const meta = JSON.parse(readFileSync(metaFile, "utf8")) as BatchMeta;
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI();
  const batch = await client.batches.retrieve(batchId);
  if (batch.status !== "completed" || !batch.output_file_id) return { status: batch.status, stored: 0, failed: 0, usd: 0 };
  const text = await (await client.files.content(batch.output_file_id)).text();
  let stored = 0;
  let failed = 0;
  let usd = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as { custom_id: string; response?: { status_code: number; body: Parameters<typeof parseOpenAI>[0] } };
    const entry = meta.ops[row.custom_id];
    if (!entry || !row.response || row.response.status_code !== 200) {
      failed += 1;
      continue;
    }
    const { data, usage } = parseOpenAI(row.response.body);
    usd += recordSpend(row.custom_id, usage, true, batchId);
    if (!data) {
      failed += 1;
      continue;
    }
    storeExtraction(entry.op, data, entry.social, entry.vendor);
    stored += 1;
  }
  db.prepare("DELETE FROM extract_spend WHERE operator_id = 'reserved' AND batch_id = ?").run(batchId);
  return { status: batch.status, stored, failed, usd };
}

/** Free dry run: crawl and trim, report tokens and cost per site without calling any model. */
export async function dryRun(limit: number, concurrency = 6): Promise<{ sites: number; tokens: number; liveUsd: number; batchUsd: number }> {
  const queue = pendingForEnrichment(limit);
  const out = { sites: 0, tokens: 0, liveUsd: 0, batchUsd: 0 };
  let i = 0;
  const worker = async () => {
    while (i < queue.length) {
      const op = queue[i++];
      try {
        const crawl = await crawlSite(op.website!);
        const pages = selectPages(crawl.pages);
        const t = pages.length ? estimateTokens(buildDoc(op.name, pages)) : 0;
        if (t < 350) {
          console.log(`${op.domain}: nothing readable, skipped`);
          continue;
        }
        out.sites += 1;
        out.tokens += t;
        out.liveUsd += estimateUsd(op.name, pages, false);
        out.batchUsd += estimateUsd(op.name, pages, true);
        console.log(`${op.domain}: ${crawl.pages.length} crawled, ${pages.length} kept, ~${t} tokens, ~$${estimateUsd(op.name, pages, true).toFixed(4)} batch`);
      } catch (e) {
        console.error(op.domain + ": " + (e as Error).message.slice(0, 100));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return out;
}
