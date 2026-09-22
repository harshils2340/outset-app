import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Unclaimed } from "../../data/types";
import { experienceById } from "../../lib/catalog";
import { loadListing } from "../../lib/catalogLoad";
import { JUMP_PAGE, allBookings, applyStoredProfiles, demoProfile, hydrateProfile, isDemoProfile, loadProfile, loadSession, profileKey, saveProfile, saveSession, setBookingStatus, type JumpField, type OpBooking, type OpStatus, type OperatorProfile } from "../../lib/operator";
import { useApp } from "../../state/AppProvider";
import { decideBooking, fetchBookings, hasApi, onOperatorAuthLost, signOutApi, takeClaimNotice, type RemoteBooking } from "../../lib/api";
import { Markup } from "../Markup";
import { Mark } from "../layout/Mark";
import { OpAssistant } from "./OpAssistant";
import { OpBookings, BookingDrawer } from "./OpBookings";
import { OpCalendar } from "./OpCalendar";
import { OpHome } from "./OpHome";
import { OpHours } from "./OpHours";
import { OpListing } from "./OpListing";
import { OpLogin } from "./OpLogin";
import { OpPayouts, OpSettings } from "./OpMore";
import { OpPreview, loadPreviewPrefs, savePreviewPrefs } from "./OpPreview";
import { OpServices } from "./OpServices";
import { OpSidebar } from "./OpSidebar";
import { OD_ICONS, OpCtx, PAGES, type OpApi, type OpPage } from "./opContext";

/** Pages whose edits show on the guest listing, so the live preview can sit beside them. */
const PREVIEW_PAGES: OpPage[] = ["listing", "services", "hours"];

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
  // Stripe sends the operator back to /operators#payouts after onboarding; that page, not Home, is where they left.
  const [page, setPage] = useState<OpPage>(() => (typeof window !== "undefined" && window.location.hash === "#payouts" ? "payouts" : "home"));
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [toastText, setToastText] = useState<string | null>(null);
  // Shown once, on the way in, when the server said this listing already had a different owner.
  const [claimNotice, setClaimNotice] = useState<{ email: string; at?: string } | null>(null);
  // The live preview beside the editor. Open or closed, its size and device are remembered on this device.
  const [previewOpen, setPreviewOpen] = useState(() => !compact && loadPreviewPrefs().open);
  const [previewWidth, setPreviewWidth] = useState(() => loadPreviewPrefs().width);
  const revealRef = useRef<((field: JumpField) => void) | null>(null);
  const [jumpTo, setJumpTo] = useState<{ field: JumpField; n: number } | null>(null);
  // Autosave feedback. Every edit already saves; this says so, next to the header, right after the owner changes something.
  const [savedAt, setSavedAt] = useState(0);
  // The last write to this browser's storage was refused. Shown in the header until one goes through.
  const [saveFailed, setSaveFailed] = useState(false);
  // The API stopped accepting this device: a session that ran out, or a claim link past its expiry. Everything
  // still saves here, so the dashboard reads exactly as it did, and nothing reaches a guest until they sign in.
  const [signedOut, setSignedOut] = useState(false);
  const lastTouch = useRef(0);
  const bodyRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (p) setClaimNotice(takeClaimNotice());
  }, [p?.id]);

  /* Only a refusal about the business on screen. This device holds a profile per business it has ever claimed
     plus the demo one, and every app load pushes all of them, so a session for one shop is refused for the
     others by design; taking any refusal as this one's would tell an owner with a good session they were
     signed out. The demo dashboard has no session at all by design, and its saves are meant to stop at this
     browser, so it is the one profile that never raises this. */
  const demoHere = !!p && isDemoProfile(p);
  const mineId = p?.id;
  useEffect(() => {
    if (!hasApi() || demoHere || !mineId) return;
    onOperatorAuthLost((id) => { if (id === mineId) setSignedOut(true); });
    return () => onOperatorAuthLost(null);
  }, [demoHere, mineId]);
  useEffect(() => { setSignedOut(false); }, [p?.id]);

  useEffect(() => {
    if (!toastText) return;
    const t = window.setTimeout(() => setToastText(null), 2400);
    return () => window.clearTimeout(t);
  }, [toastText]);

  const enter = useCallback((profile: OperatorProfile) => {
    saveSession(profile.id);
    // The address bar keeps `#claim=<id>` for the business a claim link named. Switching to another business
    // makes that stale: a reload reopened the link's business, not the one the owner had just switched to.
    const h = window.location.hash.match(/^#claim=([a-z0-9-]+)/i);
    if (h && h[1].toLowerCase() !== profile.id) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    setSession(profile.id);
    setP(profile);
    setPage("home");
    touchCatalog();
  }, [touchCatalog]);

  const set = useCallback<OpApi["set"]>((patch) => {
    setP((cur) => {
      if (!cur) return cur;
      const next = typeof patch === "function" ? patch(cur) : { ...cur, ...patch };
      // The fill-in from the detail file hands back the same profile once there is nothing left to fill, and
      // saving it wrote the whole record to the API again on every visit to the dashboard.
      if (next === cur) return cur;
      // The updater runs at render time, so its feedback is queued rather than set in place.
      if (saveProfile(next)) {
        // Only an edit the owner just made flashes Saved; a background fill-in from the detail file stays quiet.
        const mine = Date.now() - lastTouch.current < 1500;
        window.setTimeout(() => { setSaveFailed(false); if (mine) setSavedAt(Date.now()); }, 0);
      } else {
        // The browser refused the write (storage full or blocked). The header used to flash Saved anyway.
        window.setTimeout(() => { setSaveFailed(true); setSavedAt(0); setToastText("Couldn't save. This browser's storage is full or blocked."); }, 0);
      }
      return next;
    });
    touchCatalog();
  }, [touchCatalog]);

  // Another tab (or window) of this dashboard saved the same business: take its copy, so the next edit here
  // builds on it instead of writing this tab's stale profile over it. Two tabs editing the phone and the
  // address used to end with one of the two edits gone.
  useEffect(() => {
    if (!p?.id) return;
    const id = p.id;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== profileKey(id) || !e.newValue) return;
      const fresh = loadProfile(id);
      if (!fresh) return;
      setP(fresh);
      applyStoredProfiles({ remote: false });
      touchCatalog();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [p?.id, touchCatalog]);

  const jump = useCallback((field: JumpField) => {
    setPage(JUMP_PAGE[field]);
    setOpenedId(null);
    setJumpTo({ field, n: Date.now() });
  }, []);

  // After a jump, find the field on its page (a service row may need a render to open), bring it into view,
  // focus it and flash it so the eye lands on it.
  useEffect(() => {
    if (!jumpTo) return;
    let tries = 0;
    let t = 0;
    const seek = () => {
      const el = bodyRef.current?.querySelector<HTMLElement>(`[data-jump~="${jumpTo.field}"]`);
      if (!el) {
        if (tries++ < 20) t = window.setTimeout(seek, 40);
        return;
      }
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      const input = el.matches("input,textarea,select,button") ? el : el.querySelector<HTMLElement>("input:not([type=file]),textarea,select");
      input?.focus({ preventScroll: true });
      el.classList.remove("odflash");
      void el.offsetWidth;
      el.classList.add("odflash");
      window.setTimeout(() => el.classList.remove("odflash"), 1700);
    };
    t = window.setTimeout(seek, 0);
    return () => window.clearTimeout(t);
  }, [jumpTo]);

  useEffect(() => {
    if (!savedAt) return;
    const t = window.setTimeout(() => setSavedAt(0), 2200);
    return () => window.clearTimeout(t);
  }, [savedAt]);


  const showPreview = useCallback((open: boolean) => {
    setPreviewOpen(open);
    savePreviewPrefs({ open });
  }, []);

  const u = useMemo(() => (p ? experienceById(p.id) : null), [p?.id, state.catalogVersion]);
  // The demo and a fresh claim start from the slim browse record. Pull the detail file and fill the gaps.
  // A hand-verified seed has no detail file of its own; its crawled twin (same domain, "o-" id) has the photos and menu.
  useEffect(() => {
    if (!p || !u) return;
    const domain = u.src.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase();
    const twinId = "o-" + domain.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
    let alive = true;
    if (u.lite) {
      loadListing(u.id).then((ok) => {
        if (!alive || !ok) return;
        const full = experienceById(u.id);
        if (full) set((cur) => hydrateProfile(cur, full));
        touchCatalog();
      });
    } else if (!p.photos.length || !p.blurb) {
      // The twin is deliberately kept out of the catalog (the seed wins on the guest side), so read its file directly.
      fetch(import.meta.env.BASE_URL + "o/" + twinId + ".json", { cache: "no-cache" })
        .then((r) => (r.ok ? r.json() : null))
        .then((full: Unclaimed | null) => {
          if (!alive || !full || !Array.isArray(full.options)) return;
          set((cur) => hydrateProfile(cur, full));
        })
        .catch(() => undefined);
    }
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
  // catalogVersion: a browser-local booking names its service through the listing, which fills in a moment
  // after the dashboard opens; without it the row kept the scraped menu's name until the next edit.
  const bookings = useMemo(() => (p ? allBookings(p, state.bookings, remote) : []), [p, state.bookings, remote, state.catalogVersion]);

  // Field-level Saved marks, and the preview following the owner around. One listener for every editor page,
  // so no page has to wire it up field by field.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const timers = new WeakMap<HTMLElement, number>();
    const touch = () => { lastTouch.current = Date.now(); };
    const onEdit = (e: Event) => {
      touch();
      const t = e.target as HTMLElement | null;
      if (!t || (t as HTMLInputElement).type === "file" || t.closest(".odaddoff, .odsearch, .odchatin, [data-nosave]")) return;
      const host = t.closest<HTMLElement>(".odfield, .odsvc, .odhour, .odaddon");
      if (!host) return;
      host.classList.add("odsaved");
      window.clearTimeout(timers.get(host));
      timers.set(host, window.setTimeout(() => host.classList.remove("odsaved"), 1600));
    };
    const onFocus = (e: FocusEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-jump]");
      const field = el?.dataset.jump?.split(" ")[0] as JumpField | undefined;
      if (field) revealRef.current?.(field);
    };
    body.addEventListener("input", onEdit);
    body.addEventListener("change", onEdit);
    body.addEventListener("pointerdown", touch);
    body.addEventListener("keydown", touch);
    body.addEventListener("focusin", onFocus);
    const top = body.parentElement;
    top?.addEventListener("pointerdown", touch);
    return () => {
      body.removeEventListener("input", onEdit);
      body.removeEventListener("change", onEdit);
      body.removeEventListener("pointerdown", touch);
      body.removeEventListener("keydown", touch);
      body.removeEventListener("focusin", onFocus);
      top?.removeEventListener("pointerdown", touch);
    };
  }, [p?.id, !!u, wantLogin]);

  // Decisions on their way to the API, by booking code. A double tap on Accept used to send the PATCH twice,
  // and the API mails the guest once per PATCH.
  const deciding = useRef(new Map<string, OpStatus>());
  const decide = useCallback((b: OpBooking, status: OpStatus) => {
    if (b.status === status) return;
    if (b.source === "remote" && p) {
      if (deciding.current.get(b.code) === status) return;
      deciding.current.set(b.code, status);
      const was = b.status;
      setRemote((cur) => (cur ? cur.map((x) => (x.code === b.code ? { ...x, status } : x)) : cur));
      void decideBooking(p.id, b.code, status).then((ok) => {
        deciding.current.delete(b.code);
        if (ok) return;
        // The row went back to what it was, straight away, instead of showing "Confirmed" for 45 seconds
        // until the next poll quietly undid it.
        setRemote((cur) => (cur ? cur.map((x) => (x.code === b.code && x.status === status ? { ...x, status: was as RemoteBooking["status"] } : x)) : cur));
        setToastText("Could not save that. Check your connection and try again.");
      });
    } else set((cur) => setBookingStatus(cur, b, status));
    const word: Record<OpStatus, string> = { accepted: "Accepted", declined: "Declined", completed: "Marked complete", noshow: "Marked no-show", cancelled: "Cancelled", new: "Reopened" };
    setToastText(word[status] + " · " + b.guest);
  }, [set, p?.id]);

  const logout = () => {
    signOutApi();
    saveSession(null);
    // A claim link's hash is kept until the claim is done (see AppProvider). Once the owner logs out it is done:
    // leaving `#claim=<id>` in the address bar put them straight back in this dashboard on the next reload.
    if (/^#claim=/i.test(window.location.hash)) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    setSession(null);
    setP(null);
    setOpenedId(null);
    setWantLogin(true);
  };

  /* A signed-in owner whose catalog record has not arrived yet.
     `u` is the listing behind the profile, looked up in a catalog that is fetched after the first paint: 23 MB
     of it, and the dashboard needs it for the cover, the area and the guest preview. Until it lands `u` is null,
     and this screen used to fall straight through to OpLogin, so an owner with a valid session and their own
     saved profile opened the dashboard and was shown the sales pitch and a "Claim your business" search box.
     They are signed in; say so and wait. Once the catalog is complete and the record is genuinely not there,
     the claim screen is the right answer again. */
  if (!wantLogin && p && !u && !state.catalogComplete) {
    return (
      <div className={"odlogin" + (compact ? " compact" : "")}>
        <div className="odlogin-side">
          <button type="button" className="odlogin-brand" onClick={back}>
            <Mark size={30} />
            <b>Outset</b>
            <span>for operators</span>
          </button>
          <h1>Opening {p.title}</h1>
          <p>You are signed in. One moment while we load your listing.</p>
        </div>
        <div className="odlogin-card">
          {/* .odspin is sized, so it needs to be a box: in a plain run of text it collapses to a sliver. */}
          <p className="odmuted" role="status" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="odspin" aria-hidden="true" /> Loading your dashboard…
          </p>
        </div>
      </div>
    );
  }

  if (!p || !u || wantLogin) {
    return (
      <OpLogin
        // After "Log out" or "Claim another business" the owner wants the pick screen, not the claim form for the
        // business their link named (which after a log-out read "Claiming <their own shop>, who's the owner?").
        claimId={wantLogin ? null : state.operatorId}
        claimToken={wantLogin ? null : state.claimToken}
        compact={compact}
        onEnter={(profile) => { setWantLogin(false); enter(profile); }}
        onBack={back}
      />
    );
  }
  const isDemo = isDemoProfile(p);
  const previewShown = !compact && previewOpen && PREVIEW_PAGES.includes(page);

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
      // From a page with nothing to preview beside it, go to the listing with the preview open.
      if (!PREVIEW_PAGES.includes(page)) {
        setPage("listing");
        setOpenedId(null);
        showPreview(true);
        return;
      }
      showPreview(!previewOpen);
    },
    previewOpen: previewShown,
    jump,
    jumpTo,
    toast: setToastText,
    logout,
  };

  const fresh = bookings.filter((b) => b.status === "new").length;
  const opened = openedId ? bookings.find((b) => b.id === openedId) || null : null;
  const title = PAGES.find((x) => x.id === page)?.label || "";

  return (
    <OpCtx.Provider value={api}>
      <div className={"od" + (compact ? " compact" : "") + (previewShown ? " pv" : "")} style={previewShown ? ({ "--pvw": previewWidth + "px" } as React.CSSProperties) : undefined}>
        {!compact ? (
          <OpSidebar
            p={p}
            page={page}
            fresh={fresh}
            isDemo={isDemo}
            go={api.go}
            onBrand={() => { dispatch({ type: "back" }); }}
            onClaim={() => setWantLogin(true)}
            onSwitch={enter}
            onPreview={() => {
              if (!PREVIEW_PAGES.includes(page)) setPage("listing");
              setOpenedId(null);
              showPreview(true);
            }}
            onLogout={logout}
          />
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
              {!compact ? (
                <span className={"odsavedtop" + (savedAt && !signedOut ? " on" : "") + (saveFailed || signedOut ? " failed" : "")} role="status" aria-live="polite">
                  {saveFailed ? <><Markup html={OD_ICONS.x} /> Not saved · storage full</> : signedOut ? <><Markup html={OD_ICONS.x} /> Saved here only · sign in again</> : savedAt ? <><Markup html={OD_ICONS.check} /> Saved</> : "Changes save automatically"}
                </span>
              ) : null}
              {!compact && PREVIEW_PAGES.includes(page) ? (
                <button type="button" className={"odghost odpvtoggle" + (previewOpen ? " on" : "")} onClick={() => showPreview(!previewOpen)} aria-pressed={previewOpen}>
                  <Markup html={OD_ICONS.eye} /> {previewOpen ? "Hide preview" : "Preview"}
                </button>
              ) : null}
              {!p.published ? <span className="odpill off">Hidden from site</span> : null}
              <button type="button" className={"optoggle" + (p.accepting ? " on" : "")} onClick={() => { set({ accepting: !p.accepting }); setToastText(p.accepting ? "Paused. Guests can't book new times." : "Accepting bookings again."); }} aria-pressed={p.accepting}>
                <span className="knob" />
                <span className="lbl">{p.accepting ? "Accepting" : "Paused"}</span>
              </button>
            </div>
          </header>

          <main className="odbody" ref={bodyRef}>
            {/* Both notices live inside the page body. As a direct child of `.od` an `.odnotice` is auto-placed
                by the grid, and `.odmain` holds column two, so it landed in a 248px strip in column one, behind
                the fixed sidebar and below the fold: measured at x 8, width 248, y 473 on a 1440 screen. The
                claim one is the only thing that tells an owner somebody else walked in through a forwarded
                link, and nobody could read it. In the phone frame `.od` is a column, so it was under the tab
                bar there instead. */}
            {claimNotice ? (
              <div className="odnotice">
                <span>
                  <b>This listing was already claimed by {claimNotice.email}</b>
                  <small>
                    {claimNotice.at ? "on " + new Date(claimNotice.at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) + ". " : ""}
                    You are signed in as well, so you can both manage it. If that was not you or someone you work with, write to hello@onoutset.com and we will sort it out.
                  </small>
                </span>
                <button type="button" onClick={() => setClaimNotice(null)} aria-label="Dismiss">Got it</button>
              </div>
            ) : null}
            {signedOut ? (
              <div className="odnotice" role="status">
                <span>
                  <b>Sign in again to publish your changes</b>
                  <small>
                    Outset has signed this device out, so your edits are saved here and are not reaching your listing
                    or your guests, and new booking requests are not coming through either. Sign in with the email on
                    your listing and everything on this device goes up with your next edit.
                  </small>
                </span>
                <button type="button" onClick={() => setWantLogin(true)}>Sign in</button>
              </div>
            ) : null}
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

        {previewShown ? (
          <OpPreview
            id={p.id}
            title={p.title}
            width={previewWidth}
            onWidth={setPreviewWidth}
            onClose={() => showPreview(false)}
            onEdit={jump}
            revealRef={revealRef}
          />
        ) : null}

        {opened ? <BookingDrawer b={opened} onClose={() => setOpenedId(null)} /> : null}
        {toastText ? <div className="odtoast">{toastText}</div> : null}
      </div>
    </OpCtx.Provider>
  );
}
