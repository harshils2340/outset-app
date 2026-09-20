import { Hono } from "hono";
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

concierge.post("/concierge/ask", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { text?: string; ask?: number };
  const text = (body.text || "").trim();
  if (!text) return c.json({ error: "Say what you want to do." }, 400);
  if (text.length > 300) return c.json({ error: "That is a lot to ask for. Try a shorter sentence." }, 400);
  const t0 = Date.now();
  const { intent, options } = await plan(text, { ask: Math.min(Number(body.ask) || 3, 5) });
  // Only the ones we can actually quote a time for lead; the rest are still returned, with the route that
  // would fulfil them, because "we would have to phone them" is a real answer and worth showing.
  const withTimes = options.filter((o) => o.departures.length);
  // Then the ones we can at least price from their own published menu, then the rest.
  const withPrices = options.filter((o) => !o.departures.length && o.services.some((s) => s.price != null));
  const rest = options.filter((o) => !o.departures.length && !o.services.some((s) => s.price != null));
  return c.json({
    intent,
    ms: Date.now() - t0,
    options: [...withTimes, ...withPrices, ...rest].slice(0, 6),
    counts: { quoted: withTimes.length, priced: withPrices.length, total: options.length },
  });
});

/** Live availability for one business, by domain, for when a guest is already looking at one. */
concierge.get("/concierge/live/:domain", async (c) => {
  const days = Math.min(Number(c.req.query("days")) || 7, 30);
  const r = await liveFor(c.req.param("domain"), { days });
  return c.json(r);
});
