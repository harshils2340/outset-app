import type { Intent } from "./plan.ts";

/**
 * A conversation, and a record of what the agent did inside it.
 *
 * Two things were missing and they are the same thing. The agent could ask a question — "where are you?" — and
 * then had nowhere to put the answer: the next sentence arrived as a fresh request, so a guest who replied
 * "waterloo" got every activity in Waterloo instead of the escape room they had asked for one line earlier.
 * And the panel showing what the agent was doing was drawn by the browser after the answer came back, from the
 * answer, so it could only ever show a tidy retelling of a request that had already finished.
 *
 * So a session holds the intent as it accumulates across turns, and every step the planner took while it was
 * working, timestamped as it happened. The first makes the agent conversational. The second makes it
 * inspectable, which for something that reaches into a dozen strangers' booking systems is not a demo trick:
 * it is how you find out which shop was slow, which one answered nothing, and why a price looks wrong.
 */

export type Step = {
  /** Milliseconds since this turn began. Real elapsed time, not a replay. */
  ms: number;
  /** A short machine word: `read`, `catalog`, `ask`, `answer`, `loosen`, `assume`, `question`, `done`. */
  kind: string;
  text: string;
  /** The business this step is about, when it is about one. */
  who?: string;
  /** Dimmed detail: the URL fetched, the count, the reason. */
  detail?: string;
};

export type Turn = {
  id: string;
  at: number;
  text: string;
  steps: Step[];
  /** What the guest ended up being told, in one line, so a replay reads like a transcript. */
  outcome: string | null;
  ms: number;
};

export type Session = {
  id: string;
  at: number;
  lastAt: number;
  /** Everything learned so far. A follow-up answer is merged into this rather than replacing it. */
  intent: Intent | null;
  turns: Turn[];
};

/**
 * In memory on purpose. A concierge session is worth nothing an hour after it ends, the demo machine is one
 * process, and the alternative is a table to migrate on the morning of a deadline. If this ever runs on more
 * than one instance it becomes a Redis key with the same shape.
 */
const SESSIONS = new Map<string, Session>();
const TTL_MS = 2 * 60 * 60 * 1000;
const MAX_SESSIONS = 500;

function sweep() {
  const cut = Date.now() - TTL_MS;
  for (const [id, s] of SESSIONS) if (s.lastAt < cut) SESSIONS.delete(id);
  // A demo laptop with a QR code on a screen can collect sessions faster than the TTL clears them.
  while (SESSIONS.size > MAX_SESSIONS) {
    const oldest = [...SESSIONS.values()].reduce((a, b) => (a.lastAt <= b.lastAt ? a : b));
    SESSIONS.delete(oldest.id);
  }
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function getSession(id: string | undefined | null): Session {
  sweep();
  const existing = id ? SESSIONS.get(id) : undefined;
  if (existing) {
    existing.lastAt = Date.now();
    return existing;
  }
  const s: Session = { id: id && /^[a-z0-9]{4,24}$/.test(id) ? id : newId(), at: Date.now(), lastAt: Date.now(), intent: null, turns: [] };
  SESSIONS.set(s.id, s);
  return s;
}

/** Every session still in memory, newest first, for the window that watches the agent work. */
export function allSessions(): Session[] {
  sweep();
  return [...SESSIONS.values()].sort((a, b) => b.lastAt - a.lastAt);
}

/** Collects the steps of one turn and hands them out as they happen. */
export class Trace {
  readonly t0 = Date.now();
  readonly steps: Step[] = [];
  constructor(private readonly sink?: (s: Step) => void) {}
  step(kind: string, text: string, extra: { who?: string; detail?: string } = {}) {
    const s: Step = { ms: Date.now() - this.t0, kind, text, ...extra };
    this.steps.push(s);
    // A sink that throws must not take the answer down with it: the guest's result matters, the panel does not.
    try {
      this.sink?.(s);
    } catch {
      /* the watcher went away */
    }
  }
}

export function recordTurn(session: Session, text: string, trace: Trace, outcome: string | null): Turn {
  const turn: Turn = { id: newId(), at: trace.t0, text, steps: trace.steps, outcome, ms: Date.now() - trace.t0 };
  session.turns.push(turn);
  // Keep a session readable rather than complete; nobody replays the fortieth question.
  if (session.turns.length > 30) session.turns.shift();
  session.lastAt = Date.now();
  return turn;
}
