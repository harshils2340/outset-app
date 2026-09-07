import { useEffect, useRef, useState } from "react";
import { ICONS } from "../../data/icons";
import { useApp } from "../../state/AppProvider";
import { Markup } from "../Markup";

export function ChatView() {
  const { thread, state, back, sendChat } = useApp();
  const [draft, setDraft] = useState("");
  const msgsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = msgsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread, state.chats]);

  if (!thread) return null;
  const msgs = state.chats[thread.id] || [];
  const suggestions = thread.suggestions;

  function send(text: string) {
    const v = text.trim();
    if (!v) return;
    sendChat(v);
    setDraft("");
  }

  return (
    <div className="chatwrap">
      <div className="chathead">
        <button onClick={back} style={{ color: "var(--ink-soft)" }}>
          <Markup html={ICONS.back} />
        </button>
        <span className="avatar">{thread.initials}</span>
        <span className="meta">
          <b>{thread.name}</b>
          <span className="agentpill">
            <Markup html={ICONS.spark} />
            {thread.kind === "company" ? "24/7 assistant · published info only" : "Agent online · replies in seconds"}
          </span>
        </span>
      </div>
      <div className="msgs" id="msgs" ref={msgsRef}>
        <div className="bub sys">{thread.line}</div>
        {msgs.map((m, i) => {
          if (m.who === "sys") {
            return (
              <div className="bub sys" key={i}>
                {m.t}
              </div>
            );
          }
          return (
            <div className={"bub " + (m.who === "me" ? "me" : "them")} key={i}>
              {m.t}
            </div>
          );
        })}
      </div>
      <div className="suggest">
        {suggestions.map((s) => (
          <button className="pill" key={s} onClick={() => send(s)}>
            {s}
          </button>
        ))}
      </div>
      <div className="composer">
        <textarea
          id="composer"
          rows={1}
          placeholder={thread.kind === "company" ? "Ask about prices, hours, where to meet…" : "Ask about availability, gear, anything…"}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = Math.min(80, e.target.scrollHeight) + "px";
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
        />
        <button className="send" disabled={!draft.trim()} onClick={() => send(draft)}>
          <Markup html={ICONS.send} />
        </button>
      </div>
    </div>
  );
}
