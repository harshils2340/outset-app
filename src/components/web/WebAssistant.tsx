import { useEffect, useRef, useState } from "react";
import { ICONS } from "../../data/icons";
import type { Unclaimed } from "../../data/types";
import { contactFor } from "../../lib/catalog";
import { ASSISTANT_NAME, companySuggestions } from "../../lib/companyAgent";
import { useApp } from "../../state/AppProvider";
import { Markup } from "../Markup";

/** Inline assistant on the listing page. One name, one scope line, chips, messages, input. Nothing else. */
export function WebAssistant({ item }: { item: Unclaimed }) {
  const { state, ensureThread, sendChat } = useApp();
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const msgs = state.chats[item.id] || [];
  const suggestions = companySuggestions({ item, contact: contactFor(item) });

  useEffect(() => {
    ensureThread(item.id);
  }, [item.id]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [msgs.length]);

  const send = (text: string) => {
    const v = text.trim();
    if (!v) return;
    if (state.threadId !== item.id) ensureThread(item.id);
    sendChat(v);
    setDraft("");
  };

  return (
    <section className="wassist" aria-label={ASSISTANT_NAME}>
      <header className="wassisthead">
        <span className="wassistmark">
          <Markup html={ICONS.spark} />
        </span>
        <span>
          <b>{ASSISTANT_NAME}</b>
          <small>Answers from {item.title}'s own info</small>
        </span>
      </header>
      <div className="wassistmsgs" ref={listRef}>
        {msgs.map((m, i) => (
          <div key={i} className={"wmsg " + (m.who === "me" ? "me" : "them")}>
            {m.t}
          </div>
        ))}
      </div>
      {msgs.length <= 1 ? (
        <div className="wassistchips">
          {suggestions.map((s) => (
            <button type="button" key={s} onClick={() => send(s)}>
              {s}
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
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={"Ask " + ASSISTANT_NAME + " about prices, hours, what to bring…"} />
        <button type="submit" aria-label="Send" disabled={!draft.trim()}>
          <Markup html={ICONS.send} />
        </button>
      </form>
    </section>
  );
}
