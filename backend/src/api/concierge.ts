import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { rateLimit } from "./auth.ts";
import { plan, type Answer } from "../concierge/plan.ts";
import { liveFor } from "../concierge/live.ts";
import { getSession, recordTurn, allSessions, Trace } from "../concierge/session.ts";
import { CONCIERGE_PAGE } from "./conciergePage.ts";
import { SESSIONS_PAGE } from "./sessionsPage.ts";

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

/** Every conversation the agent has had since this process started, step by step. */
concierge.get("/sessions", (c) => c.html(SESSIONS_PAGE));

/** Shapes an answer for the page. Shared by the plain route and the streaming one so they cannot drift. */
function payload(a: Answer, ms: number, sessionId: string) {
  const base = { session: sessionId, intent: a.intent, ms, assumptions: a.assumptions, narrow: a.narrow };
  // A question back is a complete answer; there is nothing to rank.
  if (a.followUp) return { ...base, followUp: a.followUp, options: [], counts: { quoted: 0, priced: 0, total: 0 } };

  const withTimes = a.options.filter((o) => o.departures.length);
  // Then the ones we can at least price from their own published menu, then the rest.
  const withPrices = a.options.filter((o) => !o.departures.length && o.services.some((s) => s.price != null));
  const rest = a.options.filter((o) => !o.departures.length && !o.services.some((s) => s.price != null));
  return {
    ...base,
    followUp: null,
    loosened: a.loosened,
    compare: a.compare,
    options: [...withTimes, ...withPrices, ...rest].slice(0, 6),
    counts: { quoted: withTimes.length, priced: withPrices.length, total: a.options.length },
  };
}

/** One line for the replay list: what the guest was actually told. */
function outcomeOf(a: Answer): string {
  if (a.followUp) return "asked: " + a.followUp.question;
  const quoted = a.options.filter((o) => o.departures.length).length;
  if (quoted) return quoted + " with live times";
  const priced = a.options.filter((o) => o.services.some((s) => s.price != null)).length;
  if (priced) return priced + " priced from their own sites";
  return a.options.length ? a.options.length + " found, nothing published" : "nothing found";
}

function read(body: { text?: string; ask?: number; session?: string }): { text: string; ask: number; session: string } | { error: string } {
  const text = (body.text || "").trim();
  if (!text) return { error: "Say what you want to do." };
  if (text.length > 300) return { error: "That is a lot to ask for. Try a shorter sentence." };
  return { text, ask: Math.min(Number(body.ask) || 3, 5), session: String(body.session || "") };
}

/**
 * Counted, like every other public route here, and for a harder reason than most: one question fans out into a
 * handful of requests to somebody else's booking provider, so an uncounted route lets a stranger point our
 * server at FareHarbor. Sixty questions an hour is more than anyone types.
 */
concierge.post("/concierge/ask", rateLimit(60, 60 * 60 * 1000), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { text?: string; ask?: number; session?: string };
  const r = read(body);
  if ("error" in r) return c.json({ error: r.error }, 400);
  const session = getSession(r.session);
  const trace = new Trace();
  const a = await plan(r.text, { ask: r.ask, prior: session.intent, trace });
  session.intent = a.intent;
  recordTurn(session, r.text, trace, outcomeOf(a));
  return c.json({ ...payload(a, Date.now() - trace.t0, session.id), steps: trace.steps });
});

/**
 * The same answer, but the steps arrive while they are happening.
 *
 * The panel that shows what the agent is doing used to be drawn by the browser from the finished answer, so it
 * could only ever be a tidy retelling: every step appeared at once, after the wait was over, in an order
 * somebody chose. Watching it work is the whole point — three shops' booking systems being read at the same
 * time, one of them slow, one of them empty — and none of that survives being summarised afterwards.
 *
 * Server-sent events rather than a socket: one direction, plain HTTP, no library on either end, and it
 * reconnects by itself.
 */
concierge.post("/concierge/stream", rateLimit(60, 60 * 60 * 1000), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { text?: string; ask?: number; session?: string };
  const r = read(body);
  if ("error" in r) return c.json({ error: r.error }, 400);
  const session = getSession(r.session);

  return streamSSE(c, async (stream) => {
    const queue: string[] = [];
    let flush: (() => void) | null = null;
    const trace = new Trace((s) => {
      queue.push(JSON.stringify(s));
      flush?.();
    });

    // The plan runs while the steps drain, so a step reaches the screen at the moment it happens.
    const work = plan(r.text, { ask: r.ask, prior: session.intent, trace }).then(
      (a) => ({ ok: true as const, a }),
      (e) => ({ ok: false as const, e }),
    );
    type Settled = { ok: true; a: Answer } | { ok: false; e: unknown };
    let done: Settled | null = null;
    // Read through a call, not the variable: it is only ever assigned from a callback, so reading it directly
    // lets the compiler decide it is forever null and the branches below have nothing to narrow.
    const settled = () => done;
    work.then((v) => {
      done = v;
      flush?.();
    });

    for (;;) {
      while (queue.length) await stream.writeSSE({ event: "step", data: queue.shift()! });
      if (settled()) break;
      await new Promise<void>((res) => {
        flush = res;
        // A tick of its own, so a plan that finishes with an empty queue is never waited on forever.
        setTimeout(res, 60);
      });
      flush = null;
    }

    const result = settled()!;
    if (!result.ok) {
      console.error("concierge stream failed:", result.e);
      await stream.writeSSE({ event: "failed", data: JSON.stringify({ error: "Something broke reaching the shops." }) });
      return;
    }
    const a = result.a;
    session.intent = a.intent;
    recordTurn(session, r.text, trace, outcomeOf(a));
    await stream.writeSSE({ event: "answer", data: JSON.stringify(payload(a, Date.now() - trace.t0, session.id)) });
  });
});

/** Start again: the guest changed their mind rather than refined it. */
concierge.post("/concierge/reset", rateLimit(120, 60 * 60 * 1000), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { session?: string };
  const s = getSession(body.session);
  s.intent = null;
  return c.json({ session: s.id, ok: true });
});

/** Every conversation this process has served, as JSON, for the window that watches. */
concierge.get("/concierge/sessions", (c) => {
  return c.json({
    sessions: allSessions().slice(0, 40).map((s) => ({
      id: s.id, at: s.at, lastAt: s.lastAt,
      intent: s.intent ? { categoryLabel: s.intent.categoryLabel, city: s.intent.city, region: s.intent.region, party: s.intent.party, when: s.intent.when } : null,
      turns: s.turns,
    })),
  });
});

/** Live availability for one business, by domain, for when a guest is already looking at one. */
concierge.get("/concierge/live/:domain", rateLimit(120, 60 * 60 * 1000), async (c) => {
  const days = Math.max(1, Math.min(Math.floor(Number(c.req.query("days"))) || 7, 30));
  const r = await liveFor(c.req.param("domain") || "", { days });
  return c.json(r);
});
