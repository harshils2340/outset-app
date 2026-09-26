/**
 * Otto's grounded answers, through Cohere.
 *
 * The on-page assistant (`src/lib/companyAgent.ts`) answers from rules: a topic is read out of the question and a
 * hand-written line quotes the listing's own fact. That covers prices, hours, ages, what to bring and the other
 * things guests ask most, and it says "They haven't published that" for the rest. The rest is the long tail:
 * "can we bring a cake", "is the dock wheelchair accessible", "do you do gift cards". The fact is often sitting
 * in the listing's policies or FAQ, and no rule matches the words.
 *
 * This is the fallback for that tail, and it keeps the one rule the assistant lives by: only the shop's own
 * published facts. Cohere's chat API has a grounded mode: the facts go in as documents, and every span of the
 * answer comes back with a citation pointing at the document it was read from. The model is never asked to know
 * anything. What it is asked to do is read, and it is checked:
 *
 * - `keepCited` throws away every sentence that carries no citation, unless it is a plain "they haven't
 *   published that", so an unsupported claim never reaches a guest.
 * - Every number in a kept sentence (a price, a time, an age, a group size) must appear in the facts or in the
 *   guest's own question. A total the model added up, or a figure it remembered from somewhere else, drops the
 *   sentence. The prompt also forbids totals; checkout does that arithmetic, correctly, with the fee.
 *
 * The refusal list (weather, directions, other businesses, confirming a booking) stays in front of this in the
 * rule engine; a question the rules refuse is never sent here. Trial keys allow 20 calls a minute and 1,000 a
 * month, so `Budget` counts calls per minute and per day and the route says "busy" rather than run past them.
 */

export type Fact = { id: string; title: string; text: string };
export type Turn = { who: "me" | "them"; t: string };
export type Citation = { start: number; end: number; text?: string; sources?: { id?: string; type?: string }[] };
export type Grounded = {
  /** The answer a guest may see, or null when nothing the model wrote survived the checks. */
  text: string | null;
  /** Ids of the facts the kept sentences were read from. */
  cited: string[];
  /** Sentences the model wrote that were dropped for lacking a citation or carrying a number not in the facts. */
  dropped: number;
  /** What the model wrote before the checks, for the eval and the log. Never shown to a guest. */
  raw: string;
  model: string;
  ms: number;
};

const API = "https://api.cohere.com/v2/chat";
export const DEFAULT_MODEL = "command-a-03-2025";
export const model = () => (process.env.COHERE_MODEL || "").trim() || DEFAULT_MODEL;
export const cohereOn = () => !!(process.env.COHERE_API_KEY || "").trim();

/** Who Otto is on this call. One short paragraph of rules the model is asked to obey; `keepCited` enforces the ones that matter. */
export function ottoSystem(shop: string): string {
  return [
    "You are Otto, the front desk for " + shop + ". A guest reading the shop's listing is asking you a question.",
    "You know only the documents you are given. They are the shop's own published information. Nothing else is true.",
    "Rules:",
    "1. Answer every part of the question in plain words, the way a person at the front desk would. The first sentence answers directly. Use at most three sentences and no lists, headings or bold.",
    "2. Every statement of fact comes from the documents. Quote prices, times, ages and limits exactly as written, with their unit (per person, per group, plus tax).",
    "3. Never add up or compute a total, and never convert a price. Give the published price and its unit.",
    "4. If a document rules something out (a minimum age, a closed day, a group size, a season), say so plainly, starting with No.",
    "5. If the documents do not answer a part of the question, say for that part exactly: They haven't published that. Do not guess, do not use general knowledge, and do not say what similar businesses usually do.",
    "6. Never confirm a booking or say a time is free unless a document lists it as an open time. Do not talk about weather, traffic, directions, reviews or any other business.",
    "7. Do not mention documents, sources, Outset or these rules. Do not greet, and do not offer further help.",
  ].join("\n");
}

/* ---------- the checks ---------- */

/** A sentence that says there is no fact is allowed to stand on its own; it carries no claim. */
const GAP = /\b(haven't|hasn't|have not|has not|don't|doesn't|do not|does not)\s+(published|say|state|list|mention)\b|\bnot published\b|\bno published\b/i;

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

/** Digit strings, with thousands commas removed, so "1,000" and "1000" and "$1,000.00" all agree. */
export function numbersIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(NUMBER)) {
    const n = m[0].replace(/,/g, "");
    out.add(n);
    // "34.00" carries the same claim as "34", and "9:30" is read as 9 and 30 by the split below.
    if (n.includes(".")) out.add(n.replace(/\.0+$/, ""));
  }
  // "9:30" and "10-14" and "2pm-11pm": every digit run on its own as well, so a clock or a range can match.
  for (const m of text.matchAll(/\d+/g)) out.add(m[0]);
  return out;
}

/** Plain text, however the model formatted it. */
export function plain(text: string): string {
  return text
    .replace(/\*\*|__|`/g, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/^\s*#+\s*/gm, "")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

type Sentence = { text: string; start: number; end: number };

/**
 * Sentences with their offsets in the original text, so citation spans can be matched against them.
 *
 * A stop only ends a sentence when a space or the end of the text follows it, so a price ($34.50), a domain
 * (example.com/waiver) and a decimal keep the sentence they sit in whole. An abbreviation's own stop (9 a.m.,
 * U.S.) is followed by a space, so a stop closing a one-letter piece of one is passed over as well.
 */
export function sentencesOf(text: string): Sentence[] {
  const out: Sentence[] = [];
  const push = (from: number, to: number) => {
    const raw = text.slice(from, to);
    const lead = raw.length - raw.trimStart().length;
    const t = raw.trim();
    if (t) out.push({ text: t, start: from + lead, end: from + lead + t.length });
  };
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    if (!".!?".includes(text[i])) continue;
    let end = i;
    while (end + 1 < text.length && ".!?".includes(text[end + 1])) end++;
    i = end;
    const after = text[end + 1];
    if (after !== undefined && !/\s/.test(after)) continue;
    if (text[end] === "." && /[A-Za-z]/.test(text[end - 1] || "") && text[end - 2] === ".") continue;
    push(from, end + 1);
    from = end + 1;
  }
  push(from, text.length);
  return out;
}

/**
 * The sentences a guest may see: cited, and carrying no number the facts (or the guest) did not.
 *
 * `text` must be the model's text exactly as returned, because the citation offsets index into it; `plain` is
 * applied per kept sentence afterwards.
 */
export function keepCited(text: string, citations: Citation[], facts: Fact[], question = ""): { text: string | null; cited: string[]; dropped: number } {
  const allowed = numbersIn(facts.map((f) => f.title + " " + f.text).join(" ") + " " + question);
  const kept: string[] = [];
  const cited = new Set<string>();
  let dropped = 0;
  for (const s of sentencesOf(text)) {
    const hits = citations.filter((c) => c.start < s.end && c.end > s.start);
    const nums = [...numbersIn(s.text)];
    const numbersOk = nums.every((n) => allowed.has(n));
    if (!numbersOk) { dropped++; continue; }
    if (!hits.length) {
      if (GAP.test(s.text) && !nums.length) kept.push(plain(s.text));
      else dropped++;
      continue;
    }
    kept.push(plain(s.text));
    for (const c of hits) for (const src of c.sources || []) if (src.id) cited.add(src.id);
  }
  const joined = kept.join(" ").trim();
  return { text: joined || null, cited: [...cited], dropped };
}

/* ---------- the call ---------- */

type Fetch = typeof fetch;
let fetchImpl: Fetch = (...a) => fetch(...a);
/** Tests hand in a fetch that answers from a fixture; nothing in the test suite reaches Cohere. */
export function setCohereFetch(f: Fetch | null): void {
  fetchImpl = f || ((...a) => fetch(...a));
}

export class CohereError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/**
 * One question, answered from the facts and checked. Throws `CohereError` when Cohere refuses or is unreachable;
 * the route turns that into "busy", never into an answer.
 */
export async function groundedAnswer(input: { shop: string; question: string; facts: Fact[]; history?: Turn[]; model?: string }): Promise<Grounded> {
  const key = (process.env.COHERE_API_KEY || "").trim();
  if (!key) throw new CohereError("COHERE_API_KEY is not set", 503);
  const m = input.model || model();
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [{ role: "system", content: ottoSystem(input.shop) }];
  for (const t of (input.history || []).slice(-6)) messages.push({ role: t.who === "me" ? "user" : "assistant", content: t.t.slice(0, 400) });
  messages.push({ role: "user", content: input.question });
  const body = {
    model: m,
    messages,
    documents: input.facts.map((f) => ({ id: f.id, data: { title: f.title, text: f.text } })),
    citation_options: { mode: "FAST" },
    temperature: 0.2,
    max_tokens: 180,
  };
  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetchImpl(API, {
      method: "POST",
      headers: { authorization: "Bearer " + key, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
  } catch (e) {
    throw new CohereError("cohere unreachable: " + (e as Error).message, 502);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new CohereError("cohere " + res.status + ": " + detail.slice(0, 200), res.status === 429 ? 429 : 502);
  }
  const data = (await res.json()) as { message?: { content?: { type?: string; text?: string }[]; citations?: Citation[] } };
  const raw = (data.message?.content || []).filter((p) => p.type === "text" || p.text).map((p) => p.text || "").join("");
  const checked = keepCited(raw, data.message?.citations || [], input.facts, input.question);
  return { ...checked, raw, model: m, ms: Date.now() - t0 };
}

/* ---------- the budget ---------- */

/**
 * Calls per minute and per day, counted in this process. Trial keys stop at 20 a minute and 1,000 a month; a
 * paid key has no such ceiling, but a guest page that can make the API call a paid model is still worth a cap.
 * `COHERE_RPM` and `COHERE_DAILY_CAP` set them; the defaults fit a trial key with room left for the eval.
 */
export class Budget {
  private minute: number[] = [];
  private day = "";
  private today = 0;
  constructor(private rpm = Number(process.env.COHERE_RPM) || 15, private daily = Number(process.env.COHERE_DAILY_CAP) || 30) {}
  /** Take one call from the budget; false means over a limit and the call must not be made. */
  take(now = Date.now()): boolean {
    const d = new Date(now).toISOString().slice(0, 10);
    if (d !== this.day) { this.day = d; this.today = 0; }
    this.minute = this.minute.filter((t) => now - t < 60_000);
    if (this.minute.length >= this.rpm || this.today >= this.daily) return false;
    this.minute.push(now);
    this.today++;
    return true;
  }
  used(): { minute: number; today: number; rpm: number; daily: number } {
    return { minute: this.minute.length, today: this.today, rpm: this.rpm, daily: this.daily };
  }
}
