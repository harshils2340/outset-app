import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ICONS } from "../../data/icons";
import type { Unclaimed } from "../../data/types";
import { fetchAvailability, type LiveAvailability } from "../../lib/api";
import { contactFor } from "../../lib/catalog";
import { ASSISTANT_NAME, companyAnswer, companySuggestions, type ChatState } from "../../lib/companyAgent";
import { Markup } from "../Markup";

type Msg = { id: number; who: "me" | "them"; text: string };

/** How long Otto "types" before an answer lands, so a reply reads as answered rather than pre-computed. */
const TYPING_MS = 250;

/**
 * Otto on the listing page: a small chat. The guest's messages sit right, Otto's left; chips under the thread
 * change with the conversation. Answers come from companyAnswer, which keeps what the last answer was about so
 * "and the longer one?" works, and reads live departures when the operator's booking system reports them.
 */
export function WebAssistant({ item }: { item: Unclaimed }) {
  const contact = contactFor(item);
  const [live, setLive] = useState<LiveAvailability | null>(null);
  const ctx = useMemo(() => ({ item, contact, live }), [item, contact, live]);

  const [msgs, setMsgs] = useState<Msg[]>([]);
  // Follow-up chips from the last answer; before the first question the chips come from the listing itself,
  // recomputed each render so they pick up the detail record and live times once those load.
  const [followUps, setFollowUps] = useState<string[] | null>(null);
  const [pending, setPending] = useState(0);
  const typing = pending > 0;
  const [draft, setDraft] = useState("");
  const memory = useRef<ChatState>({});
  const nextId = useRef(1);
  const listRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const inputId = useId();

  // A new listing starts a new conversation.
  useEffect(() => {
    setMsgs([]);
    setPending(0);
    setDraft("");
    memory.current = {};
    queue.current = [];
    busy.current = false;
    setFollowUps(null);
    setLive(null);
    let alive = true;
    void fetchAvailability(item.id)
      .then((a) => { if (alive && a.live && a.days.some((d) => d.slots.length)) setLive(a); })
      .catch(() => {});
    return () => {
      alive = false;
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
  }, [item.id]);

  const opening = useMemo(() => {
    const base = companySuggestions(ctx);
    return live ? ["When's the next opening?", ...base.filter((c) => c !== "When's the next opening?")].slice(0, 4) : base;
  }, [ctx, live]);
  const chips = followUps ?? opening;

  // Stay pinned to the newest message when the thread reflows (a narrower window, fonts loading).
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { el.scrollTop = el.scrollHeight; });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = listRef.current;
    // The container's own scroll-behavior animates this; setting scrollTop directly is never cancelled by a page scroll.
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, typing]);

  // One exchange at a time: a question sent while Otto is still "typing" waits its turn, so the thread always reads
  // question, answer, question, answer.
  const queue = useRef<string[]>([]);
  const busy = useRef(false);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const pump = () => {
    if (busy.current) return;
    const q = queue.current.shift();
    if (q == null) return;
    busy.current = true;
    setMsgs((cur) => [...cur, { id: nextId.current++, who: "me", text: q }]);
    const answer = companyAnswer(ctxRef.current, q, memory.current);
    memory.current = answer.state;
    setPending((n) => n + 1);
    const t = window.setTimeout(() => {
      timers.current = timers.current.filter((x) => x !== t);
      setMsgs((cur) => [...cur, { id: nextId.current++, who: "them", text: answer.text }]);
      setFollowUps(answer.chips);
      setPending((n) => Math.max(0, n - 1));
      busy.current = false;
      pump();
    }, TYPING_MS);
    timers.current.push(t);
  };

  const send = (text: string) => {
    const q = text.trim();
    if (!q) return;
    setDraft("");
    queue.current.push(q);
    pump();
  };

  return (
    <section className="wassist" aria-label={"Ask " + ASSISTANT_NAME + " about " + item.title}>
      <header className="wassisthead">
        <span className="wassistmark" aria-hidden="true">
          <Markup html={ICONS.spark} />
        </span>
        <span>
          <b>{ASSISTANT_NAME}</b>
          <small>Answers from {item.title}'s own info</small>
        </span>
      </header>

      <div className="wassistmsgs" ref={listRef} role="log" aria-live="polite" aria-relevant="additions">
        {msgs.length === 0 ? (
          <p className="wassistempty">Ask about prices, hours, rules or what to bring. I only answer from what {item.title} publishes.</p>
        ) : null}
        {msgs.map((m) => (
          <div key={m.id} className={"wmsg " + m.who}>
            <span className="wassistsr">{m.who === "me" ? "You: " : ASSISTANT_NAME + ": "}</span>
            {m.text}
          </div>
        ))}
        {typing ? (
          <div className="wmsg them wtyping" aria-label={ASSISTANT_NAME + " is typing"}>
            <i />
            <i />
            <i />
          </div>
        ) : null}
      </div>

      {chips.length ? (
        <div className="wassistchips" aria-label="Suggested questions">
          {chips.map((c) => (
            <button type="button" key={c} onClick={() => send(c)}>
              {c}
            </button>
          ))}
        </div>
      ) : null}

      <form
        className="wassistinput"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <label htmlFor={inputId} className="wassistsr">
          Ask {ASSISTANT_NAME} a question about {item.title}
        </label>
        <input
          id={inputId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={"Ask " + ASSISTANT_NAME + " a question"}
          autoComplete="off"
          enterKeyHint="send"
          maxLength={200}
        />
        <button type="submit" aria-label="Send" disabled={!draft.trim()}>
          <Markup html={ICONS.send} />
        </button>
      </form>
    </section>
  );
}
