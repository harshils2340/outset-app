import { useCallback, useEffect, useMemo, useState } from "react";
import { experienceById } from "../../lib/catalog";
import { loadListing } from "../../lib/catalogLoad";
import { allBookings, demoProfile, hydrateProfile, loadProfile, loadSession, saveProfile, saveSession, setBookingStatus, type OpBooking, type OpStatus, type OperatorProfile } from "../../lib/operator";
import { useApp } from "../../state/AppProvider";
import { decideBooking, fetchBookings, hasApi, signOutApi, type RemoteBooking } from "../../lib/api";
import { Mark } from "../layout/Mark";
import { Markup } from "../Markup";
import { OpAssistant } from "./OpAssistant";
import { OpBookings, BookingDrawer } from "./OpBookings";
import { OpCalendar } from "./OpCalendar";
import { OpHome } from "./OpHome";
import { OpHours } from "./OpHours";
import { OpListing } from "./OpListing";
import { OpLogin } from "./OpLogin";
import { OpPayouts, OpSettings } from "./OpMore";
import { OpServices } from "./OpServices";
import { OD_ICONS, OpCtx, PAGES, type OpApi, type OpPage } from "./opContext";

/**
 * Operator dashboard. The shape is the Uber Eats merchant app plus Booksy: a sidebar, an Accepting switch,
 * a bookings feed with Accept and Decline, a calendar, and editors for services, hours and the listing.
 * Everything saves on-device and flows to the guest listing. compact renders it inside the phone frame.
 */
export function OperatorView({ compact = false }: { compact?: boolean }) {
  const { state, back, openRequest, touchCatalog, dispatch } = useApp();
  const [session, setSession] = useState<string | null>(() => {
    // A claim link names a business. If it is already claimed here, open it. If not, show the claim flow
    // even when another business is signed in. With no link, resume the last session, or open the demo
    // dashboard straight away so a visitor sees the product without a sign-in wall.
    const claimed = state.operatorId;
    if (claimed) return loadProfile(claimed) ? claimed : null;
    return loadSession() || demoProfile()?.id || null;
  });
  const [p, setP] = useState<OperatorProfile | null>(() => (session ? loadProfile(session) : null));
  const [wantLogin, setWantLogin] = useState(false);
  const [page, setPage] = useState<OpPage>("home");
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [toastText, setToastText] = useState<string | null>(null);

  useEffect(() => {
    if (!toastText) return;
    const t = window.setTimeout(() => setToastText(null), 2400);
    return () => window.clearTimeout(t);
  }, [toastText]);

  const enter = useCallback((profile: OperatorProfile) => {
    saveSession(profile.id);
    setSession(profile.id);
    setP(profile);
    setPage("home");
    touchCatalog();
  }, [touchCatalog]);

  const set = useCallback<OpApi["set"]>((patch) => {
    setP((cur) => {
      if (!cur) return cur;
      const next = typeof patch === "function" ? patch(cur) : { ...cur, ...patch };
      saveProfile(next);
      return next;
    });
    touchCatalog();
  }, [touchCatalog]);

  const u = useMemo(() => (p ? experienceById(p.id) : null), [p?.id, state.catalogVersion]);
  // The demo and a fresh claim start from the slim browse record. Pull the detail file and fill the gaps.
  useEffect(() => {
    if (!p || !u?.lite) return;
    let alive = true;
    loadListing(p.id).then((changed) => {
      if (!alive || !changed) return;
      const full = experienceById(p.id);
      if (full) set((cur) => hydrateProfile(cur, full));
      touchCatalog();
    });
    return () => {
      alive = false;
    };
  }, [p?.id, u?.lite]);
  const [remote, setRemote] = useState<RemoteBooking[] | null>(null);
  // Real bookings live in the API. Poll while the dashboard is open so a new request shows within a minute.
  useEffect(() => {
    if (!p || !hasApi()) return;
    let alive = true;
    const load = async () => {
      const list = await fetchBookings(p.id);
      if (alive && list) setRemote(list);
    };
    void load();
    const t = window.setInterval(load, 45000);
    return () => { alive = false; window.clearInterval(t); };
  }, [p?.id]);
  const bookings = useMemo(() => (p ? allBookings(p, state.bookings, remote) : []), [p, state.bookings, remote]);

  const decide = useCallback((b: OpBooking, status: OpStatus) => {
    if (b.source === "remote" && p) {
      setRemote((cur) => (cur ? cur.map((x) => (x.code === b.code ? { ...x, status } : x)) : cur));
      void decideBooking(p.id, b.code, status).then((ok) => { if (!ok) setToastText("Could not save that. Check your connection."); });
    } else set((cur) => setBookingStatus(cur, b, status));
    const word: Record<OpStatus, string> = { accepted: "Accepted", declined: "Declined", completed: "Marked complete", noshow: "Marked no-show", cancelled: "Cancelled", new: "Reopened" };
    setToastText(word[status] + " · " + b.guest);
  }, [set, p?.id]);

  const logout = () => {
    signOutApi();
    saveSession(null);
    setSession(null);
    setP(null);
    setOpenedId(null);
    setWantLogin(true);
  };

  if (!p || !u || wantLogin) {
    return (
      <OpLogin
        claimId={state.operatorId}
        claimToken={state.claimToken}
        compact={compact}
        onEnter={(profile) => { setWantLogin(false); enter(profile); }}
        onBack={back}
      />
    );
  }
  const isDemo = p.ownerEmail === "owner@example.com" && p.ownerName === "Demo owner";

  const api: OpApi = {
    p,
    u,
    compact,
    page,
    go: (pg) => { setPage(pg); setOpenedId(null); },
    set,
    bookings,
    decide,
    openBooking: setOpenedId,
    openedId,
    preview: () => {
      if (compact) {
        openRequest(p.id);
        return;
      }
      window.open(window.location.pathname + "#o=" + p.id, "_blank", "noopener");
    },
    toast: setToastText,
    logout,
  };

  const fresh = bookings.filter((b) => b.status === "new").length;
  const opened = openedId ? bookings.find((b) => b.id === openedId) || null : null;
  const title = PAGES.find((x) => x.id === page)?.label || "";

  const nav = (
    <nav className="odnav">
      {PAGES.map((pg) => (
        <button type="button" key={pg.id} aria-current={page === pg.id ? "page" : undefined} onClick={() => api.go(pg.id)}>
          <Markup html={OD_ICONS[pg.icon]} />
          <span>{pg.label}</span>
          {pg.id === "bookings" && fresh ? <em>{fresh}</em> : null}
        </button>
      ))}
    </nav>
  );

  return (
    <OpCtx.Provider value={api}>
      <div className={"od" + (compact ? " compact" : "")}>
        {!compact ? (
          <aside className="odside">
            <button type="button" className="odbrand" onClick={() => { dispatch({ type: "back" }); }}>
              <Mark size={28} />
              <b>Outset</b>
              <span>for operators</span>
            </button>
            <div className="odbiz">
              <span className="odbizmark">{p.title.slice(0, 1)}</span>
              <span className="meta">
                <b>{p.title}</b>
                <small>{isDemo ? "Demo dashboard" : !p.published ? "Not on the site" : !p.services.some((x) => x.live) ? "Live · no menu yet" : p.accepting ? "Live · accepting" : "Live · paused"}</small>
              </span>
            </div>
            {isDemo ? (
              <button type="button" className="cta small odclaimcta" onClick={() => setWantLogin(true)}>Claim your business</button>
            ) : null}
            {nav}
            <div className="odsidefoot">
              <button type="button" onClick={api.preview}><Markup html={OD_ICONS.external} /> View my listing</button>
              <button type="button" onClick={logout}><Markup html={OD_ICONS.logout} /> {isDemo ? "Sign in" : "Log out"}</button>
            </div>
          </aside>
        ) : null}

        <div className="odmain">
          <header className="odtop">
            {compact ? (
              <button type="button" className="odiconbtn" onClick={back} aria-label="Back"><Markup html={OD_ICONS.back} /></button>
            ) : null}
            <div className="odtoptitle">
              <h1>{compact && page === "home" ? p.title : title}</h1>
              {!compact ? <small>{p.address || u.area}</small> : null}
            </div>
            <div className="odtopright">
              {!p.published ? <span className="odpill off">Hidden from site</span> : null}
              <button type="button" className={"optoggle" + (p.accepting ? " on" : "")} onClick={() => { set({ accepting: !p.accepting }); setToastText(p.accepting ? "Paused. Guests can't book new times." : "Accepting bookings again."); }} aria-pressed={p.accepting}>
                <span className="knob" />
                <span className="lbl">{p.accepting ? "Accepting" : "Paused"}</span>
              </button>
            </div>
          </header>

          <main className="odbody">
            {page === "home" ? <OpHome /> : null}
            {page === "bookings" ? <OpBookings /> : null}
            {page === "calendar" ? <OpCalendar /> : null}
            {page === "services" ? <OpServices /> : null}
            {page === "hours" ? <OpHours /> : null}
            {page === "listing" ? <OpListing /> : null}
            {page === "assistant" ? <OpAssistant /> : null}
            {page === "payouts" ? <OpPayouts /> : null}
            {page === "settings" ? <OpSettings /> : null}
          </main>

          {compact ? (
            <nav className="odtabs">
              {PAGES.filter((x) => ["home", "bookings", "calendar", "services"].includes(x.id)).map((pg) => (
                <button type="button" key={pg.id} aria-current={page === pg.id ? "page" : undefined} onClick={() => api.go(pg.id)}>
                  <Markup html={OD_ICONS[pg.icon]} />
                  <span>{pg.label}</span>
                  {pg.id === "bookings" && fresh ? <em>{fresh}</em> : null}
                </button>
              ))}
              <button type="button" aria-current={["hours", "listing", "assistant", "payouts", "settings"].includes(page) ? "page" : undefined} onClick={() => api.go("settings")}>
                <Markup html={OD_ICONS.more} />
                <span>More</span>
              </button>
            </nav>
          ) : null}
        </div>

        {opened ? <BookingDrawer b={opened} onClose={() => setOpenedId(null)} /> : null}
        {toastText ? <div className="odtoast">{toastText}</div> : null}
      </div>
    </OpCtx.Provider>
  );
}
