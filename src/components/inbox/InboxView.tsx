import { LISTINGS } from "../../data/listings";
import { ICONS } from "../../data/icons";
import { experienceById, initials } from "../../lib/catalog";
import { useApp } from "../../state/AppProvider";
import { Markup } from "../Markup";

export function InboxView() {
  const { state, openChat } = useApp();
  const ids = Object.keys(state.chats);

  return (
    <>
      <div className="apphead">
        <h2 className="sec">Messages</h2>
      </div>
      {ids.length ? (
        ids.map((id) => {
          const l = LISTINGS.find((x) => x.id === id);
          const u = l ? null : experienceById(id);
          if (!l && !u) return null;
          const name = l ? l.op : u!.title;
          const init = l ? l.opInit : initials(u!.title);
          const msgs = state.chats[id];
          const last = msgs[msgs.length - 1];
          return (
            <button className="thread" key={id} onClick={() => openChat(id)}>
              <span className="avatar">{init}</span>
              <span className="info">
                <span className="top">
                  <b>{name}</b>
                  <time>{last.at || "now"}</time>
                </span>
                <span className="prev">
                  {(last.who === "me" ? "You: " : "") + (last.t || "...")}
                </span>
                <span className="agentpill" style={{ marginTop: 5 }}>
                  <Markup html={ICONS.spark} />
                  {l ? "Agent online" : "24/7 assistant"}
                </span>
              </span>
            </button>
          );
        })
      ) : (
        <div className="empty">
          <div className="glyph">
            <Markup html={ICONS.chat} />
          </div>
          <b>No threads yet</b>
          <p>Book a trip, then message the operator here.</p>
        </div>
      )}
      <div className="spacer" />
    </>
  );
}
