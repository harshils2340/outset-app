import { useState } from "react";
import { useApp } from "./state/AppProvider";
import { WebHome } from "./components/web/WebHome";
import { WebListing } from "./components/web/WebListing";
import { Mark } from "./components/layout/Mark";
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
  const { state, closeSheet, openOperator, reqTarget, openRequest, back } = useApp();
  const [web, setWeb] = useState(() => typeof window !== "undefined" && window.innerWidth > 1024);
  if (web) {
    return (
      <>
        {state.screen !== "operator" && state.sheet === "request" && reqTarget ? (
          <div className="web">
            <WebListing item={reqTarget} onClose={closeSheet} onOpen={(id) => { window.scrollTo(0, 0); openRequest(id); }} />
          </div>
        ) : state.screen !== "operator" ? (
          <WebHome onOpenApp={() => setWeb(false)} onOperators={openOperator} />
        ) : null}
        {state.screen === "operator" ? (
          <div className="web wop">
            <header className="whead">
              <div className="wwrap whead-in">
                <a className="wlogo" href="#" onClick={(e) => { e.preventDefault(); back(); }}>
                  <Mark size={30} />
                  <b>Outset</b>
                  <span className="wopertag">for operators</span>
                </a>
                <div className="wright">
                  <button type="button" className="wghost" onClick={back}>Back to guests</button>
                </div>
              </div>
            </header>
            <div className="wopwrap">
              <div className="wopintro">
                <h1>Your bookings, the way they come in.</h1>
                <p>Guests pick a time on your listing. You accept or decline here. Your menu is already filled in from your website; fix anything that's off.</p>
              </div>
              <div className="woppanel">
                <OperatorView />
              </div>
            </div>
          </div>
        ) : null}
        {state.screen === "chat" ? (
          <div className="webmodal" onClick={() => window.history.back()}>
            <div className="screen webscreen webchat" onClick={(e) => e.stopPropagation()}>
              <ChatView />
            </div>
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
      {state.screen === "operator" ? <OperatorView /> : null}
      {state.screen === "explore" ? <ExploreView /> : null}
      {state.screen === "trips" ? <TripsView /> : null}
      {state.screen === "inbox" ? <InboxView /> : null}
      {state.screen === "account" ? <AccountView /> : null}
    </div>
  );
}
