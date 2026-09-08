import { useEffect, useState } from "react";
import { useApp } from "./state/AppProvider";
import { WebHome } from "./components/web/WebHome";
import { WebListing } from "./components/web/WebListing";
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
import { OperatorView } from "./components/operator/OperatorView";
import { Sheets } from "./components/booking/Sheets";

export function App() {
  const { state, closeSheet, openOperator, reqTarget, openRequest, goto } = useApp();
  const [web, setWeb] = useState(() => typeof window !== "undefined" && window.innerWidth > 1024);
  const [fit, setFit] = useState(1);
  useEffect(() => {
    const calc = () => setFit(Math.min(1, (window.innerHeight - 110) / 832, (window.innerWidth - 48) / 400));
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);
  const openApp = () => {
    closeSheet();
    goto("explore");
    setWeb(false);
  };
  if (web) {
    return (
      <>
        {state.screen !== "operator" && state.sheet === "request" && reqTarget ? (
          <div className="web">
            <WebListing item={reqTarget} onClose={closeSheet} onOpen={(id) => { window.scrollTo(0, 0); openRequest(id); }} />
          </div>
        ) : state.screen !== "operator" ? (
          <WebHome onOpenApp={openApp} onOperators={() => openOperator()} />
        ) : null}
        {state.screen === "operator" ? (
          <div className="web wop">
            <OperatorView />
          </div>
        ) : null}
        {state.sheet && state.sheet !== "request" ? (
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
      <button type="button" className="wghost stageback" onClick={() => setWeb(true)}>Back to the site</button>
      <div className="device" style={{ transform: `scale(${fit})`, transformOrigin: "center center" }}>
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
      {state.screen === "operator" ? <OperatorView compact /> : null}
      {state.screen === "explore" ? <ExploreView /> : null}
      {state.screen === "trips" ? <TripsView /> : null}
      {state.screen === "inbox" ? <InboxView /> : null}
      {state.screen === "account" ? <AccountView /> : null}
    </div>
  );
}
