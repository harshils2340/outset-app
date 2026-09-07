import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from "react";
import { LISTINGS } from "../data/listings";
import { UNCLAIMED } from "../data/unclaimed";
import { SEED_CHATS } from "../data/seedChats";
import { SLOT_TIMES } from "../data/slots";
import type {
  Booking,
  CategoryId,
  ChatMessage,
  Listing,
  ScreenId,
  SheetId,
  TabId,
  Unclaimed,
} from "../data/types";
import { agentReply } from "../lib/agent";
import { dateKey, makeDates } from "../lib/dates";
import { fmtDate, nowStamp } from "../lib/format";
import { daySlotsOpen, openSeats } from "../lib/inventory";
import { priceFor } from "../lib/pricing";
import { loadBookings, loadChats, saveBookings, saveChats } from "../lib/storage";

export const DATES = makeDates(10);

export type AppState = {
  hydrated: boolean;
  tab: TabId;
  screen: ScreenId;
  cat: CategoryId;
  q: string;
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
  sheet: SheetId;
  toast: string | null;
};

type Action =
  | { type: "hydrate"; bookings: Booking[]; chats: Record<string, ChatMessage[]> }
  | { type: "tab"; tab: TabId }
  | { type: "goto"; tab: TabId }
  | { type: "cat"; cat: CategoryId }
  | { type: "q"; q: string }
  | { type: "date"; dateIdx: number }
  | { type: "openListing"; id: string }
  | { type: "slot"; slot: string }
  | { type: "qty"; delta: number }
  | { type: "addon"; id: string }
  | { type: "openReview" }
  | { type: "openRequest"; id: string }
  | { type: "closeSheet" }
  | { type: "confirm" }
  | { type: "sendRequest"; note: string }
  | { type: "back" }
  | { type: "openChat"; id: string }
  | { type: "sendChat"; text: string }
  | { type: "toastOff" };

function listingById(id: string | null): Listing | null {
  if (!id) return null;
  return LISTINGS.find((l) => l.id === id) ?? null;
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
    case "tab":
      return { ...state, tab: action.tab, screen: action.tab };
    case "goto":
      return { ...state, tab: action.tab, screen: action.tab };
    case "cat":
      return { ...state, cat: action.cat };
    case "q":
      return { ...state, q: action.q };
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
    case "sendRequest": {
      const u = UNCLAIMED.find((x) => x.id === state.reqTargetId);
      const extra = action.note.trim() ? " (" + action.note.trim() + ")" : "";
      return {
        ...state,
        sheet: null,
        toast: "Sent - we'll text " + (u ? u.title : "them") + extra + " and let you know.",
      };
    }
    case "back": {
      if (state.screen === "chat") {
        return { ...state, screen: state.tab === "inbox" ? "inbox" : state.tab };
      }
      return { ...state, screen: state.tab };
    }
    case "openChat": {
      const listing = listingById(action.id);
      if (!listing) return state;
      const chats = state.chats[listing.id]
        ? state.chats
        : { ...state.chats, [listing.id]: [greeting(listing)] };
      return { ...state, threadId: listing.id, chats, screen: "chat" };
    }
    case "sendChat": {
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
  tab: "explore",
  screen: "explore",
  cat: "all",
  q: "",
  dateIdx: 0,
  listingId: null,
  slot: null,
  qty: 1,
  addons: [],
  booking: null,
  threadId: null,
  bookings: [],
  chats: structuredClone(SEED_CHATS),
  reqTargetId: null,
  sheet: null,
  toast: null,
};

type Api = {
  state: AppState;
  dates: Date[];
  listing: Listing | null;
  thread: Listing | null;
  reqTarget: Unclaimed | null;
  dispatch: (a: Action) => void;
  setTab: (tab: TabId) => void;
  setCat: (cat: CategoryId) => void;
  setQ: (q: string) => void;
  setDate: (i: number) => void;
  openListing: (id: string) => void;
  setSlot: (slot: string) => void;
  bumpQty: (delta: number) => void;
  toggleAddon: (id: string) => void;
  openReview: () => void;
  openRequest: (id: string) => void;
  closeSheet: () => void;
  confirm: () => void;
  sendRequest: (note: string) => void;
  back: () => void;
  openChat: (id: string) => void;
  sendChat: (text: string) => void;
  goto: (tab: TabId) => void;
};

const Ctx = createContext<Api | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);

  useEffect(() => {
    dispatch({ type: "hydrate", bookings: loadBookings(), chats: loadChats() });
  }, []);

  useEffect(() => {
    if (!state.hydrated) return;
    saveBookings(state.bookings);
  }, [state.bookings, state.hydrated]);

  useEffect(() => {
    if (!state.hydrated) return;
    saveChats(state.chats);
  }, [state.chats, state.hydrated]);

  useEffect(() => {
    if (!state.toast) return;
    const t = window.setTimeout(() => dispatch({ type: "toastOff" }), 2600);
    return () => window.clearTimeout(t);
  }, [state.toast]);

  const listing = listingById(state.listingId);
  const thread = listingById(state.threadId);
  const reqTarget = UNCLAIMED.find((u) => u.id === state.reqTargetId) ?? null;

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
      setDate: (dateIdx) => dispatch({ type: "date", dateIdx }),
      openListing: (id) => dispatch({ type: "openListing", id }),
      setSlot: (slot) => dispatch({ type: "slot", slot }),
      bumpQty: (delta) => dispatch({ type: "qty", delta }),
      toggleAddon: (id) => dispatch({ type: "addon", id }),
      openReview: () => dispatch({ type: "openReview" }),
      openRequest: (id) => dispatch({ type: "openRequest", id }),
      closeSheet: () => dispatch({ type: "closeSheet" }),
      confirm: () => dispatch({ type: "confirm" }),
      sendRequest: (note) => dispatch({ type: "sendRequest", note }),
      back: () => dispatch({ type: "back" }),
      openChat: (id) => dispatch({ type: "openChat", id }),
      sendChat: (text) => dispatch({ type: "sendChat", text }),
      goto: (tab) => dispatch({ type: "goto", tab }),
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
