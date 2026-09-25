import { API_URL, apiConfig, hasApi } from "./api";
import { companyFacts, type CompanyContext } from "./companyAgent";

/**
 * The grounded fallback behind Otto's rules.
 *
 * `companyAnswer` marks an answer `gap` when it had no fact for the question ("They haven't published that").
 * This sends the same question, with the listing's published facts as documents, to `POST /otto/ask`, where a
 * model reads them in grounded mode and only cited sentences come back (backend/src/lib/cohere.ts). It answers
 * null whenever there is nothing better than the rules' own line: no API, the key not set, the budget spent, a
 * slow upstream, or an answer that cited nothing. The caller keeps the rules' line in every one of those cases,
 * so this can only improve an answer, never replace a fact with a guess.
 */

export type Turn = { who: "me" | "them"; t: string };

export async function askOttoModel(ctx: CompanyContext, question: string, history: Turn[] = []): Promise<string | null> {
  if (!hasApi()) return null;
  const cfg = await apiConfig().catch(() => null);
  if (!cfg?.otto) return null;
  const facts = companyFacts(ctx);
  if (!facts.length) return null;
  try {
    const r = await fetch(API_URL + "/otto/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: ctx.item.id, shop: ctx.item.title, question, facts, history: history.slice(-6) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { text?: string | null; cited?: string[] };
    // A reply that cites nothing is the model saying it found no fact either; the rules' line says that better.
    if (!data.text || !data.cited?.length) return null;
    return data.text;
  } catch {
    return null;
  }
}
