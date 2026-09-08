import { useState } from "react";
import { useApp } from "./state/AppProvider";
import { WebHome } from "./components/web/WebHome";
import { Pitch } from "./components/layout/Pitch";
import { StatusBar } from "./components/layout/StatusBar";
import { TabBar } from "./components/layout/TabBar";
import { Toast } from "./components/layout/Toast";
import { ExploreView } from "./components/explore/ExploreView";
import { DetailView } from "./components/listing/DetailView";
import { TripsView } from "./components/trips/TripsView";
import { InboxView } from "./components/inbox/InboxView";
import { ChatView } from "./components/inbox/ChatView";
import { AccountView } from "./components/account/AccountView";
import { ConfirmView } from "./components/booking/ConfirmView";
import { Sheets } from "./components/booking/Sheets";

export function App() {
  const { state, closeSheet } = useApp();
  const [web, setWeb] = useState(() => typeof window !== "undefined" && window.innerWidth > 1024);
  if (web) {
    return (
      <>
        <WebHome onOpenApp={() => setWeb(false)} />
        {state.sheet ? (
          <div className="webmodal" onClick={closeSheet}>
            <div className="screen webscreen" onClick={(e) => e.stopPropagation()}>
              <Sheets />
              <Toast />
            </div>
          </div>
        ) : null}
      </>
    );
  }
  return (
    <div className="stage">
      <Pitch />
      <div className="device">
        <div className="screen" id="screen">
          <StatusBar />
          <AppView />
          <TabBar />
          <Sheets />
          <Toast />
        </div>
      </div>
    </div>
  );
}

function AppView() {
  const { state } = useApp();
  const chat = state.screen === "chat";
  return (
    <div className="view" id="view" style={{ overflowY: chat ? "hidden" : "auto" }}>
      {state.screen === "detail" ? <DetailView /> : null}
      {state.screen === "confirm" ? <ConfirmView /> : null}
      {state.screen === "chat" ? <ChatView /> : null}
      {state.screen === "explore" ? <ExploreView /> : null}
      {state.screen === "trips" ? <TripsView /> : null}
      {state.screen === "inbox" ? <InboxView /> : null}
      {state.screen === "account" ? <AccountView /> : null}
    </div>
  );
}
