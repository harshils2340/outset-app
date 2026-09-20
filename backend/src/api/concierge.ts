import { Hono } from "hono";
import { rateLimit } from "./auth.ts";
import { plan } from "../concierge/plan.ts";
import { liveFor } from "../concierge/live.ts";
import { CONCIERGE_PAGE } from "./conciergePage.ts";

/**
 * The concierge: a sentence in, bookable options out.
 *
 * Kept apart from the booking routes on purpose. These answer questions about businesses that have never heard
 * of Outset, by reading their own booking systems, so nothing here writes to our database or takes anyone's
 * money. The only side effect is a few requests to a shop's booking provider.
 */
export const concierge = new Hono();

/** The page itself. A thread on a phone; the same page on a wide screen also shows what the agent is doing. */
concierge.get("/go", (c) => c.html(CONCIERGE_PAGE));

/**
 * Counted, like every other public route here, and for a harder reason than most: one question fans out into a
 * handful of requests to somebody else's booking provider, so an uncounted route lets a stranger point our
 * server at FareHarbor. Sixty questions an hour is more than anyone types.
 */
concierge.post("/concierge/ask", rateLimit(60, 60 * 60 * 1000), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { text?: string; ask?: number };
  const text = (body.text || "").trim();
  if (!text) return c.json({ error: "Say what you want to do." }, 400);
  if (text.length > 300) return c.json({ error: "That is a lot to ask for. Try a shorter sentence." }, 400);
  const t0 = Date.now();
  // A negative or absurd count is not a smaller search: Array.slice reads it from the end.
  const ask = Math.max(1, Math.min(Math.floor(Number(body.ask)) || 3, 5));
  const a = await plan(text, { ask });

  // A question back is a complete answer; there is nothing to rank.
  if (a.followUp) return c.json({ intent: a.intent, ms: Date.now() - t0, followUp: a.followUp, options: [], counts: { quoted: 0, priced: 0, total: 0 } });

  const withTimes = a.options.filter((o) => o.departures.length);
  // Then the ones we can at least price from their own published menu, then the rest.
  const withPrices = a.options.filter((o) => !o.departures.length && o.services.some((s) => s.price != null));
  const rest = a.options.filter((o) => !o.departures.length && !o.services.some((s) => s.price != null));
  return c.json({
    intent: a.intent,
    ms: Date.now() - t0,
    followUp: null,
    loosened: a.loosened,
    compare: a.compare,
    options: [...withTimes, ...withPrices, ...rest].slice(0, 6),
    counts: { quoted: withTimes.length, priced: withPrices.length, total: a.options.length },
  });
});

/** Live availability for one business, by domain, for when a guest is already looking at one. */
concierge.get("/concierge/live/:domain", rateLimit(120, 60 * 60 * 1000), async (c) => {
  const days = Math.max(1, Math.min(Math.floor(Number(c.req.query("days"))) || 7, 30));
  const r = await liveFor(c.req.param("domain") || "", { days });
  return c.json(r);
});
