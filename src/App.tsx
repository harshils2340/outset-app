import { Suspense, lazy, useEffect, useState } from "react";
import { useApp } from "./state/AppProvider";
import { WebHome } from "./components/web/WebHome";
import { WebListing } from "./components/web/WebListing";
import { WebConfirm } from "./components/web/WebConfirm";
import { WebConcierge } from "./components/web/WebConcierge";
import { SafeBookDemo } from "./components/web/SafeBookDemo";
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
import { usePreviewMode } from "./components/operator/previewMode";
import { Mark } from "./components/layout/Mark";
import { experienceById } from "./lib/catalog";

/**
 * The operator dashboard is nine screens and the largest thing in the app, and a guest never opens it, so it
 * is fetched when somebody actually goes to it rather than sitting in the bundle everyone downloads.
 */
import { EmbeddedCheckout } from "./components/booking/EmbeddedCheckout";

const OperatorView = lazy(() => import("./components/operator/OperatorView").then((m) => ({ default: m.OperatorView })));

/**
 * The private metrics page at /admin. Nothing links to it, it is lazy so its code and its stylesheet never
 * reach the bundle a guest downloads, and the path is read once at boot: it cannot change under a running app,
 * so the early return below keeps the same hooks on every render of this component.
 */
const AdminView = lazy(() => import("./components/admin/AdminView").then((m) => ({ default: m.AdminView })));
const ADMIN_ROUTE = ((): boolean => {
  if (typeof window === "undefined") return false;
  const base = import.meta.env.BASE_URL.replace(/\/?$/, "/");
  const p = window.location.pathname;
  return p === base + "admin" || p === base + "admin/";
})();

/** While that chunk is on its way. Same shape as the other splashes, so it does not read as a broken page. */
function DashboardSplash() {
  return (
    <div className="paysplash" role="status" aria-live="polite">
      <Mark size={44} />
      <b>Opening your dashboard…</b>
      <small>One moment.</small>
    </div>
  );
}

/** A listing link before the listing's own file has landed: the page it is about to be, not the home page. */
function ListingSplash() {
  return (
    <div className="paysplash" role="status" aria-live="polite">
      <Mark size={44} />
      <b>Opening the listing…</b>
      <small>One moment.</small>
    </div>
  );
}

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

function SAFE_DEMO(): boolean {
  if (typeof window === "undefined") return false;
  return /^#safe\b/i.test(window.location.hash);
}

function WALLET_HASH(): boolean {
  if (typeof window === "undefined") return false;
  return /^#wallet\b/i.test(window.location.hash);
}

/**
 * `#ask` opens the concierge on load, so the answer to "what is actually free tonight" survives a refresh, can
 * be sent to somebody as a link, and can sit behind a QR code. It is read once, like the admin path above: a
 * hash the guest arrived on is a starting state, not something that changes under a running app.
 */
function ASKED_FOR(): string | null {
  if (typeof window === "undefined") return null;
  const m = /^#ask(?:=(.*))?$/i.exec(window.location.hash);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1] || "");
  } catch {
    return "";
  }
}

export function App() {
  // /admin is its own page: no tab bar, no sheets, no phone frame, and nothing about it in any navigation.
  if (ADMIN_ROUTE) {
    return (
      <Suspense fallback={null}>
        <AdminView />
      </Suspense>
    );
  }
  const { state, closeSheet, openOperator, reqTarget, openRequest, goto, openAsk, closeAsk } = useApp();
  /**
   * The agent. `null` is browse; a string is Ask, and a non-empty one is sent as soon as it opens.
   * Lives in the provider so a listing can open the same thread the home toggle does.
   */
  const asking = state.asking;
  const [safeDemo, setSafeDemo] = useState(SAFE_DEMO);
  const [web, setWeb] = useState(() => typeof window !== "undefined" && window.innerWidth >= 1024 && !WALLET_HASH());
  const [fit, setFit] = useState(1);
  /**
   * `#ask` arriving at a page that is already open. A shared link opens in whatever tab the person has, and a
   * hash that only changes navigates nothing: without this, the link works from cold and does nothing warm,
   * which is the half that gets shown to somebody.
   */
  useEffect(() => {
    const on = () => {
      const seed = ASKED_FOR();
      if (seed != null) openAsk(seed);
      setSafeDemo(SAFE_DEMO());
      if (WALLET_HASH()) {
        setWeb(false);
        goto("account");
      }
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, [goto, openAsk]);
  // Inside the dashboard's live preview frame (?preview=1): read-only, re-renders on every owner edit.
  usePreviewMode();
  // 1024px itself is the desktop site's own floor, not the phone frame's: a window sized to exactly that width
  // used to load the phone frame instead of the site everyone else at 1024px and up gets.
  useEffect(() => {
    const calc = () => setFit(window.innerWidth <= 1024 ? 1 : Math.min(1, (window.innerHeight - 110) / 832, (window.innerWidth - 48) / 400));
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);
  const toggleAsk = (on: boolean, seed = "") => (on ? openAsk(seed) : closeAsk());
  const askOnSite = web && asking != null && state.screen !== "operator" && !(state.screen === "confirm" && state.booking);

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
            {experienceById(state.booking.listing) || state.catalogComplete ? (
              <WebConfirm booking={state.booking} onDone={() => { goto("explore"); window.scrollTo(0, 0); }} onOpen={(id) => { goto("explore"); openRequest(id); window.scrollTo(0, 0); }} />
            ) : (
              <ListingSplash />
            )}
          </div>
        ) : state.screen !== "operator" && state.sheet === "request" && reqTarget ? (
          <div className="web">
            <WebListing item={reqTarget} onClose={closeSheet} onOpen={(id) => { window.scrollTo(0, 0); openRequest(id); }} />
          </div>
        ) : state.screen !== "operator" && state.sheet === "request" && state.reqTargetId && !state.catalogComplete ? (
          <div className="web">
            <ListingSplash />
          </div>
        ) : state.screen !== "operator" ? (
          <WebHome
            onOpenApp={openApp}
            onOperators={() => openOperator()}
            onAsk={(seed) => toggleAsk(true, seed)}
            asking={askOnSite}
            askSeed={asking || ""}
            onCloseAsk={() => toggleAsk(false)}
          />
        ) : null}
        {state.screen === "operator" ? (
          <div className="web wop">
            <Suspense fallback={<DashboardSplash />}>
              <OperatorView />
            </Suspense>
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
        {state.checkingOut ? (state.checkoutSecret ? <EmbeddedCheckout secret={state.checkoutSecret} /> : <CheckoutSplash />) : null}
        {safeDemo ? (
          <SafeBookDemo
            onClose={() => {
              setSafeDemo(false);
              if (SAFE_DEMO()) window.history.replaceState(null, "", window.location.pathname + window.location.search);
            }}
            onOpenAccount={() => {
              setSafeDemo(false);
              if (SAFE_DEMO()) window.history.replaceState(null, "", window.location.pathname + window.location.search);
              goto("account");
              setWeb(false);
            }}
          />
        ) : null}
      </>
    );
  }
  return (
    <div className="stage">
      <button type="button" className="wghost stageback" onClick={() => setWeb(true)}>
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M12.5 4.5 7 10l5.5 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back to the site
      </button>
      <div className="device" style={{ transform: `scale(${fit})`, transformOrigin: "center center" }}>
        <div className="screen" id="screen">
          <StatusBar />
          <AppView onAsk={() => toggleAsk(true)} onCloseAsk={() => toggleAsk(false)} asking={asking != null} />
          <TabBar />
          <Sheets />
          <Toast />
          {state.sheet === "request" && state.reqTargetId && !reqTarget && !state.catalogComplete ? <ListingSplash /> : null}
          {state.checkingOut ? (state.checkoutSecret ? <EmbeddedCheckout secret={state.checkoutSecret} /> : <CheckoutSplash />) : null}
          {/*
            Inside the phone frame the concierge is one of the app's own screens, so it sits in the frame and
            takes its rounded corners rather than covering the browser and the frame with it. On a real phone
            `.screen` is the viewport, so this is the full-screen version either way.
          */}
          {asking != null ? <WebConcierge seed={asking} framed onClose={() => toggleAsk(false)} /> : null}
        </div>
      </div>
      {safeDemo ? (
        <SafeBookDemo
          onClose={() => {
            setSafeDemo(false);
            if (SAFE_DEMO()) window.history.replaceState(null, "", window.location.pathname + window.location.search);
          }}
          onOpenAccount={() => {
            setSafeDemo(false);
            if (SAFE_DEMO()) window.history.replaceState(null, "", window.location.pathname + window.location.search);
            goto("account");
          }}
        />
      ) : null}
    </div>
  );
}

function AppView({ onAsk, onCloseAsk, asking }: { onAsk: () => void; onCloseAsk: () => void; asking: boolean }) {
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
      {state.screen === "operator" ? (
        <Suspense fallback={<DashboardSplash />}>
          <OperatorView compact />
        </Suspense>
      ) : null}
      {state.screen === "explore" ? <ExploreView onAsk={onAsk} onCloseAsk={onCloseAsk} asking={asking} /> : null}
      {state.screen === "trips" ? <TripsView /> : null}
      {state.screen === "inbox" ? <InboxView /> : null}
      {state.screen === "account" ? <AccountView /> : null}
    </div>
  );
}
