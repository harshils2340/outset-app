import { ICONS } from "../../data/icons";
import { Markup } from "../Markup";
import { useApp } from "../../state/AppProvider";

const TABS = [
  { id: "explore" as const, name: "Explore", icon: "compass" },
  { id: "trips" as const, name: "Trips", icon: "ticket" },
  { id: "inbox" as const, name: "Messages", icon: "chat" },
  { id: "account" as const, name: "Profile", icon: "user" },
];

export function TabBar() {
  const { state, setTab } = useApp();
  // The operator dashboard has its own bottom nav.
  if (state.screen === "chat" || state.screen === "operator") return null;
  const inboxCount = Object.keys(state.chats).length;

  return (
    <nav className="tabbar" id="tabbar">
      {TABS.map((t) => {
        const current = state.tab === t.id && state.screen !== "detail" && state.screen !== "chat" && state.screen !== "confirm";
        return (
          <button
            key={t.id}
            className="tab"
            data-tab={t.id}
            aria-current={current ? "page" : undefined}
            onClick={() => setTab(t.id)}
          >
            <span style={{ position: "relative", display: "block" }}>
              <Markup html={ICONS[t.icon]} />
              {t.id === "inbox" && inboxCount > 0 ? <span className="badge">{inboxCount}</span> : null}
            </span>
            <span>{t.name}</span>
          </button>
        );
      })}
    </nav>
  );
}
