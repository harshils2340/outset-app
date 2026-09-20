import { warmCheckout } from "../lib/stripeJs";
import { guessPlace, ipGuessFitsClock, metroFromTimeZone, opening, openingFeed, rememberCoords, rememberMetro, rememberPlace, sameGuess, shouldLocate, type Opening } from "../lib/here";
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
import { loadListing, loadRemoteCatalog, onListingEdits } from "../lib/catalogLoad";
import { confirmPaid, hasApi, loadWalletId, submitBooking, warmApi , apiConfig } from "../lib/api";
import { assistantOn, companyGreeting, companyHandoff, companyReply, companySuggestions } from "../lib/companyAgent";
import { currentLocation, type Place } from "../lib/places";
import { priceFor, priceUnclaimed } from "../lib/pricing";
import { applyStoredProfiles } from "../lib/operator";
import { loadBookings, loadChats, saveBookings, saveChats } from "../lib/storage";
import { isHttpsUrlOnHost } from "../lib/urlSafety";

export const DATES = makeDates(10);

export type AppState = {
  hydrated: boolean;
  /** Bumps when the generated catalog finishes loading so lists re-read getCatalog(). */
  catalogVersion: number;
  /** False until the fetched catalog has been merged (or the fetch failed), so the UI can show skeletons instead of seeds. */
  catalogReady: boolean;
  /**
   * False until the whole catalog has been tried, not just the lite shard `catalogReady` flips on. A screen
   * that looks operators up by id has to wait for this one: most ids are only in the full file, so until it
   * lands an id that resolves to nothing may just be one we have not reached yet.
   */
  catalogComplete: boolean;
  tab: TabId;
  screen: ScreenId;
  cat: CategoryId;
  q: string;
  metroId: string;
  /** Place picked in the Where box. Distances on cards and listing pages are measured from here. */
  near: Place | null;
  /**
   * True while the home is waiting on GPS. A clock metro is not a pin, so the rails stay as skeletons rather
   * than painting Toronto for a guest standing in Waterloo. False once a fix lands, or once the browser refuses
   * and the clock city is used as the fallback.
   */
  locating: boolean;
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
  /** A paid booking has been sent and the card step is up: Stripe's form inside the page, or its hosted page. */
  checkingOut: boolean;
  /** The embedded checkout session to mount, when the API returned one; null means the hosted page takes over. */
  checkoutSecret: string | null;
  /** Listing an owner arrived at from a "remove my listing" link. */
  removeId: string | null;
  sheet: SheetId;
  toast: string | null;
  /**
   * Ask Outset, the one agent surface in the product. `null` is closed; a string is open, and a non-empty one
   * is asked the moment it opens. Held here rather than as local state in `App.tsx` so any screen (a listing,
   * the booking sheet) can open the same overlay instead of building its own chat.
   */
  asking: string | null;
};

type Action =
  | { type: "hydrate"; bookings: Booking[]; chats: Record<string, ChatMessage[]> }
  | { type: "catalogLoaded"; added: number; complete?: boolean }
  | { type: "catalogTouched" }
  | { type: "tab"; tab: TabId }
  | { type: "goto"; tab: TabId }
  | { type: "cat"; cat: CategoryId }
  | { type: "q"; q: string }
  | { type: "metro"; metroId: string }
  | { type: "near"; near: Place | null }
  | { type: "located" }
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
      listing?: string;
      dateIdx: number;
      /** The listing date as YYYY-MM-DD. Wins over `dateIdx` when the concierge booked a day outside the 10-day strip. */
      date?: string;
      slot: string;
      qty: number;
      optionIdx: number | null;
      addonIdx?: number[];
      guest?: { name: string; phone: string; email?: string };
      /** Live calendar price, when the guest booked a time the shop published rather than a menu row. */
      service?: string;
      total?: number | null;
      /** A card step follows: stay on the listing behind a splash instead of showing the confirmation. */
      pay?: boolean;
      /** Stripe's embedded checkout client secret, when the form mounts in the page. */
      checkoutSecret?: string;
      /** The code the API already accepted, so the ticket on screen matches the operator's email. */
      code?: string;
      /** The card is held or charged through Stripe. */
      paid?: boolean;
    }
  | { type: "checkoutDone" }
  | { type: "toast"; text: string }
  | { type: "back" }
  | { type: "openChat"; id: string }
  | { type: "openOperator"; id?: string; token?: string }
  | { type: "removeRequest"; id: string | null }
  | { type: "paidReturn"; code: string }
  | { type: "sendChat"; text: string }
  | { type: "toastOff" }
  | { type: "openAsk"; seed: string }
  | { type: "closeAsk" };

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
      return { ...state, catalogReady: true, catalogComplete: state.catalogComplete || !!action.complete, catalogVersion: action.added ? state.catalogVersion + 1 : state.catalogVersion };
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
      return { ...state, metroId: action.metroId, near: null, locating: false, sheet: null };
    case "near":
      return { ...state, near: action.near, metroId: action.near ? ALL_METRO_ID : state.metroId, locating: false };
    case "located":
      return { ...state, locating: false };
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
      // A listing opened from the confirmation page (a link, the browser's back button) leaves that page behind.
      return { ...state, reqTargetId: action.id, sheet: "request", screen: state.screen === "confirm" ? state.tab : state.screen };
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
      const u = experienceById(action.listing || state.reqTargetId);
      if (!u || !action.slot) return state;
      const picked = action.optionIdx != null ? u.options[action.optionIdx] : null;
      if (action.optionIdx != null && u.options.length > 0 && !picked) return state;
      const extras = (action.addonIdx || []).map((i) => (u.addons || [])[i]).filter(Boolean);
      const p = priceUnclaimed(picked, action.qty, extras);
      const total = action.total != null && Number.isFinite(action.total) ? action.total : p.total;
      const booking: Booking = {
        listing: u.id,
        date: action.date && /^\d{4}-\d{2}-\d{2}$/.test(action.date) ? action.date : dateKey(DATES[action.dateIdx]),
        slot: action.slot,
        qty: action.qty,
        addons: [...(picked ? [String(action.optionIdx)] : []), ...extras.map((a) => a.name)],
        total,
        service: action.service || picked?.name || u.title,
        variant: picked?.detail || "",
        price: picked?.price ?? (action.total != null ? action.total : null),
        per: picked?.per,
        code: action.code || makeCode(initials(u.title)),
        created: Date.now(),
        guest: action.guest,
        paid: action.paid,
      };
      // With a card step ahead the guest stays on the listing behind a "sending you to checkout" screen; the
      // confirmation only shows if Stripe does not take over (see checkoutDone).
      if (action.pay) return { ...state, booking, bookings: [booking, ...state.bookings], checkingOut: true, checkoutSecret: action.checkoutSecret || null };
      return {
        ...state,
        booking,
        bookings: [booking, ...state.bookings],
        sheet: null,
        screen: "confirm",
        toast: (u.claimed && u.instant ? "Confirmed - " : "Request sent - ") + booking.code,
      };
    }
    case "checkoutDone":
      // The guest is back on the listing without having paid: take the splash down and leave them exactly where
      // they were, on the booking box they can use again. No confirmation, because the card step never
      // happened: the row the API holds is `pending`, which the operator's dashboard does not even list, so
      // "Request sent" would name a request nobody at the shop can see. Trips already calls it "Payment not
      // finished".
      return state.checkingOut ? { ...state, checkingOut: false, checkoutSecret: null } : state;
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
      // An assistant the shop switched off does not greet a new guest. A thread opened while it was on still
      // opens, so nobody loses a conversation they were already having; nothing guest-facing starts a new one
      // any more (Ask Outset is the one agent surface), but a returning guest's old thread still reads back.
      if (!assistantOn(company) && !state.chats[company.id]) return state;
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
        const ctx = { item: company, contact: contactFor(company) };
        // Switched off since this thread opened: Otto stops answering and says who does, rather than carrying
        // on quoting a shop that asked it to stop.
        prev.push({ who: "them", t: assistantOn(company) ? companyReply(ctx, action.text) : companyHandoff(ctx), at });
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
    case "toast":
      return { ...state, toast: action.text };
    case "toastOff":
      return { ...state, toast: null };
    // Whatever else was open (a listing sheet, filters) closes with it: the agent is the one thing on screen
    // while it is up, never a panel over another panel.
    case "openAsk":
      return { ...state, asking: action.seed, sheet: null };
    case "closeAsk":
      return { ...state, asking: null };
    default:
      return state;
  }
}

const initial: AppState = {
  hydrated: false,
  catalogVersion: 0,
  catalogReady: false,
  catalogComplete: false,
  tab: "explore",
  screen: "explore",
  cat: "all",
  q: "",
  metroId: ALL_METRO_ID,
  near: null,
  locating: false,
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
  checkingOut: false,
  checkoutSecret: null,
  removeId: null,
  sheet: null,
  toast: null,
  asking: null,
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
  /**
   * Books a catalog listing. With the API connected the request goes there first and the ticket only shows once
   * the API took it; a time that filled up meanwhile comes back as `taken`, with the error to show. A card
   * booking (`pay`) keeps the listing behind the checkout splash and then leaves for Stripe's page.
   */
  confirmUnclaimed: (input: { listing?: string; dateIdx: number; date?: string; slot: string; qty: number; optionIdx: number | null; addonIdx?: number[]; service?: string; total?: number | null; guest?: { name: string; phone: string; email?: string }; pay?: boolean }) => Promise<{ ok: boolean; error?: string; taken?: boolean; checkoutUrl?: string }>;
  back: () => void;
  /** The guest closed the card form without paying: the listing comes back as it was. */
  cancelCheckout: () => void;
  openChat: (id: string) => void;
  openOperator: (id?: string) => void;
  sendChat: (text: string) => void;
  goto: (tab: TabId) => void;
  /** Re-render catalog lists after an operator saves edits. */
  touchCatalog: () => void;
  /** Open Ask Outset, the one agent surface in the product, seeded with a question when one is already known. */
  openAsk: (seed?: string) => void;
  closeAsk: () => void;
};

const Ctx = createContext<Api | null>(null);


/** True when the URL is the operator side, wherever the site is mounted (/operators or a subpath /operators). */
function atOperatorsPath(): boolean {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, "/");
  return window.location.pathname === base + "operators" || window.location.pathname === base + "operators/";
}

/**
 * The place the home opens on, folded into the state of the very first render.
 *
 * A GPS or typed point is a pin: the rails measure from it. A city the guest picked is their decision. A clock
 * metro is not either of those, so the feed waits (`locating`) rather than drawing Toronto for Waterloo.
 */
function withPlace(init: AppState, open: Opening): AppState {
  const feed = openingFeed(open);
  if (feed.kind === "wait") return { ...init, locating: true };
  if (feed.kind === "point") return { ...init, near: feed.place, locating: false };
  return { ...init, metroId: feed.metroId, locating: false };
}

export function AppProvider({ children }: { children: ReactNode }) {
  /**
   * Where the guest is, settled before the first render and without touching the network. Declared above the
   * reducer because the reducer's initialiser reads it: the whole point is that the first paint is already the
   * right city, so this cannot be a state update that arrives afterwards.
   */
  const open = useRef<Opening | null>(null);
  if (!open.current) open.current = typeof window === "undefined" ? { guess: null, chosen: true, recheck: false } : opening();
  /** Set once the guest picks a place themselves, so a refinement still in flight cannot overrule them. */
  const chose = useRef(open.current.chosen);

  // A direct load of /operators is the operator side from the first paint, not the guest home for a second.
  const [state, dispatch] = useReducer(reducer, initial, (init) => {
    if (typeof window === "undefined") return init;
    // A claim link names the business in the hash. Seed it now so the operator screen mounts with it on the first
    // render, instead of falling back to the demo dashboard and switching a second later.
    const c = window.location.hash.match(/^#claim=([a-z0-9-]+)(?:&k=([A-Za-z0-9_.~-]+))?/i);
    if (c) return { ...init, screen: "operator" as const, tab: "account" as const, operatorId: c[1], claimToken: c[2] || null };
    if (atOperatorsPath()) return { ...init, screen: "operator" as const, tab: "account" as const };
    // Everything from here lands on the guest side, so it opens on the guest's own place, or the last one guessed
    // for them, from the first frame. This used to be decided after the 22 MB catalog had downloaded, parsed and
    // merged, which meant a full set of Anywhere rails painted and then rebuilt itself around a city.
    const base = withPlace(init, open.current!);
    // A listing link (#o=, or #remove= from an outreach email) is that listing from the first paint: the page shows
    // a short "opening" state until the listing's own file lands, never the home page in between.
    const o = window.location.hash.match(/^#(o|remove)=([a-z0-9-]+)/i);
    if (o) return { ...base, sheet: "request" as const, reqTargetId: o[2], removeId: o[1].toLowerCase() === "remove" ? o[2] : base.removeId };
    // Back from Stripe: the booking is already on this device, so the confirmation is the first screen too.
    const pd = window.location.hash.match(/^#paid=([A-Z0-9-]+)&o=([a-z0-9-]+)/i);
    if (pd) {
      const code = pd[1].toUpperCase();
      const booking = loadBookings().find((b) => b.code === code);
      if (booking) return { ...base, screen: "confirm" as const, booking: { ...booking, paid: true }, sheet: null };
    }
    if (/^#wallet\b/i.test(window.location.hash)) return { ...base, tab: "account" as const, screen: "account" as const };
    // `#ask` opens Ask Outset on load, so the answer to "what is actually free tonight" survives a refresh,
    // can be sent to somebody as a link, and can sit behind a QR code.
    const ask = window.location.hash.match(/^#ask(?:=(.*))?$/i);
    if (ask) {
      let seed = "";
      try {
        seed = decodeURIComponent(ask[1] || "");
      } catch {
        seed = "";
      }
      return { ...base, asking: seed };
    }
    return base;
  });
  const stateRef = useRef(state);
  stateRef.current = state;

  /** Is the guest looking at the home? The screen decides, not the URL the visit began on: see `shouldLocate`. */
  const view = { screen: state.screen as string, sheet: state.sheet as string | null };
  /**
   * Once a place has been settled, coming back to the home is not a reason to locate again, or a guest who
   * picked Anywhere and then opened a listing would find themselves back in their own town.
   *
   * It turns true when the browser answers, not when the effect starts: React mounts an effect, tears it down
   * and mounts it again in development, and a flag set on the way in would let only the torn-down run continue.
   * That left the home as two skeleton rails, which is the bug this is here to fix.
   */
  const placed = useRef(false);
  /**
   * GPS is the pin. A clock city is only the fallback when the browser will not give a fix.
   *
   * First paint used to draw the timezone metro so the rails were "local" in one frame. America/Toronto is
   * Waterloo as much as it is Toronto, so that frame was downtown listings for a guest standing in KW. The
   * home now waits, then measures every card from the GPS point. `/where` is still an IP address and only
   * lands when it agrees with the clock.
   */
  useEffect(() => {
    const start = open.current!;
    if (!shouldLocate(view, placed.current)) return;
    const typedTown = start.chosen && start.guess?.kind === "point" && start.guess.place.label !== "Near me";
    if (typedTown) return;
    if (start.chosen && start.guess?.kind === "metro") return;
    let alive = true;
    const apply = (g: NonNullable<typeof start.guess>) => {
      if (!alive || stateRef.current.sheet) return;
      if (chose.current) {
        const n = stateRef.current.near;
        if (n && n.label !== "Near me") return;
        if (!n && stateRef.current.metroId !== ALL_METRO_ID) return;
      }
      if (g.kind === "point") {
        if (sameGuess(g, start.guess)) {
          if (stateRef.current.locating) dispatch({ type: "located" });
          return;
        }
        dispatch({ type: "near", near: g.place });
      } else {
        if (sameGuess(g, start.guess) && !stateRef.current.locating) return;
        dispatch({ type: "metro", metroId: g.metroId });
      }
    };
    void (async () => {
      const pt = await currentLocation();
      // An answer either way, including a refusal, is this visit's answer.
      placed.current = true;
      if (!alive) return;
      if (pt) {
        apply(rememberCoords(pt.lat, pt.lon));
        return;
      }
      // No fix. A clock city is the fallback, labelled as that city, not a 40 km circle on an IP centroid.
      const zone = metroFromTimeZone();
      const clock = start.guess;
      if (clock?.kind === "metro") {
        apply(clock);
        return;
      }
      if (zone) {
        dispatch({ type: "metro", metroId: zone });
        return;
      }
      if (!start.recheck) {
        dispatch({ type: "located" });
        return;
      }
      const g = await guessPlace();
      if (!alive) return;
      if (!g || !ipGuessFitsClock(g, metroFromTimeZone())) {
        dispatch({ type: "located" });
        return;
      }
      apply(g);
    })();
    return () => {
      alive = false;
    };
  }, [view.screen, view.sheet]);

  // True once the boot deep-link check has run. Until then the path-sync effect must not rewrite the URL,
  // or the lite catalog shard flipping catalogReady early would erase a #claim= link before it is read.
  const booted = useRef(false);

  /* Pressing the browser's own Back button on Stripe's page restores this one from the back/forward cache with
     every bit of React state as it was, including the "Sending you to secure checkout" splash, which is fixed
     over the whole app and carries no control at all. Nothing took it down, so a guest who changed their mind
     about paying was left staring at it until they thought to reload. Stripe's own back link is a fresh load of
     the listing (#o=) and was never affected. */
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) dispatch({ type: "checkoutDone" });
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  // A claimed operator's edits arrive one fetch behind the listing they belong to, so the page is already
  // drawn from the crawled record when they land. Redraw it when they do, or the guest reads the operator's
  // old title, prices, hours and policies for the whole visit.
  useEffect(() => {
    onListingEdits(() => dispatch({ type: "catalogTouched" }));
    return () => onListingEdits(null);
  }, []);

  useEffect(() => {
    dispatch({ type: "hydrate", bookings: loadBookings(), chats: loadChats() });
    let alive = true;
    // The operator side is decided from the path and hash alone, before any catalog arrives, so an emailed
    // claim link opens the dashboard on the first paint and never gets rewritten to the guest home.
    const early = window.location.hash.match(/^#claim=([a-z0-9-]+)(?:&k=([A-Za-z0-9_.~-]+))?/i);
    if (early) dispatch({ type: "openOperator", id: early[1], token: early[2] || undefined });
    else if (atOperatorsPath()) dispatch({ type: "openOperator" });
    // A shared listing link needs that listing's own file and nothing else, so it is opened before the catalog
    // is asked for. This used to sit inside the .then() below, which meant a guest on mobile data waited out
    // the whole 5 MB catalog to see a 3 kB listing.
    const deep = window.location.hash.match(/^#(?:o|remove)=([a-z0-9-]+)/i);
    if (deep) {
      void loadListing(deep[1]).then((ok) => {
        if (!alive || !ok) return;
        dispatch({ type: "catalogLoaded", added: 1 });
        dispatch({ type: "openRequest", id: deep[1] });
      });
    }
    // Back from Stripe: the confirmation is already up (see the initial state). Fetch its listing, confirm the
    // payment with the API, and drop the hash so a reload lands on the home page.
    const paid = window.location.hash.match(/^#paid=([A-Z0-9-]+)&o=([a-z0-9-]+)/i);
    if (paid) {
      const code = paid[1].toUpperCase();
      void loadListing(paid[2]).then((changed) => alive && changed && dispatch({ type: "catalogLoaded", added: 1 }));
      dispatch({ type: "paidReturn", code });
      void confirmPaid(paid[2], code).then((r) => { if (alive && r.paid) dispatch({ type: "paidReturn", code }); });
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    loadRemoteCatalog((n, complete) => {
      // The lite shard paints the rails early; the full catalog replaces it a moment later.
      if (alive && !complete) dispatch({ type: "catalogLoaded", added: n });
    }).then((added) => {
      if (!alive) return;
      // Claimed operators' edits (prices, photos, published switch) layer over the scraped records.
      const edited = applyStoredProfiles();
      dispatch({ type: "catalogLoaded", added: added + edited, complete: true });
      // Deep link: #o=<operator id> opens that listing directly.
      const m = window.location.hash.match(/^#o=([a-z0-9-]+)/i);
      if (m && experienceById(m[1]) && stateRef.current.reqTargetId !== m[1]) {
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
      const c = window.location.hash.match(/^#claim=([a-z0-9-]+)(?:&k=([A-Za-z0-9_.~-]+))?/i);
      if (c && experienceById(c[1])) {
        // Already on the operator screen from the early check; now the record exists, fetch its details.
        loadListing(c[1]).then((changed) => changed && dispatch({ type: "catalogLoaded", added: 1 }));
      }
      // Consume a listing or remove link so a reload lands on the home page. A claim link keeps its hash:
      // the operator screen reads it and the URL should survive a refresh until the claim is done.
      if (r) window.history.replaceState(null, "", window.location.pathname + window.location.search);
      booted.current = true;

      // Where the guest is was settled before the first render and refined by its own effect above. It used to
      // be decided here, inside this `.then()`, which gave it nothing it needed and cost it the whole catalog.

      // A listing link pasted while the app is already open should still open that listing.
      window.addEventListener("hashchange", () => {
        const h = window.location.hash.match(/^#o=([a-z0-9-]+)/i);
        if (!h || !experienceById(h[1])) return;
        if (stateRef.current.sheet === "request" && stateRef.current.reqTargetId === h[1] && stateRef.current.screen !== "confirm") return;
        dispatch({ type: "openRequest", id: h[1] });
        loadListing(h[1]).then((changed) => changed && dispatch({ type: "catalogLoaded", added: 1 }));
      });
    }).catch(() => {
      // A stored profile that will not parse used to take the whole boot down with it: the catalog had landed
      // and nothing ever said so, so every screen that waits on it waited for good.
      if (alive) dispatch({ type: "catalogLoaded", added: 0, complete: true });
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
      if (cur !== want) window.history.replaceState({ outsetOverlay: true }, "", window.location.pathname + window.location.search + want);
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

  // A listing opens at the top of the page, wherever the rails were scrolled to, and the rails come back to that
  // spot when it closes. Without this the listing appeared scrolled to wherever the guest had been on the home page.
  // Keyed on the transition, not the mount, so React's development double-run of effects cannot undo it.
  const listingOpen = state.sheet === "request" && !!state.reqTargetId;
  const listingWasOpen = useRef(listingOpen);
  const homeScrollY = useRef(0);
  useEffect(() => {
    if (listingOpen === listingWasOpen.current) return;
    listingWasOpen.current = listingOpen;
    if (listingOpen) {
      homeScrollY.current = window.scrollY;
      window.scrollTo({ top: 0 });
    } else {
      const y = homeScrollY.current;
      window.setTimeout(() => window.scrollTo({ top: y }), 0);
    }
  }, [listingOpen]);

  // On a phone, back is a gesture people use constantly. With a listing open it used to leave the site
  // altogether, which reads as the app locking up. An open sheet or chat gets its own history entry, so
  // back closes that first and only the next one leaves.
  const overlay = state.sheet !== null || state.screen === "chat";
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;
  const pushedOverlay = useRef(false);
  useEffect(() => {
    if (!booted.current) return;
    if (overlay && !pushedOverlay.current) {
      pushedOverlay.current = true;
      window.history.pushState({ outsetOverlay: true }, "", window.location.href);
    } else if (!overlay && pushedOverlay.current) {
      pushedOverlay.current = false;
      // Closed with the X rather than back: drop our entry so the stack matches what the guest sees.
      if ((window.history.state as { outsetOverlay?: boolean } | null)?.outsetOverlay) window.history.back();
    }
  }, [overlay]);

  useEffect(() => {
    const onPop = () => {
      if (overlayRef.current) {
        pushedOverlay.current = false;
        if (state.screen === "chat") dispatch({ type: "back" });
        else dispatch({ type: "closeSheet" });
        return;
      }
      const atOps = atOperatorsPath();
      if (atOps && state.screen !== "operator") dispatch({ type: "openOperator" });
      if (!atOps && state.screen === "operator") dispatch({ type: "back" });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [state.screen]);

  // Escape closes whatever is on top, the way every other site behaves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (state.sheet) dispatch({ type: "closeSheet" });
      else if (state.screen === "chat" || state.screen === "detail") dispatch({ type: "back" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.sheet, state.screen]);

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
      setMetro: (metroId) => {
        // Picking a city is a decision too, and it clears `near`, so the remembered point goes with it: without
        // this the next visit would restore the old point and quietly undo the city the guest chose. The city
        // itself is remembered in its place, because storing nothing meant the next visit guessed over it.
        chose.current = true;
        rememberPlace(null);
        rememberMetro(metroId);
        dispatch({ type: "metro", metroId });
      },
      setNear: (near) => {
        // A place the guest picked is remembered, so the next visit opens where they left off rather than on a guess.
        // Clearing the point does not clear the city: the reducer leaves `metroId` alone, so that is what the
        // guest is left looking at and what should come back, whether it is Denver or Anywhere.
        chose.current = true;
        rememberPlace(near);
        rememberMetro(near ? null : stateRef.current.metroId);
        dispatch({ type: "near", near });
      },
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
        // The API host sleeps when idle. Waking it as the listing opens means "Book and pay" is not the request
        // that pays for the cold start.
        warmApi();
      },
      closeSheet: () => dispatch({ type: "closeSheet" }),
      confirm: () => dispatch({ type: "confirm" }),
      confirmUnclaimed: async (input) => {
        if (input.listing && !experienceById(input.listing)) {
          await loadListing(input.listing);
        }
        const u = experienceById(input.listing || stateRef.current.reqTargetId);
        if (!u || !input.slot) return { ok: false, error: "Pick a time first." };
        const date = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : dateKey(DATES[input.dateIdx]);
        if (!hasApi()) {
          // No API on this host: the booking lives on this device only, the way the demo always worked.
          dispatch({ type: "confirmUnclaimed", ...input, date });
          return { ok: true };
        }
        const picked = input.optionIdx != null ? u.options[input.optionIdx] : null;
        const extras = (input.addonIdx || []).map((i) => (u.addons || [])[i]).filter(Boolean);
        const p = priceUnclaimed(picked, input.qty, extras);
        const total = input.total != null && Number.isFinite(input.total) ? input.total : p.total;
        const code = makeCode(initials(u.title));
        // The request goes to the operator through the API: email to them, a row in their dashboard. Only once
        // the API has it does the guest see a ticket; before this the page said "Request sent" while the API
        // was answering 409 for a paused shop or a time that had just been taken.
        // The embedded form needs Stripe's publishable key on the page; without it the hosted page is asked for.
        warmCheckout();
        const embedded = !!(await apiConfig()).stripePublishableKey;
        const r = await submitBooking({
          embedded,
          wallet: loadWalletId() || undefined,
          code, listing: u.id, date, slot: input.slot, qty: input.qty,
          service: input.service || picked?.name || u.title, variant: picked?.detail || "", addons: extras.map((a) => a.name), total: total || null,
          guest: { name: input.guest?.name || "", phone: input.guest?.phone || "", email: input.guest?.email || "" },
        });
        if (!r.ok) {
          // A concierge-only host answers 404 JSON for /bookings. Hold the trip on this device so Ask can finish.
          if (r.error && /not found/i.test(r.error)) {
            dispatch({ type: "confirmUnclaimed", ...input, date, code });
            return { ok: true };
          }
          const error = r.taken ? (r.error || "That time was just booked") + ". Pick another time." : r.error ? r.error + "." : "Could not send the request. Check your connection and try again.";
          dispatch({ type: "toast", text: error });
          return { ok: false, error, taken: r.taken };
        }
        // Otto held the saved card: skip Stripe Checkout and show the ticket.
        if (r.charged) {
          dispatch({ type: "confirmUnclaimed", ...input, date, code, pay: false, paid: true });
          return { ok: true };
        }
        // Card on file: the listing stays behind the checkout splash and Stripe's hosted page takes over, then
        // sends the guest back to #paid=<code>. No card step after all: the confirmation shows straight away.
        // The API is trusted for a lot, but not to pick where this tab navigates next: only Stripe's own
        // checkout host is ever worth leaving the page for.
        // Embedded: the form mounts over the listing and Stripe brings the guest back to #paid= when it is done.
        if (r.checkoutClientSecret) {
          dispatch({ type: "confirmUnclaimed", ...input, date, code, pay: true, checkoutSecret: r.checkoutClientSecret });
          return { ok: true, checkoutUrl: "embedded" };
        }
        const goesToStripe = isHttpsUrlOnHost(r.checkoutUrl, "checkout.stripe.com");
        dispatch({ type: "confirmUnclaimed", ...input, date, code, pay: goesToStripe });
        if (goesToStripe) window.location.assign(r.checkoutUrl!);
        return { ok: true, checkoutUrl: goesToStripe ? r.checkoutUrl : undefined };
      },
      back: () => dispatch({ type: "back" }),
      cancelCheckout: () => dispatch({ type: "checkoutDone" }),
      openChat: (id) => dispatch({ type: "openChat", id }),
      openOperator: (id) => {
        dispatch({ type: "openOperator", id });
        loadListing(id ?? null).then((changed) => changed && dispatch({ type: "catalogLoaded", added: 1 }));
      },
      sendChat: (text) => dispatch({ type: "sendChat", text }),
      goto: (tab) => dispatch({ type: "goto", tab }),
      touchCatalog: () => dispatch({ type: "catalogTouched" }),
      openAsk: (seed) => dispatch({ type: "openAsk", seed: seed || "" }),
      closeAsk: () => dispatch({ type: "closeAsk" }),
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
