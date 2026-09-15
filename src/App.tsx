import { useEffect, useState } from "react";
import { useApp } from "./state/AppProvider";
import { WebHome } from "./components/web/WebHome";
import { WebListing } from "./components/web/WebListing";
import { WebConfirm } from "./components/web/WebConfirm";
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
import { usePreviewMode } from "./components/operator/previewMode";
import { Mark } from "./components/layout/Mark";

/** Between "Book and pay" and Stripe's page. The guest sees this, not the confirmation, until checkout takes over. */
function CheckoutSplash() {
  return (
    <div className="paysplash" role="status" aria-live="polite">
      <Mark size={44} />
      <b>Sending you to secure checkout…</b>
      <small>Payment is handled by Stripe on the next page.</small>
    </div>
  );
}

export function App() {
  const { state, closeSheet, openOperator, reqTarget, openRequest, goto } = useApp();
  // Inside the dashboard's live preview frame (?preview=1): read-only, re-renders on every owner edit.
  usePreviewMode();
  const [web, setWeb] = useState(() => typeof window !== "undefined" && window.innerWidth > 1024);
  const [fit, setFit] = useState(1);
  useEffect(() => {
    const calc = () => setFit(window.innerWidth <= 1024 ? 1 : Math.min(1, (window.innerHeight - 110) / 832, (window.innerWidth - 48) / 400));
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
        {state.screen === "confirm" && state.booking ? (
          <div className="web">
            <WebConfirm booking={state.booking} onDone={() => { goto("explore"); window.scrollTo(0, 0); }} onOpen={(id) => { goto("explore"); openRequest(id); window.scrollTo(0, 0); }} />
          </div>
        ) : state.screen !== "operator" && state.sheet === "request" && reqTarget ? (
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
        {state.checkingOut ? <CheckoutSplash /> : null}
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
          {state.checkingOut ? <CheckoutSplash /> : null}
        </div>
      </div>
    </div>
  );
}

function AppView() {
  const { state } = useApp();
  const chat = state.screen === "chat";
  // A sheet covers the screen it opened from, and that screen kept every one of its buttons in the tab order.
  // A guest who opened a listing had to tab past the whole Explore feed they could not see, card by card,
  // before reaching the date picker, and a screen reader read that feed out first.
  return (
    <div className="view" id="view" inert={!!state.sheet} style={{ overflowY: chat ? "hidden" : "auto" }}>
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
