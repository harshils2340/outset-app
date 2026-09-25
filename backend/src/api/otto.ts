import { createHash } from "node:crypto";
import { Hono } from "hono";
import { rateLimit } from "./auth.ts";
import { Budget, CohereError, cohereOn, groundedAnswer, type Fact, type Turn } from "../lib/cohere.ts";

/**
 * `POST /otto/ask`: the grounded fallback behind the on-page assistant.
 *
 * The page sends the facts it is already showing the guest (`companyFacts` in `src/lib/companyAgent.ts`), the
 * question, and the last few turns. The facts come from the page rather than from a catalog read here so the
 * answer is grounded in exactly what the guest can see, operator edits included, and so this host, which serves
 * Postgres and the static catalog, needs no operators table. A caller can only send facts into their own answer,
 * so the shape is validated and sized and nothing is stored.
 *
 * Public, like the availability and concierge routes, and dearer than they are: one call to a paid model. So it
 * is counted per caller, counted per minute and per day for the whole process (`Budget`), and cached, because
 * the same question on the same listing with the same facts has the same answer. Every failure path answers
 * `text: null`, and the page then keeps the rule engine's own line, so a guest never sees this route fail.
 */
export const otto = new Hono();

const MAX_FACTS = 40;
const MAX_FACT_CHARS = 1500;
const MAX_TOTAL_CHARS = 24_000;
const MAX_QUESTION = 300;
const MAX_HISTORY = 6;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 500;

const budget = new Budget();
const cache = new Map<string, { at: number; body: unknown }>();

/** For tests: the budget is per process, and a test that spends it would starve the next one. */
export function resetOttoForTests(): void {
  cache.clear();
  Object.assign(budget, new Budget());
}

type Body = { id: string; shop: string; question: string; facts: Fact[]; history: Turn[] };

function readBody(raw: unknown): Body | string {
  if (!raw || typeof raw !== "object") return "body must be JSON";
  const b = raw as Record<string, unknown>;
  const id = typeof b.id === "string" ? b.id.trim().slice(0, 120) : "";
  const shop = typeof b.shop === "string" ? b.shop.trim().slice(0, 120) : "";
  const question = typeof b.question === "string" ? b.question.trim() : "";
  if (!id || !shop) return "id and shop are required";
  if (!question) return "question is required";
  if (question.length > MAX_QUESTION) return "question is too long";
  if (!Array.isArray(b.facts) || !b.facts.length) return "facts are required";
  if (b.facts.length > MAX_FACTS) return "too many facts";
  const facts: Fact[] = [];
  let total = 0;
  for (const f of b.facts as unknown[]) {
    if (!f || typeof f !== "object") return "a fact must be an object";
    const { id: fid, title, text } = f as Record<string, unknown>;
    if (typeof fid !== "string" || typeof title !== "string" || typeof text !== "string") return "a fact needs id, title and text";
    if (text.length > MAX_FACT_CHARS) return "a fact is too long";
    total += text.length;
    facts.push({ id: fid.slice(0, 40), title: title.slice(0, 80), text });
  }
  if (total > MAX_TOTAL_CHARS) return "facts are too long";
  const history: Turn[] = [];
  if (b.history !== undefined) {
    if (!Array.isArray(b.history) || b.history.length > MAX_HISTORY) return "history is too long";
    for (const t of b.history as unknown[]) {
      const { who, t: text } = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
      if ((who !== "me" && who !== "them") || typeof text !== "string") return "a turn needs who and t";
      history.push({ who, t: text.slice(0, 400) });
    }
  }
  return { id, shop, question, facts, history };
}

function cacheKey(b: Body): string {
  const h = createHash("sha1");
  h.update(b.id + "\n" + b.question.toLowerCase().replace(/\s+/g, " ") + "\n");
  for (const f of b.facts) h.update(f.id + "|" + f.text + "\n");
  return h.digest("hex");
}

otto.post("/otto/ask", rateLimit(20, 60_000), async (c) => {
  if (!cohereOn()) return c.json({ text: null, reason: "off" }, 503);
  const body = readBody(await c.req.json().catch(() => null));
  if (typeof body === "string") return c.json({ error: body }, 400);
  const key = cacheKey(body);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return c.json(hit.body);
  if (!budget.take()) return c.json({ text: null, reason: "cap" }, 429);
  try {
    const g = await groundedAnswer({ shop: body.shop, question: body.question, facts: body.facts, history: body.history });
    const out = { text: g.text, cited: g.cited, dropped: g.dropped, model: g.model, ms: g.ms };
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: Date.now(), body: out });
    console.log("[otto] " + body.id + " " + g.ms + "ms kept=" + (g.text ? "yes" : "no") + " dropped=" + g.dropped + " " + JSON.stringify(body.question.slice(0, 80)));
    return c.json(out);
  } catch (e) {
    const status = e instanceof CohereError ? e.status : 502;
    console.error("[otto] " + body.id + " failed: " + (e as Error).message);
    return c.json({ text: null, reason: status === 429 ? "cap" : "upstream" }, status === 429 ? 429 : 502);
  }
});

