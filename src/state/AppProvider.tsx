import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { LISTINGS } from "../data/listings";
import { ALL_METRO_ID } from "../data/metros";
import { SLOT_TIMES } from "../data/slots";
import type {
  Booking,
  CategoryId,
  ChatMessage,
  ChatThread,
  Listing,
  ScreenId,
  SheetId,
  TabId,
  Unclaimed,
} from "../data/types";
import { agentReply } from "../lib/agent";
import { dateKey, makeDates } from "../lib/dates";
import { fmtDate, money, nowStamp } from "../lib/format";
import { daySlotsOpen, openSeats } from "../lib/inventory";
import { contactFor, experienceById, fromPrice, initials } from "../lib/catalog";
import { loadListing, loadRemoteCatalog } from "../lib/catalogLoad";
import { confirmPaid, submitBooking } from "../lib/api";
import { companyGreeting, companyReply, companySuggestions } from "../lib/companyAgent";
import type { Place } from "../lib/places";
import { priceFor, priceUnclaimed } from "../lib/pricing";
import { applyStoredProfiles } from "../lib/operator";
import { loadBookings, loadChats, saveBookings, saveChats } from "../lib/storage";

export const DATES = makeDates(10);

export type AppState = {
  hydrated: boolean;
  /** Bumps when the generated catalog finishes loading so lists re-read getCatalog(). */
  catalogVersion: number;
  /** False until the fetched catalog has been merged (or the fetch failed), so the UI can show skeletons instead of seeds. */
  catalogReady: boolean;
  tab: TabId;
  screen: ScreenId;
  cat: CategoryId;
  q: string;
  metroId: string;
  /** Place picked in the Where box. Distances on cards and listing pages are measured from here. */
  near: Place | null;
  dateIdx: number;
  listingId: string | null;
  slot: string | null;
  qty: number;
  addons: string[];
  booking: Booking | null;
  threadId: string | null;
  bookings: Booking[];
  chats: Record<string, ChatMessage[]>;
  reqTargetId: string | null;
  /** Operator whose dashboard is open. null picks a demo operator. */
  operatorId: string | null;
  /** Token from a signed claim link, checked against the listing's claimKey. */
  claimToken: string | null;
  /** Listing an owner arrived at from a "remove my listing" link. */
  removeId: string | null;
  sheet: SheetId;
  toast: string | null;
};

type Action =
  | { type: "hydrate"; bookings: Booking[]; chats: Record<string, ChatMessage[]> }
  | { type: "catalogLoaded"; added: number }
  | { type: "catalogTouched" }
  | { type: "tab"; tab: TabId }
  | { type: "goto"; tab: TabId }
  | { type: "cat"; cat: CategoryId }
  | { type: "q"; q: string }
  | { type: "metro"; metroId: string }
  | { type: "near"; near: Place | null }
  | { type: "openMetro" }
  | { type: "date"; dateIdx: number }
  | { type: "openListing"; id: string }
  | { type: "slot"; slot: string }
  | { type: "qty"; delta: number }
  | { type: "addon"; id: string }
  | { type: "openReview" }
  | { type: "openRequest"; id: string }
  | { type: "closeSheet" }
  | { type: "confirm" }
  | {
      type: "confirmUnclaimed";
      dateIdx: number;
      slot: string;
      qty: number;
      optionIdx: number | null;
      addonIdx?: number[];
      guest?: { name: string; phone: string; email?: string };
    }
  | { type: "back" }
  | { type: "openChat"; id: string }
  | { type: "openOperator"; id?: string; token?: string }
  | { type: "ensureThread"; id: string }
  | { type: "removeRequest"; id: string | null }
  | { type: "paidReturn"; code: string }
  | { type: "sendChat"; text: string }
  | { type: "toastOff" };

function listingById(id: string | null): Listing | null {
  if (!id) return null;
  return LISTINGS.find((l) => l.id === id) ?? null;
}

function threadFor(id: string | null): ChatThread | null {
  const l = listingById(id);
  if (l) {
    return {
      id: l.id,
      kind: "listing",
      name: l.op,
      initials: l.opInit,
      line: l.title + " · " + money(l.price) + "/" + l.unit + " · " + l.launch,
      suggestions: [
        "Do you have " + (l.qtyMax > 2 ? "3" : "2") + " open Saturday around 11?",
        "What's actually included in the price?",
        "What happens if the weather turns?",
        "Is this OK for a total first-timer?",
      ],
    };
  }
  const u = experienceById(id);
  if (!u) return null;
  const from = fromPrice(u);
  return {
    id: u.id,
    kind: "company",
    name: u.title,
    initials: initials(u.title),
    line: u.area + (from != null ? " · from " + money(from) : "") + " · Answers only from published info",
    suggestions: companySuggestions({ item: u, contact: contactFor(u) }),
  };
}

function greeting(l: Listing): ChatMessage {
  return {
    who: "them",
    t: l.op + " - you're talking to our booking agent. Ask about availability, pricing, or what to bring.",
    at: "now",
  };
}

function makeCode(opInit: string): string {
  return (opInit + "-" + Math.random().toString(36).slice(2, 6) + Math.floor(Math.random() * 90 + 10)).toUpperCase();
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "hydrate":
      return { ...state, hydrated: true, bookings: action.bookings, chats: action.chats };
    case "catalogLoaded":
      return { ...state, catalogReady: true, catalogVersion: action.added ? state.catalogVersion + 1 : state.catalogVersion };
    case "catalogTouched":
      return { ...state, catalogVersion: state.catalogVersion + 1 };
    case "tab":
      return { ...state, tab: action.tab, screen: action.tab };
    case "goto":
      return { ...state, tab: action.tab, screen: action.tab };
    case "cat":
      return { ...state, cat: action.cat };
    case "q":
      return { ...state, q: action.q };
    case "metro":
      return { ...state, metroId: action.metroId, near: null, sheet: null };
    case "near":
      return { ...state, near: action.near, metroId: action.near ? ALL_METRO_ID : state.metroId };
    case "openMetro":
      return { ...state, sheet: "metro" };
    case "date":
      return { ...state, dateIdx: action.dateIdx, slot: null };
    case "openListing":
      return {
        ...state,
        listingId: action.id,
        screen: "detail",
        slot: null,
        qty: 1,
        addons: [],
      };
    case "slot": {
      const listing = listingById(state.listingId);
      const next = state.slot === action.slot ? null : action.slot;
      let qty = state.qty;
      if (next && listing) {
        const n = openSeats(listing, dateKey(DATES[state.dateIdx]), next, state.bookings);
        qty = Math.min(state.qty, Math.max(1, n));
      }
      return { ...state, slot: next, qty };
    }
    case "qty": {
      const listing = listingById(state.listingId);
      if (!listing) return state;
      const seats = state.slot
        ? openSeats(listing, dateKey(DATES[state.dateIdx]), state.slot, state.bookings)
        : listing.qtyMax;
      const qty = Math.max(1, Math.min(Math.max(1, seats), state.qty + action.delta));
      return { ...state, qty };
    }
    case "addon": {
      const addons = state.addons.includes(action.id)
        ? state.addons.filter((x) => x !== action.id)
        : state.addons.concat(action.id);
      return { ...state, addons };
    }
    case "openReview":
      if (!state.slot) return state;
      return { ...state, sheet: "review" };
    case "openRequest":
      return { ...state, reqTargetId: action.id, sheet: "request" };
    case "closeSheet":
      return { ...state, sheet: null };
    case "confirm": {
      const listing = listingById(state.listingId);
      if (!listing || !state.slot) return state;
      const p = priceFor(listing, state.qty, state.addons);
      const booking: Booking = {
        listing: listing.id,
        date: dateKey(DATES[state.dateIdx]),
        slot: state.slot,
        qty: state.qty,
        addons: state.addons.slice(),
        total: p.total,
        code: makeCode(listing.opInit),
        created: Date.now(),
      };
      return {
        ...state,
        booking,
        bookings: [booking, ...state.bookings],
        sheet: null,
        screen: "confirm",
        toast: "Confirmed - " + booking.code,
      };
    }
    case "confirmUnclaimed": {
      const u = experienceById(state.reqTargetId);
      if (!u || !action.slot) return state;
      const picked = action.optionIdx != null ? u.options[action.optionIdx] : null;
      if (u.options.length > 0 && !picked) return state;
      const extras = (action.addonIdx || []).map((i) => (u.addons || [])[i]).filter(Boolean);
      const p = priceUnclaimed(picked, action.qty, extras);
      const booking: Booking = {
        listing: u.id,
        date: dateKey(DATES[action.dateIdx]),
        slot: action.slot,
        qty: action.qty,
        addons: [...(picked ? [String(action.optionIdx)] : []), ...extras.map((a) => a.name)],
        total: p.total,
        code: makeCode(initials(u.title)),
        created: Date.now(),
        guest: action.guest,
      };
      return {
        ...state,
        booking,
        bookings: [booking, ...state.bookings],
        sheet: null,
        screen: "confirm",
        toast: "Confirmed - " + booking.code,
      };
    }
    case "back": {
      if (state.screen === "operator") return { ...state, screen: "account" };
      if (state.screen === "chat") {
        return { ...state, screen: state.tab === "inbox" ? "inbox" : state.tab };
      }
      return { ...state, screen: state.tab };
    }
    case "removeRequest":
      return { ...state, removeId: action.id };
    case "paidReturn": {
      const booking = state.bookings.find((b) => b.code === action.code);
      if (!booking) return state;
      const paid = { ...booking, paid: true };
      return { ...state, booking: paid, bookings: state.bookings.map((b) => (b.code === action.code ? paid : b)), sheet: null, screen: "confirm", toast: "Payment received - " + action.code };
    }
    case "ensureThread": {
      const company = experienceById(action.id);
      if (!company) return state;
      if (state.chats[company.id]) return state.threadId === company.id ? state : { ...state, threadId: company.id };
      const hello: ChatMessage = { who: "them", t: companyGreeting({ item: company, contact: contactFor(company) }), at: "now" };
      return { ...state, threadId: company.id, chats: { ...state.chats, [company.id]: [hello] } };
    }
    case "openOperator":
      return { ...state, tab: "account", screen: "operator", sheet: null, reqTargetId: null, operatorId: action.id ?? state.operatorId, claimToken: action.token ?? (action.id ? null : state.claimToken) };
    case "openChat": {
      const listing = listingById(action.id);
      if (listing) {
        const chats = state.chats[listing.id]
          ? state.chats
          : { ...state.chats, [listing.id]: [greeting(listing)] };
        return { ...state, threadId: listing.id, chats, screen: "chat" };
      }
      const company = experienceById(action.id);
      if (!company) return state;
      const hello: ChatMessage = { who: "them", t: companyGreeting({ item: company, contact: contactFor(company) }), at: "now" };
      const chats = state.chats[company.id] ? state.chats : { ...state.chats, [company.id]: [hello] };
      return { ...state, threadId: company.id, chats, sheet: null, reqTargetId: null, screen: "chat" };
    }
    case "sendChat": {
      const company = experienceById(state.threadId);
      if (company) {
        const at = nowStamp();
        const prev = (state.chats[company.id] || []).slice();
        prev.push({ who: "me", t: action.text, at });
        prev.push({ who: "them", t: companyReply({ item: company, contact: contactFor(company) }, action.text), at });
        return { ...state, chats: { ...state.chats, [company.id]: prev } };
      }
      const listing = listingById(state.threadId);
      if (!listing) return state;
      const dk = dateKey(DATES[state.dateIdx]);
      const slots = SLOT_TIMES.map((time) => ({
        time,
        open: openSeats(listing, dk, time, state.bookings),
      }));
      const nextDays = DATES.slice(0, 4).map((d) => ({
        label: fmtDate(d),
        openSlots: daySlotsOpen(listing, dateKey(d), state.bookings),
      }));
      const at = nowStamp();
      const prev = (state.chats[listing.id] || []).slice();
      prev.push({ who: "me", t: action.text, at });
      const reply = agentReply(listing, action.text, {
        dateLabel: fmtDate(DATES[state.dateIdx]),
        slots,
        nextDays,
      });
      prev.push({ who: "them", t: reply, at });
      return { ...state, chats: { ...state.chats, [listing.id]: prev } };
    }
    case "toastOff":
      return { ...state, toast: null };
    default:
      return state;
  }
}

const initial: AppState = {
  hydrated: false,
  catalogVersion: 0,
  catalogReady: false,
  tab: "explore",
  screen: "explore",
  cat: "all",
  q: "",
  metroId: ALL_METRO_ID,
  near: null,
  dateIdx: 0,
  listingId: null,
  slot: null,
  qty: 1,
  addons: [],
  booking: null,
  threadId: null,
  bookings: [],
  chats: {},
  reqTargetId: null,
  operatorId: null,
  claimToken: null,
  removeId: null,
  sheet: null,
  toast: null,
};

type Api = {
  state: AppState;
  dates: Date[];
  listing: Listing | null;
  thread: ChatThread | null;
  reqTarget: Unclaimed | null;
  dispatch: (a: Action) => void;
  setTab: (tab: TabId) => void;
  setCat: (cat: CategoryId) => void;
  setQ: (q: string) => void;
  setMetro: (metroId: string) => void;
  setNear: (near: Place | null) => void;
  openMetro: () => void;
  setDate: (i: number) => void;
  openListing: (id: string) => void;
  setSlot: (slot: string) => void;
  bumpQty: (delta: number) => void;
  toggleAddon: (id: string) => void;
  openReview: () => void;
  openRequest: (id: string) => void;
  closeSheet: () => void;
  confirm: () => void;
  confirmUnclaimed: (input: { dateIdx: number; slot: string; qty: number; optionIdx: number | null; addonIdx?: number[]; guest?: { name: string; phone: string; email?: string } }) => void;
  back: () => void;
  openChat: (id: string) => void;
  openOperator: (id?: string) => void;
  ensureThread: (id: string) => void;
  sendChat: (text: string) => void;
  goto: (tab: TabId) => void;
  /** Re-render catalog lists after an operator saves edits. */
  touchCatalog: () => void;
};

const Ctx = createContext<Api | null>(null);


/** True when the URL is the operator side, wherever the site is mounted (/operators or a subpath /operators). */
function atOperatorsPath(): boolean {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, "/");
  return window.location.pathname === base + "operators" || window.location.pathname === base + "operators/";
}

export function AppProvider({ children }: { children: ReactNode }) {
  // A direct load of /operators is the operator side from the first paint, not the guest home for a second.
  const [state, dispatch] = useReducer(reducer, initial, (init) => {
    if (typeof window === "undefined") return init;
    // A claim link names the business in the hash. Seed it now so the operator screen mounts with it on the first
    // render, instead of falling back to the demo dashboard and switching a second later.
    const c = window.location.hash.match(/^#claim=([a-z0-9-]+)(?:&k=([A-Za-z0-9_-]+))?/i);
    if (c) return { ...init, screen: "operator" as const, tab: "account" as const, operatorId: c[1], claimToken: c[2] || null };
    return atOperatorsPath() ? { ...init, screen: "operator" as const, tab: "account" as const } : init;
  });
  const stateRef = useRef(state);
  stateRef.current = state;

  // True once the boot deep-link check has run. Until then the path-sync effect must not rewrite the URL,
  // or the lite catalog shard flipping catalogReady early would erase a #claim= link before it is read.
  const booted = useRef(false);

  useEffect(() => {
    dispatch({ type: "hydrate", bookings: loadBookings(), chats: loadChats() });
    let alive = true;
    // The operator side is decided from the path and hash alone, before any catalog arrives, so an emailed
    // claim link opens the dashboard on the first paint and never gets rewritten to the guest home.
    const early = window.location.hash.match(/^#claim=([a-z0-9-]+)(?:&k=([A-Za-z0-9_-]+))?/i);
    if (early) dispatch({ type: "openOperator", id: early[1], token: early[2] || undefined });
    else if (atOperatorsPath()) dispatch({ type: "openOperator" });
    loadRemoteCatalog((n, complete) => {
      // The lite shard paints the rails early; the full catalog replaces it a moment later.
      if (alive && !complete) dispatch({ type: "catalogLoaded", added: n });
    }).then((added) => {
      if (!alive) return;
      // Claimed operators' edits (prices, photos, published switch) layer over the scraped records.
      const edited = applyStoredProfiles();
      dispatch({ type: "catalogLoaded", added: added + edited });
      // Deep link: #o=<operator id> opens that listing directly.
      const m = window.location.hash.match(/^#o=([a-z0-9-]+)/i);
      if (m && experienceById(m[1])) {
        dispatch({ type: "openRequest", id: m[1] });
        loadListing(m[1]).then((changed) => changed && dispatch({ type: "catalogLoaded", added: 1 }));
      }
      const r = window.location.hash.match(/^#remove=([a-z0-9-]+)/i);
      const target = r ? experienceById(r[1]) : null;
      if (r && target) {
        dispatch({ type: "removeRequest", id: target.id });
        dispatch({ type: "openRequest", id: target.id });
        loadListing(target.id).then((changed) => changed && dispatch({ type: "catalogLoaded", added: 1 }));
      }
      // Back from Stripe: #paid=<code>&o=<listing>. Confirm with the API, then show the confirmation page.
      const pd = window.location.hash.match(/^#paid=([A-Z0-9-]+)&o=([a-z0-9-]+)/i);
      if (pd) {
        const code = pd[1].toUpperCase();
        loadListing(pd[2]).then((changed) => changed && dispatch({ type: "catalogLoaded", added: 1 }));
        dispatch({ type: "paidReturn", code });
        void confirmPaid(pd[2], code).then((r) => { if (r.paid) dispatch({ type: "paidReturn", code }); });
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
      const c = window.location.hash.match(/^#claim=([a-z0-9-]+)(?:&k=([A-Za-z0-9_-]+))?/i);
      if (c && experienceById(c[1])) {
        // Already on the operator screen from the early check; now the record exists, fetch its details.
        loadListing(c[1]).then((changed) => changed && dispatch({ type: "catalogLoaded", added: 1 }));
      }
      // Consume a listing or remove link so a reload lands on the home page. A claim link keeps its hash:
      // the operator screen reads it and the URL should survive a refresh until the claim is done.
      if (r) window.history.replaceState(null, "", window.location.pathname + window.location.search);
      booted.current = true;
      // A listing link pasted while the app is already open should still open that listing.
      window.addEventListener("hashchange", () => {
        const h = window.location.hash.match(/^#o=([a-z0-9-]+)/i);
        if (!h || !experienceById(h[1])) return;
        if (stateRef.current.sheet === "request" && stateRef.current.reqTargetId === h[1]) return;
        dispatch({ type: "openRequest", id: h[1] });
        loadListing(h[1]).then((changed) => changed && dispatch({ type: "catalogLoaded", added: 1 }));
      });
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!state.hydrated) return;
    saveBookings(state.bookings);
  }, [state.bookings, state.hydrated]);

  useEffect(() => {
    if (!state.hydrated) return;
    saveChats(state.chats);
  }, [state.chats, state.hydrated]);

  // The open listing lives in the address bar as #o=<id>, so refresh, back and share land on the same listing.
  useEffect(() => {
    if (!booted.current || state.screen === "operator") return;
    const cur = window.location.hash;
    if (state.sheet === "request" && state.reqTargetId) {
      const want = "#o=" + state.reqTargetId;
      if (cur !== want) window.history.replaceState(null, "", window.location.pathname + window.location.search + want);
    } else if (/^#o=/.test(cur)) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, [state.sheet, state.reqTargetId, state.screen]);

  useEffect(() => {
    const onOps = state.screen === "operator";
    const atOps = atOperatorsPath();
    // Build operator paths on BASE_URL so a subpath deploy still works. Production is the site root.
    const base = import.meta.env.BASE_URL.replace(/\/?$/, "/");
    if (onOps && !atOps) window.history.pushState(null, "", base + "operators" + window.location.hash);
    else if (!onOps && atOps && booted.current) window.history.pushState(null, "", base + window.location.hash.replace(/^#claim=.*$/, ""));
  }, [state.screen, state.catalogReady]);

  useEffect(() => {
    const onPop = () => {
      const atOps = atOperatorsPath();
      if (atOps && state.screen !== "operator") dispatch({ type: "openOperator" });
      if (!atOps && state.screen === "operator") dispatch({ type: "back" });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [state.screen]);

  useEffect(() => {
    if (!state.toast) return;
    const t = window.setTimeout(() => dispatch({ type: "toastOff" }), 2600);
    return () => window.clearTimeout(t);
  }, [state.toast]);

  const listing = listingById(state.listingId);
  const thread = threadFor(state.threadId);
  const reqTarget = experienceById(state.reqTargetId);

  const api = useMemo<Api>(
    () => ({
      state,
      dates: DATES,
      listing,
      thread,
      reqTarget,
      dispatch,
      setTab: (tab) => dispatch({ type: "tab", tab }),
      setCat: (cat) => dispatch({ type: "cat", cat }),
      setQ: (q) => dispatch({ type: "q", q }),
      setMetro: (metroId) => dispatch({ type: "metro", metroId }),
      setNear: (near) => dispatch({ type: "near", near }),
      openMetro: () => dispatch({ type: "openMetro" }),
      setDate: (dateIdx) => dispatch({ type: "date", dateIdx }),
      openListing: (id) => dispatch({ type: "openListing", id }),
      setSlot: (slot) => dispatch({ type: "slot", slot }),
      bumpQty: (delta) => dispatch({ type: "qty", delta }),
      toggleAddon: (id) => dispatch({ type: "addon", id }),
      openReview: () => dispatch({ type: "openReview" }),
      openRequest: (id) => {
        dispatch({ type: "openRequest", id });
        loadListing(id).then((changed) => changed && dispatch({ type: "catalogLoaded", added: 1 }));
      },
      closeSheet: () => dispatch({ type: "closeSheet" }),
      confirm: () => dispatch({ type: "confirm" }),
      confirmUnclaimed: (input) => {
        dispatch({ type: "confirmUnclaimed", ...input });
        // The request also goes to the operator through the API: email to them, a row in their dashboard.
        const u = experienceById(stateRef.current.reqTargetId);
        const booking = stateRef.current.bookings[0];
        if (!u || !input.slot) return;
        const picked = input.optionIdx != null ? u.options[input.optionIdx] : null;
        const extras = (input.addonIdx || []).map((i) => (u.addons || [])[i]).filter(Boolean);
        window.setTimeout(() => {
          const b = stateRef.current.bookings[0];
          if (!b || b === booking) return;
          void submitBooking({
            code: b.code, listing: u.id, date: b.date, slot: b.slot, qty: b.qty,
            service: picked?.name || u.title, variant: picked?.detail || "", addons: extras.map((a) => a.name), total: b.total || null,
            guest: { name: input.guest?.name || "", phone: input.guest?.phone || "", email: input.guest?.email || "" },
          }).then((r) => {
            // Card on file: Stripe's hosted page takes over, then sends the guest back to #paid=<code>.
            if (r.checkoutUrl) window.location.assign(r.checkoutUrl);
          });
        }, 0);
      },
      back: () => dispatch({ type: "back" }),
      openChat: (id) => dispatch({ type: "openChat", id }),
      openOperator: (id) => {
        dispatch({ type: "openOperator", id });
        loadListing(id ?? null).then((changed) => changed && dispatch({ type: "catalogLoaded", added: 1 }));
      },
      ensureThread: (id) => dispatch({ type: "ensureThread", id }),
      sendChat: (text) => dispatch({ type: "sendChat", text }),
      goto: (tab) => dispatch({ type: "goto", tab }),
      touchCatalog: () => dispatch({ type: "catalogTouched" }),
    }),
    [state, listing, thread, reqTarget],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useApp(): Api {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must run inside AppProvider");
  return v;
}
