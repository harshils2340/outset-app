import Anthropic from "@anthropic-ai/sdk";
import { loadCases, loadExchanges, saveTruth, type AvailCase } from "./availCases.ts";
import type { Exchange } from "../enrich/__tests__/fixtures/replay.ts";

/**
 * Have a model read what the vendor actually sent and say, independently of our reader, what a guest could book.
 *
 * This is the only part of the suite that costs money, so it never runs by itself: the command prints a measured
 * estimate from the real token count and does nothing further without --yes. Everything else in src/eval is free
 * and runs on every test run.
 *
 * Why it is worth paying for at all. The rule checks in availChecks.ts catch answers that are wrong on their
 * face, and the second read catches the two of us disagreeing, but neither can catch a misunderstanding they
 * share with the reader: if we have all along believed `is_bookable` means something it does not, every check
 * passes and every guest is misled. A reader that was given the bytes and not our code is the only cheap way
 * to find that out short of a person opening forty booking pages.
 *
 * What it is given, and what it is deliberately not given. It gets the vendor's own availability documents,
 * whole, with every field the vendor put on each record, so that deciding which flags mean "bookable" is its
 * job and not ours. It is not told what our reader answered, so it cannot agree out of politeness; it is not
 * given the pricing sheets, which are a separate question and a lot of tokens.
 *
 * Everything goes through the Batch API: this is bulk, nothing is waiting on it, and it is half price.
 */

/** Anthropic's published rates, per million tokens. Batch is half of these. */
const PRICING: Record<string, { in: number; out: number }> = {
  "claude-opus-5": { in: 5, out: 25 },
  "claude-sonnet-5": { in: 2, out: 10 },
  "claude-haiku-4-5": { in: 1, out: 5 },
};
export const DEFAULT_JUDGE_MODEL = "claude-opus-5";
const MAX_TOKENS = 8000;

const SYSTEM = [
  "You are auditing a travel booking site's reading of a tour operator's live availability feed.",
  "",
  "You will be given the raw JSON that the operator's booking vendor returned to an anonymous request,",
  "exactly as it arrived. Decide, from that JSON alone, which departures a member of the public could",
  "actually book right now.",
  "",
  "Rules that matter more than they look:",
  "- Report every start time in the operator's OWN local wall clock, exactly as the feed writes it. Do not",
  "  convert to UTC and do not apply the timezone offset. If the feed says 09:00-04:00, the answer is 09:00.",
  "- A departure that is sold out, unlisted, private, cancelled, staff-only or bookable only by telephone is",
  "  not bookable by the public. Decide that from the fields the vendor actually set, not from assumptions.",
  "- A capacity of zero does not always mean full: some operators hide their numbers. Weigh it against the",
  "  vendor's own explicit sold-out and bookable flags.",
  "- Only start times inside the requested window count.",
  "- If the feed is truncated, empty, or you cannot tell, say so in `note` and report what you are sure of.",
  "",
  "Answer only with the structured object requested.",
].join("\n");

const SCHEMA = {
  type: "object" as const,
  properties: {
    live: { type: "boolean" as const, description: "Is anything at all bookable by the public in this window?" },
    starts: {
      type: "array" as const,
      description: "Every bookable start, 'YYYY-MM-DDTHH:MM' in the operator's own local clock. Sorted, no duplicates.",
      items: { type: "string" as const },
    },
    note: { type: "string" as const, description: "Anything a person auditing this should know. Short." },
  },
  required: ["live", "starts", "note"],
  additionalProperties: false,
};

/**
 * The availability-bearing documents from a recording, with the window's dates kept and every field on each
 * record left alone.
 *
 * Trimming is by document and by date, never by field: dropping keys would be us deciding in advance which
 * flags decide bookability, which is the exact judgement this pass exists to check independently. Pricing
 * sheets and the company's item catalog are left out because they answer a different question and are most
 * of the bytes.
 */
export function judgeInput(kase: AvailCase, exchanges: Exchange[]): string {
  const keep = exchanges.filter(
    (e) => e.status >= 200 && e.status < 300 && !e.url.includes("live-index.json") && !e.url.includes("total-sheets") && !e.url.includes("effective-sheets"),
  );
  const parts: string[] = [];
  for (const e of keep) {
    let body = e.body;
    if (body.length > 400_000) body = body.slice(0, 400_000) + '\n/* TRUNCATED: the feed was larger than the audit budget */';
    parts.push(`--- the vendor answered ${e.url}\n${body}`);
  }
  return parts.join("\n\n");
}

function prompt(kase: AvailCase, exchanges: Exchange[]): string {
  const last = new Date(new Date(kase.from + "T00:00:00Z").getTime() + (kase.days - 1) * 86400000).toISOString().slice(0, 10);
  return [
    `Booking vendor: ${kase.vendor}`,
    `Operator: ${kase.domain}`,
    `Window asked about: ${kase.from} to ${last} inclusive (${kase.days} days).`,
    "",
    judgeInput(kase, exchanges),
  ].join("\n");
}

export type JudgePlan = { id: string; custom_id: string; text: string; inputTokens: number };

/** Count what this would really cost before anything is submitted. One cheap token-count call per case. */
export async function plan(client: Anthropic, model: string, cases: AvailCase[]): Promise<JudgePlan[]> {
  const out: JudgePlan[] = [];
  for (const kase of cases) {
    const text = prompt(kase, loadExchanges(kase.id));
    const counted = await client.messages.countTokens({ model, system: SYSTEM, messages: [{ role: "user", content: text }] });
    out.push({ id: kase.id, custom_id: kase.id.replace(/[^A-Za-z0-9_-]/g, "_"), text, inputTokens: counted.input_tokens });
  }
  return out;
}

export function estimate(model: string, plans: JudgePlan[]): { inputTokens: number; usd: number } {
  const price = PRICING[model] || PRICING[DEFAULT_JUDGE_MODEL];
  const inputTokens = plans.reduce((n, p) => n + p.inputTokens, 0);
  // Batch is half price. Output is assumed to run to the cap, so the figure quoted is the worst case.
  const usd = (inputTokens / 1e6) * price.in * 0.5 + ((plans.length * MAX_TOKENS) / 1e6) * price.out * 0.5;
  return { inputTokens, usd };
}

export type JudgeOutcome = { submitted: number; batchId: string };

/** Submit the batch. Only ever reached after the caller has confirmed the estimate. */
export async function submit(client: Anthropic, model: string, plans: JudgePlan[]): Promise<JudgeOutcome> {
  const batch = await client.messages.batches.create({
    requests: plans.map((p) => ({
      custom_id: p.custom_id,
      params: {
        model,
        max_tokens: MAX_TOKENS,
        system: SYSTEM,
        output_config: { format: { type: "json_schema" as const, schema: SCHEMA } },
        messages: [{ role: "user" as const, content: p.text }],
      },
    })) as Parameters<typeof client.messages.batches.create>[0]["requests"],
  });
  return { submitted: plans.length, batchId: batch.id };
}

/**
 * Wait for a submitted batch and write each answer out as that case's truth.json.
 *
 * Results come back in any order and are keyed by custom_id, never by position. A case whose request errored
 * or expired is left without a truth file rather than given a made up one: no answer is better than a wrong
 * authority, since everything downstream measures accuracy against these.
 */
export async function collect(client: Anthropic, model: string, batchId: string, plans: JudgePlan[], onTick?: (s: string) => void): Promise<{ written: number; failed: string[]; usd: number }> {
  const byCustom = new Map(plans.map((p) => [p.custom_id, p.id]));
  for (;;) {
    const b = await client.messages.batches.retrieve(batchId);
    if (b.processing_status === "ended") break;
    onTick?.(`${b.processing_status}: ${b.request_counts.processing} still running, ${b.request_counts.succeeded} done`);
    await new Promise((r) => setTimeout(r, 30_000));
  }
  const price = PRICING[model] || PRICING[DEFAULT_JUDGE_MODEL];
  let inTok = 0;
  let outTok = 0;
  let written = 0;
  const failed: string[] = [];
  for await (const r of await client.messages.batches.results(batchId)) {
    const id = byCustom.get(r.custom_id);
    if (!id) continue;
    if (r.result.type !== "succeeded") {
      failed.push(`${id}: ${r.result.type}`);
      continue;
    }
    inTok += r.result.message.usage.input_tokens;
    outTok += r.result.message.usage.output_tokens;
    const text = r.result.message.content.find((c) => c.type === "text");
    if (!text || text.type !== "text") {
      failed.push(`${id}: no text block`);
      continue;
    }
    let parsed: { live?: boolean; starts?: unknown; note?: string };
    try {
      parsed = JSON.parse(text.text) as typeof parsed;
    } catch {
      failed.push(`${id}: answer was not the requested object`);
      continue;
    }
    const starts = Array.isArray(parsed.starts) ? parsed.starts.filter((s): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) : [];
    saveTruth(id, {
      source: "ai",
      decidedAt: new Date().toISOString(),
      model,
      live: !!parsed.live,
      starts: [...new Set(starts)].sort(),
      note: String(parsed.note || "").slice(0, 600),
    });
    written += 1;
  }
  const usd = (inTok / 1e6) * price.in * 0.5 + (outTok / 1e6) * price.out * 0.5;
  return { written, failed, usd };
}

export function judgeableCases(only?: string): AvailCase[] {
  return loadCases().filter((c) => !only || c.id.includes(only));
}
