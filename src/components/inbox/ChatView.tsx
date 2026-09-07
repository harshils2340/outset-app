import { useEffect, useRef, useState } from "react";
import { ICONS } from "../../data/icons";
import { money } from "../../lib/format";
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
  const suggestions = [
    "Do you have " + (thread.qtyMax > 2 ? "3" : "2") + " open Saturday around 11?",
    "What's actually included in the price?",
    "What happens if the weather turns?",
    "Is this OK for a total first-timer?",
  ];

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
        <span className="avatar">{thread.opInit}</span>
        <span className="meta">
          <b>{thread.op}</b>
          <span className="agentpill">
            <Markup html={ICONS.spark} />
            Agent online · replies in seconds
          </span>
        </span>
      </div>
      <div className="msgs" id="msgs" ref={msgsRef}>
        <div className="bub sys">
          {thread.title} · {money(thread.price)}/{thread.unit} · {thread.launch}
        </div>
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
      <div className="chipbar" style={{ padding: "0 14px 8px" }}>
        {suggestions.map((s) => (
          <button className="chip" key={s} onClick={() => send(s)}>
            {s}
          </button>
        ))}
      </div>
      <div className="composer">
        <textarea
          id="composer"
          rows={1}
          placeholder="Ask about availability, gear, anything…"
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
