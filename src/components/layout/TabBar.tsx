import type { ReactNode } from "react";
import type { TabId } from "../../data/types";
import { IcHeart, IcInbox, IcProfile, IcSearch, IcTicket } from "../explore/AirIcons";
import { setPrefs, usePrefs } from "../explore/prefs";
import { inboxThreads } from "../inbox/InboxView";
import { useApp } from "../../state/AppProvider";

type Item = { key: string; tab: TabId; name: string; icon: ReactNode; wishlists?: boolean };

/**
 * Airbnb's bottom bar: Explore, Wishlists, Trips, Inbox, Profile. Wishlists is a page of the Explore tab (the app
 * has four real tabs), so it sets the Explore tab and flips the page shown there.
 */
const ITEMS: Item[] = [
  { key: "explore", tab: "explore", name: "Explore", icon: <IcSearch /> },
  { key: "wishlists", tab: "explore", name: "Wishlists", icon: <IcHeart />, wishlists: true },
  { key: "trips", tab: "trips", name: "Trips", icon: <IcTicket /> },
  { key: "inbox", tab: "inbox", name: "Inbox", icon: <IcInbox /> },
  { key: "account", tab: "account", name: "Profile", icon: <IcProfile /> },
];

export function TabBar() {
  const { state, setTab } = useApp();
  const { view } = usePrefs();
  // The operator dashboard has its own bottom nav.
  if (state.screen === "chat" || state.screen === "operator") return null;
  // The same threads the Inbox tab lists, so the badge and the page never disagree: a thread whose operator
  // has left the catalog left a "1" here over a page reading "No threads yet", and one that has not arrived
  // yet still counts, because the tab says it is loading them.
  const { rows, loading, total } = inboxThreads(state.chats, state.catalogComplete);
  const inboxCount = loading ? total : rows.length;

  return (
    <nav className="tabbar airtabbar" id="tabbar" inert={!!state.sheet}>
      {ITEMS.map((t) => {
        const onScreen = state.tab === t.tab && state.screen !== "detail" && state.screen !== "confirm";
        const current = onScreen && (t.tab !== "explore" || !!t.wishlists === (view === "wishlists"));
        return (
          <button
            key={t.key}
            type="button"
            className="tab"
            data-tab={t.key}
            aria-current={current ? "page" : undefined}
            onClick={() => {
              if (t.tab === "explore") setPrefs({ view: t.wishlists ? "wishlists" : "feed" });
              setTab(t.tab);
              const v = document.getElementById("view");
              if (v && current) v.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            <span className="tabico">
              {t.icon}
              {t.key === "inbox" && inboxCount > 0 ? <span className="badge">{inboxCount}</span> : null}
            </span>
            <span>{t.name}</span>
          </button>
        );
      })}
    </nav>
  );
}
