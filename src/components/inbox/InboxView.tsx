import { LISTINGS } from "../../data/listings";
import { ICONS } from "../../data/icons";
import { useApp } from "../../state/AppProvider";
import { Markup } from "../Markup";

export function InboxView() {
  const { state, openChat } = useApp();
  const ids = Object.keys(state.chats);

  return (
    <>
      <div className="apphead">
        <p className="eyebrow">Operators answer instantly</p>
        <h2 className="sec" style={{ fontSize: 24 }}>
          Inbox
        </h2>
      </div>
      {ids.map((id) => {
        const l = LISTINGS.find((x) => x.id === id);
        if (!l) return null;
        const msgs = state.chats[id];
        const last = msgs[msgs.length - 1];
        return (
          <button className="thread" key={id} onClick={() => openChat(id)}>
            <span className="avatar">{l.opInit}</span>
            <span className="info">
              <span className="top">
                <b>{l.op}</b>
                <time>{last.at || "now"}</time>
              </span>
              <span className="prev">
                {(last.who === "me" ? "You: " : "") + (last.t || "...")}
              </span>
              <span className="agentpill" style={{ marginTop: 5 }}>
                <Markup html={ICONS.spark} />
                Agent online
              </span>
            </span>
          </button>
        );
      })}
      <p className="note">
        On Outset the operator never has to pick up the phone. Their agent knows the inventory, the weight limits, the
        weather rules and the refund policy.
      </p>
      <div className="spacer" />
    </>
  );
}
