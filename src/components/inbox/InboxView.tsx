import { LISTINGS } from "../../data/listings";
import { ICONS } from "../../data/icons";
import { experienceById, initials, stillArriving } from "../../lib/catalog";
import { useApp } from "../../state/AppProvider";
import { Markup } from "../Markup";

export type ThreadRow = { id: string; name: string; init: string; agent: boolean };

/**
 * The threads this tab can actually open, and whether the rest are still on their way.
 *
 * A thread names an operator, and the operator is looked up in a catalog that arrives after the first paint,
 * while the threads themselves come straight out of localStorage. Every id that had not landed yet rendered as
 * null, so a guest with three conversations opened this tab on a cold start and got the word "Messages" over a
 * blank page: no threads, and not even the empty state, because the tab branched on the count of ids rather
 * than the count of threads it could draw. The tab bar's badge reads the same answer, so a thread whose
 * operator has left the catalog no longer leaves a "1" on the tab over a page saying "No threads yet".
 */
export function inboxThreads(chats: Record<string, unknown>, catalogComplete: boolean): { rows: ThreadRow[]; loading: boolean; total: number } {
  const ids = Object.keys(chats);
  const rows = ids
    .map((id) => {
      const l = LISTINGS.find((x) => x.id === id) || null;
      const u = l ? null : experienceById(id);
      return l || u ? { id, name: l ? l.op : u!.title, init: l ? l.opInit : initials(u!.title), agent: !!l } : null;
    })
    .filter((r): r is ThreadRow => r != null);
  return { rows, loading: stillArriving(ids.length - rows.length, rows.length, catalogComplete), total: ids.length };
}

export function InboxView() {
  const { state, openChat } = useApp();
  const { rows, loading, total: idCount } = inboxThreads(state.chats, state.catalogComplete);

  if (loading) {
    return (
      <>
        <div className="apphead">
          <h2 className="sec">Messages</h2>
        </div>
        <div className="empty">
          <div className="glyph">
            <Markup html={ICONS.chat} />
          </div>
          <b>Loading your {idCount === 1 ? "conversation" : idCount + " conversations"}</b>
          <p>One moment while we look them up.</p>
        </div>
        <div className="spacer" />
      </>
    );
  }

  return (
    <>
      <div className="apphead">
        <h2 className="sec">Messages</h2>
      </div>
      {rows.length ? (
        rows.map(({ id, name, init, agent }) => {
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
                  {agent ? "Agent online" : "24/7 assistant"}
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
