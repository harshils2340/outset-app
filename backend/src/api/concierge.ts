import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { rateLimit } from "./auth.ts";
import { isAdminRequest } from "./metrics.ts";
import { plan, type Answer } from "../concierge/plan.ts";
import { liveFor } from "../concierge/live.ts";
import { getSession, recordTurn, allSessions, Trace } from "../concierge/session.ts";
import { SESSIONS_PAGE } from "./sessionsPage.ts";

/**
 * Where the real agent lives. `SITE_URL` is the same variable every other mailed link in the backend already
 * points at the deployed site with (`claims.ts`, `bookings.ts`, `wallet.ts`...), so a laptop pointed at a dev
 * server by setting it once gets that everywhere, `/go` included, rather than needing a variable of its own.
 */
const SITE = (process.env.SITE_URL || "https://onoutset.com/").replace(/\/?$/, "/");

/**
 * The concierge: a sentence in, bookable options out.
 *
 * Kept apart from the booking routes on purpose. These answer questions about businesses that have never heard
 * of Outset, by reading their own booking systems, so nothing here writes to our database or takes anyone's
 * money. The only side effect is a few requests to a shop's booking provider.
 */
export const concierge = new Hono();

/**
 * Who may watch the agent work.
 *
 * The two doors the rest of the internal tooling has, plus the laptop door the blanket gate in routes.ts
 * carries: `OUTSET_LOCAL_ADMIN=1` on a host with no `ADMIN_KEY`. That is the machine this window is actually
 * used on. `concierge` is mounted above that blanket gate, because the routes below it answer a stranger's
 * browser by design, so these two have to say it themselves.
 */
function mayWatch(c: Context): boolean {
  if (process.env.OUTSET_LOCAL_ADMIN === "1" && !(process.env.ADMIN_KEY || "").trim()) return true;
  return isAdminRequest(c);
}

/**
 * `/go` used to serve its own hand-rolled copy of the concierge: a second implementation of the same screen,
 * written once and then never touched again while the real one, the overlay `WebConcierge.tsx` opens on the
 * site, kept moving. It drifted on every axis that matters: stale opening copy, and options rendered one row
 * per departure instead of grouped by shop, so the same two businesses printed four times over. There is one
 * agent UI now, and this is a door to it rather than a second one.
 */
concierge.get("/go", (c) => c.redirect(SITE + "#ask="));

/** Every conversation the agent has had since this process started, step by step. Internal: see below. */
concierge.get("/sessions", rateLimit(120, 60 * 60 * 1000), (c) => {
  if (!mayWatch(c)) return c.json({ error: "not found" }, 404);
  return c.html(SESSIONS_PAGE);
});

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

type Ask = { text?: string; ask?: number; session?: string; lat?: number; lon?: number };

function read(body: Ask): { text: string; ask: number; session: string; near: { lat: number; lon: number } | null } | { error: string } {
  const text = (body.text || "").trim();
  if (!text) return { error: "Say what you want to do." };
  if (text.length > 300) return { error: "That is a lot to ask for. Try a shorter sentence." };
  /**
   * Where the browser says they are, when it is willing to say. Optional on purpose: a guest who refuses the
   * permission still gets a perfectly good answer by naming a town, and this only ever narrows.
   *
   * Validated rather than trusted. A malformed pair would be fed straight into the distance arithmetic and
   * quietly return businesses on the far side of the planet.
   */
  const lat = Number(body.lat);
  const lon = Number(body.lon);
  const near =
    Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat !== 0 || lon !== 0)
      ? { lat, lon }
      : null;
  return { text, ask: Math.min(Number(body.ask) || 3, 5), session: String(body.session || ""), near };
}

/**
 * Counted, like every other public route here, and for a harder reason than most: one question fans out into a
 * handful of requests to somebody else's booking provider, so an uncounted route lets a stranger point our
 * server at FareHarbor. Sixty questions an hour is more than anyone types.
 */
concierge.post("/concierge/ask", rateLimit(60, 60 * 60 * 1000), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Ask;
  const r = read(body);
  if ("error" in r) return c.json({ error: r.error }, 400);
  const session = getSession(r.session);
  const trace = new Trace();
  const a = await plan(r.text, { ask: r.ask, prior: session.intent, trace, near: r.near });
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
  const body = (await c.req.json().catch(() => ({}))) as Ask;
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
    const work = plan(r.text, { ask: r.ask, prior: session.intent, trace, near: r.near }).then(
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

/**
 * Every conversation this process has served, as JSON, for the window that watches.
 *
 * Behind the admin gate, which it was not. `concierge` is mounted above the blanket x-admin-key middleware,
 * because the routes above hold a guest's question and have to answer a stranger's browser, and these two came
 * up alongside them: unauthenticated, uncounted, and handing anyone who asked the last forty guests' sentences.
 * On the site the sentence has the guest's own town appended to it by `withPlace`, so that is other people's
 * questions and roughly where each of them was sitting. It also printed every live session id, and
 * `getSession` adopts any id a caller sends, so a stranger could carry on somebody else's conversation.
 *
 * `isAdminRequest` rather than the middleware below for the same reason the metrics page uses it: a browser
 * signs in with an emailed code and has no key to send, and 404 is what the rest of the internal tooling
 * answers anyone else.
 */
concierge.get("/concierge/sessions", rateLimit(120, 60 * 60 * 1000), (c) => {
  if (!mayWatch(c)) return c.json({ error: "not found" }, 404);
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
