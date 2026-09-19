import type { Booking, CategoryId, OperatorContact, Unclaimed, UnclaimedOption, UnclaimedService } from "../data/types";
import { forgetClaim, saveRemoteProfile, type RemoteBooking } from "./api";
import { addressLine, contactFor, experienceById, getCatalog, setOperatorOverride, siteUrl } from "./catalog";
import { callablePhone } from "./phone";
import { contactEmail } from "./email";
import { dateKey, startOfToday } from "./dates";
import { withoutNoticeWindows } from "./duration";
import { fmtTime, money } from "./format";
import { durationLabel as menuDuration, faqText, freeCancel } from "./listingDerive";
import { itemWeek, parseWeek, type Week } from "./openNow";
import { operatorNet, subtotalFromTotal } from "./pricing";
import { splitAddons } from "./storage";

/**
 * Operator side data. One profile per claimed business, saved on-device.
 * The profile starts as a copy of what we scraped, so an operator lands on a dashboard that is already
 * 75 to 80 percent filled in and fixes what is off. Edits flow back to the guest listing through
 * setOperatorOverride, so a price fixed here is the price a guest sees.
 */

export type OpStatus = "new" | "accepted" | "declined" | "completed" | "noshow" | "cancelled";

export type OpBooking = {
  id: string;
  code: string;
  guest: string;
  email?: string;
  phone?: string;
  service: string;
  variant: string;
  price: number | null;
  qty: number;
  total: number | null;
  /** The operator's own price before the guest's service fee, when the API priced the booking. */
  subtotal?: number | null;
  addons?: string[];
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM, 24 hour */
  slot: string;
  status: OpStatus;
  note?: string;
  created: number;
  /** guest: a real booking made in this browser's guest app. sample: seeded so the dashboard is not empty. */
  source: "guest" | "sample" | "remote";
  /** The card behind a real booking. "released" means a decline or cancel already gave the money back. */
  payment?: "authorized" | "captured" | "released" | "unpaid";
};

export type OpVariant = {
  id: string;
  label: string;
  price: number | null;
  /** Free text: the suggestions are a starting point, not the choices. */
  per: string;
  /** True multiplies the price by the party size, false charges it once. Defaults to per person on a new row. */
  perGuest?: boolean;
};

export type OpService = {
  id: string;
  name: string;
  desc: string;
  live: boolean;
  durationMin: number;
  capacity: number;
  variants: OpVariant[];
  /** One of the listing's gallery photos, shown next to this service on the guest page. */
  photo?: string;
};

export type OpAddon = { id: string; name: string; detail: string; price: number | null };

/* ---------- clean numbers for the menu editor ---------- */

/** The most a single option or extra may cost. Stripe refuses a charge above $999,999.99, and no tour is that. */
export const MAX_PRICE = 999999;
/** The most guests one slot can take. Anything above is a typo, not a stadium. */
export const MAX_CAPACITY = 1000;
/** Minutes a service may run for: five minutes to a full day. */
export const MIN_DURATION = 5;
export const MAX_DURATION = 1440;
export const DURATION_PRESETS = [15, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480];

/**
 * A price as typed, made clean: "$45", "45,000", "1,250.50" and "abc45" all read as the number inside, a
 * blank box means no price, a minus is dropped (money is never negative), cents are rounded and the result is
 * capped at MAX_PRICE. Anything that leaves no digits behind is no price. Never NaN, never Infinity.
 */
export function cleanPrice(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  const text = String(raw).replace(/[^0-9.]/g, "");
  const firstDot = text.indexOf(".");
  const digits = firstDot < 0 ? text : text.slice(0, firstDot + 1) + text.slice(firstDot + 1).replace(/\./g, "");
  if (!/\d/.test(digits)) return null;
  const n = Math.round(Number(digits) * 100) / 100;
  // A zero is not a price: the money code on both sides reads it as none, the checklist counts it as unset,
  // and a guest was shown "From $0 / ski" for a shop that had simply not finished typing.
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(MAX_PRICE, n);
}

/** A whole number as typed, clamped to [min, max]; null when nothing numeric was typed. */
export function cleanCount(raw: string | number | null | undefined, min: number, max: number): number | null {
  if (raw == null) return null;
  // "2.5" guests is 2, not 25: the whole part is what was meant, the dot is not.
  const digits = String(raw).replace(/[^0-9.]/g, "").split(".")[0];
  if (!digits) return null;
  const n = Number(digits);
  if (!Number.isFinite(n)) return max;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** Minutes as a label: "45 min", "1 hour", "1.5 hours", "1 h 45 min". */
export function durationLabel(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return "";
  if (min < 60) return min + " min";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (m === 0) return h + (h === 1 ? " hour" : " hours");
  if (m === 30) return h + ".5 hours";
  return h + " h " + m + " min";
}

/** Bookings still to happen for a service, by the name a booking carries. Deleting the service orphans them. */
export function upcomingBookingsFor(p: OperatorProfile, serviceName: string): OpBooking[] {
  const today = dateKey(startOfToday());
  const name = serviceName.trim().toLowerCase();
  return p.bookings.filter((b) => b.service.trim().toLowerCase() === name && b.date >= today && (b.status === "new" || b.status === "accepted"));
}

/** Two services with the same name are one section on the guest page and one word on every booking. */
export function duplicateServiceName(p: OperatorProfile, s: OpService): boolean {
  const name = s.name.trim().toLowerCase();
  return !!name && p.services.some((o) => o.id !== s.id && o.name.trim().toLowerCase() === name);
}

export type DayHours = { closed: boolean; open: string; close: string };

export type OperatorProfile = {
  v: 1;
  id: string;
  claimedAt: number;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  /** The Uber Eats style switch: false pauses new bookings without hiding the listing. */
  accepting: boolean;
  /** False takes the listing off the site entirely. */
  published: boolean;
  /** Airbnb style: true confirms new bookings automatically, false makes each one a request. */
  instantBook: boolean;
  /** The 24/7 assistant on the listing page. */
  assistant: boolean;
  title: string;
  cat: Exclude<CategoryId, "all">;
  blurb: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  cover: string;
  photos: string[];
  policy: string[];
  services: OpService[];
  addons: OpAddon[];
  /** Sunday first, matches Date.getDay(). */
  hours: DayHours[];
  slotMinutes: number;
  leadHours: number;
  windowDays: number;
  blockedDates: string[];
  /** "YYYY-MM-DD|HH:MM" */
  blockedSlots: string[];
  bookings: OpBooking[];
  /** Status the operator gave to a guest booking, keyed by booking code. */
  decisions: Record<string, OpStatus>;
  notify: { email: boolean; sms: boolean; push: boolean };
  payout: { bank: string; last4: string; name: string; schedule: "daily" | "weekly" } | null;
  /** The owner looked at the 9 to 5 hours we filled in for them and said they are right. */
  hoursConfirmed?: boolean;
  /**
   * The operator's detail file has been read into this profile once. Filling the gaps from the crawl is a
   * bootstrap, not a repair: after it has run, an empty menu or an empty gallery is the operator's own doing.
   */
  hydrated?: boolean;
  /**
   * The operator's own version of the "what it's actually like" guide on the listing. Absent on profiles saved
   * before it existed, and on any profile the operator has not opened that section of: the page then shows the
   * default for the activity kind (data/guides.ts).
   */
  guide?: OpGuide;
  /**
   * Things to know, each its own field so the operator edits the line guests actually read rather than a mixed
   * policy list. Absent on a profile saved before these existed and on a listing whose owner has not touched them:
   * the guest page then shows what the booking system or website published. Present (even empty) means the owner's
   * version, and it replaces the published text.
   */
  cancellation?: string;
  requirements?: string[];
  includes?: string[];
  checkin?: string;
  faq?: OpFaq[];
};

export type OpFaq = { q: string; a: string };
export type OpGuide = { steps: string[]; bring: string[]; goodFor: string };
/** Length limits for the things-to-know editor, the sizes the guest page lays them out at. */
export const KNOW_LIMITS = { cancellation: 240, requirements: 10, requirement: 160, includes: 12, include: 100, checkin: 240, faq: 8, question: 120, answer: 400 } as const;
/** Length limits for the guide editor, the same ones the guest modal is laid out for. */
export const GUIDE_LIMITS = { steps: 8, step: 240, bring: 10, bringItem: 80, goodFor: 200 } as const;

const SESSION_KEY = "outset.operator.session.v1";
const PROFILE_PREFIX = "outset.operator.profile.v1.";
const INDEX_KEY = "outset.operator.index.v1";

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Suggestions only. An operator can type any unit; these are what the box offers before they do. */
export const PER_UNITS = ["person", "hour", "trip", "boat", "group", "vehicle", "room", "day", "night", "lane", "session", "class", "court", "table", "bike", "kart"];

/** What a unit implies, for a row saved before the operator was asked outright. "person" and "guest" multiply. */
export function perUnitLooksPerGuest(unit: string): boolean {
  return /person|guest|adult|child|kid|senior|youth|rider|passenger|seat|head|player|climber|diver|jumper/i.test(unit || "");
}

let seq = 0;
export function uid(prefix = "x"): string {
  seq += 1;
  return prefix + Date.now().toString(36) + seq.toString(36) + Math.random().toString(36).slice(2, 5);
}

/* ---------- persistence ---------- */

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** False when the browser refused the write (quota full, private mode): the caller must not claim it saved. */
function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadSession(): string | null {
  return read<{ id: string }>(SESSION_KEY)?.id ?? null;
}

export function saveSession(id: string | null): void {
  if (!id) {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
    return;
  }
  write(SESSION_KEY, { id });
}

/** The localStorage key one business's profile lives under. The shell watches it for edits from another tab. */
export function profileKey(id: string): string {
  return PROFILE_PREFIX + id;
}

const OP_STATUSES: OpStatus[] = ["new", "accepted", "declined", "completed", "noshow", "cancelled"];
const CATS: Exclude<CategoryId, "all">[] = ["air", "water", "motorsport", "indoor", "outdoor", "play", "food", "wellness", "classes", "culture"];
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : fallback);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
const num = (v: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : []);
const objList = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isObj) : []);
const HHMM = /^\d{2}:\d{2}$/;
const DEFAULT_DAY: DayHours = { closed: false, open: "09:00", close: "17:00" };

/**
 * A stored profile made safe to render, whatever version of the dashboard wrote it. A field an older build
 * never knew about comes back with its default instead of undefined (a profile saved before blockedSlots
 * existed took the Calendar page down with "cannot read includes of undefined"), a number typed into a text
 * box comes back as a number, a row missing its id gets one, and a status or category that is not one of
 * ours falls back. Keys this build does not know are kept, so a newer build's data survives a round trip.
 * Nothing here invents content: an empty list stays empty.
 */
export function normalizeProfile(raw: unknown): OperatorProfile | null {
  if (!isObj(raw) || typeof raw.id !== "string" || !raw.id) return null;
  if (raw.v !== undefined && raw.v !== 1) return null;
  const hours7 = Array.isArray(raw.hours) ? raw.hours : [];
  const hours: DayHours[] = Array.from({ length: 7 }, (_, i) => {
    const h = hours7[i];
    if (!isObj(h)) return { ...DEFAULT_DAY };
    const open = str(h.open);
    const close = str(h.close);
    return { closed: bool(h.closed, false), open: HHMM.test(open) ? open : DEFAULT_DAY.open, close: HHMM.test(close) ? close : DEFAULT_DAY.close };
  });
  const services: OpService[] = objList(raw.services).map((s) => ({
    id: str(s.id) || uid("s"),
    name: str(s.name),
    desc: str(s.desc),
    live: bool(s.live, true),
    durationMin: num(s.durationMin, 60, 0, MAX_DURATION),
    capacity: num(s.capacity, 8, 0, MAX_CAPACITY),
    variants: objList(s.variants).map((v) => ({
      id: str(v.id) || uid("v"),
      label: str(v.label),
      price: cleanPrice(typeof v.price === "number" || typeof v.price === "string" ? v.price : null),
      per: str(v.per, "person") || "person",
      ...(typeof v.perGuest === "boolean" ? { perGuest: v.perGuest } : {}),
    })),
    ...(typeof s.photo === "string" && s.photo ? { photo: s.photo } : {}),
  }));
  const addons: OpAddon[] = objList(raw.addons).map((a) => ({ id: str(a.id) || uid("a"), name: str(a.name), detail: str(a.detail), price: cleanPrice(typeof a.price === "number" || typeof a.price === "string" ? a.price : null) }));
  const bookings: OpBooking[] = objList(raw.bookings)
    .filter((b) => typeof b.id === "string" && typeof b.code === "string")
    .map((b) => ({
      ...(b as unknown as OpBooking),
      guest: str(b.guest, "Guest"),
      service: str(b.service),
      variant: str(b.variant),
      price: typeof b.price === "number" && Number.isFinite(b.price) ? b.price : null,
      qty: num(b.qty, 1, 1),
      total: typeof b.total === "number" && Number.isFinite(b.total) ? b.total : null,
      date: str(b.date),
      slot: str(b.slot),
      status: OP_STATUSES.includes(b.status as OpStatus) ? (b.status as OpStatus) : "new",
      created: num(b.created, Date.now()),
      source: b.source === "sample" || b.source === "remote" ? b.source : "guest",
    }));
  const decisions: Record<string, OpStatus> = {};
  if (isObj(raw.decisions)) for (const [k, v] of Object.entries(raw.decisions)) if (OP_STATUSES.includes(v as OpStatus)) decisions[k] = v as OpStatus;
  const notify = isObj(raw.notify) ? raw.notify : {};
  const payout = isObj(raw.payout) ? raw.payout : null;
  const cat = CATS.includes(raw.cat as Exclude<CategoryId, "all">) ? (raw.cat as Exclude<CategoryId, "all">) : "outdoor";
  const photos = strList(raw.photos);
  const cover = str(raw.cover);
  const p: OperatorProfile = {
    ...(raw as object),
    v: 1,
    id: raw.id,
    claimedAt: num(raw.claimedAt, Date.now()),
    ownerName: str(raw.ownerName),
    ownerEmail: str(raw.ownerEmail),
    ownerPhone: str(raw.ownerPhone),
    accepting: bool(raw.accepting, true),
    published: bool(raw.published, true),
    instantBook: bool(raw.instantBook, false),
    assistant: bool(raw.assistant, true),
    title: str(raw.title),
    cat,
    blurb: str(raw.blurb),
    phone: str(raw.phone),
    email: str(raw.email),
    website: str(raw.website),
    address: str(raw.address),
    // A cover that is not in the gallery any more is a photo the operator removed.
    cover: cover && (!photos.length || photos.includes(cover)) ? cover : photos[0] || "",
    photos,
    policy: strList(raw.policy),
    services,
    addons,
    hours,
    slotMinutes: num(raw.slotMinutes, 60, 15, 1440),
    leadHours: num(raw.leadHours, 2, 0, 24 * 90),
    windowDays: num(raw.windowDays, 60, 1, 730),
    blockedDates: strList(raw.blockedDates),
    blockedSlots: strList(raw.blockedSlots),
    bookings,
    decisions,
    notify: { email: bool(notify.email, true), sms: bool(notify.sms, true), push: bool(notify.push, true) },
    payout: payout ? { bank: str(payout.bank), last4: str(payout.last4), name: str(payout.name), schedule: payout.schedule === "weekly" ? "weekly" : "daily" } : null,
  };
  if (typeof raw.cancellation === "string") p.cancellation = raw.cancellation.slice(0, KNOW_LIMITS.cancellation);
  if (Array.isArray(raw.requirements)) p.requirements = strList(raw.requirements).slice(0, KNOW_LIMITS.requirements);
  if (Array.isArray(raw.includes)) p.includes = strList(raw.includes).slice(0, KNOW_LIMITS.includes);
  if (typeof raw.checkin === "string") p.checkin = raw.checkin.slice(0, KNOW_LIMITS.checkin);
  if (Array.isArray(raw.faq)) {
    p.faq = (raw.faq as unknown[])
      .map((f) => (f && typeof f === "object" ? { q: str((f as { q?: unknown }).q).slice(0, KNOW_LIMITS.question), a: str((f as { a?: unknown }).a).slice(0, KNOW_LIMITS.answer) } : null))
      .filter((f): f is OpFaq => !!f && (!!f.q.trim() || !!f.a.trim()))
      .slice(0, KNOW_LIMITS.faq);
  }
  if (typeof raw.hoursConfirmed === "boolean") p.hoursConfirmed = raw.hoursConfirmed;
  if (typeof raw.hydrated === "boolean") p.hydrated = raw.hydrated;
  return p;
}

export function loadProfile(id: string): OperatorProfile | null {
  return normalizeProfile(read<unknown>(PROFILE_PREFIX + id));
}

/**
 * False when the browser would not keep the profile (storage full or blocked). The guest listing still gets
 * the edit for this page load, and the caller must tell the operator it did not stick.
 */
export function saveProfile(p: OperatorProfile): boolean {
  const ok = write(PROFILE_PREFIX + p.id, p);
  const idx = new Set(read<string[]>(INDEX_KEY) || []);
  idx.add(p.id);
  write(INDEX_KEY, Array.from(idx));
  pushToCatalog(p);
  return ok;
}

/**
 * Release a business on this device: the saved profile, its slot in the claimed index, the override the
 * guest catalog was showing, and the claim token and session slot that let this browser keep editing it.
 * The listing goes back to the scraped record a guest saw before anyone claimed it.
 */
export function deleteProfile(id: string): void {
  try {
    localStorage.removeItem(PROFILE_PREFIX + id);
  } catch {
    /* ignore */
  }
  const idx = (read<string[]>(INDEX_KEY) || []).filter((x) => x !== id);
  write(INDEX_KEY, idx);
  setOperatorOverride(id, null, true);
  forgetClaim(id);
  if (loadSession() === id) saveSession(null);
}

/** Every business claimed in this browser. */
export function claimedIds(): string[] {
  return read<string[]>(INDEX_KEY) || [];
}

/**
 * Called once after the catalog loads so guest pages show operator edits. The dashboard's live preview frame
 * calls it again on every storage event with remote off: a preview only reads, it never saves to the API.
 */
export function applyStoredProfiles(opts: { remote?: boolean } = {}): number {
  let n = 0;
  for (const id of claimedIds()) {
    const p = loadProfile(id);
    if (p) {
      pushToCatalog(p, opts.remote !== false);
      n += 1;
    }
  }
  return n;
}

/* ---------- defaults from the scraped record ---------- */

const CLOSED_DAY: DayHours = { closed: true, open: "09:00", close: "17:00" };

/** Minutes past midnight as the two selects speak it. A close past midnight comes back on the next day's clock, which `hoursRun` wraps. */
function clockTime(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
}

/**
 * A week the guest side already read, as the dashboard keeps it.
 *
 * No week at all is a shop that published nothing, and it starts on a plain 9 to 5 the owner can correct. A
 * day the published hours did not name is a day the shop did not say it opens, so it starts closed rather
 * than keeping that 9 to 5: "open Saturday & Sunday only from 11:00am to 7:00pm" came out as a shop open
 * Monday to Friday, and a dropzone flying Friday through Sunday took Monday bookings. The Availability page
 * shows the whole week, so an owner who does open on one switches it back on in a click.
 */
export function weekToHours(week: Week | null): DayHours[] {
  if (!week) return Array.from({ length: 7 }, () => ({ ...DEFAULT_DAY }));
  return week.map((d) => (!d || d.close <= d.open ? { ...CLOSED_DAY } : { closed: false, open: clockTime(d.open), close: clockTime(d.close) }));
}

/**
 * The hour lines the operator's own site published, read into the week their dashboard starts on.
 *
 * `parseWeek` does the reading: the one reader the listing page, the "Open now" line, the booking sheet and
 * Otto already use, so claiming a business cannot quietly change the hours it was advertising. The dashboard
 * used to carry a second, weaker reader of its own, and on 230 of the 4,482 shops whose hours we hold the two
 * disagreed. The pm on the end of a range was never shared with its start, so "Wednesday - Friday: 7-9:00PM"
 * opened a karting track at 7 in the morning and "Monday to Friday 1-5 PM" a boat rental at one; a close of
 * "12PM-12AM" landed before its own open; "6.30 am" opened at 30 o'clock; OpenStreetMap's own syntax
 * ("Su off; Tu-Fr 09:00-16:30", 88 shops) read as nothing at all, so those shops got the invented 9 to 5; and
 * a brewery's happy hour was taken for its trading hours.
 */
export function parseHours(lines: string[]): DayHours[] {
  return weekToHours(parseWeek(lines));
}

function servicesFrom(u: Unclaimed): OpService[] {
  if (u.services && u.services.length) {
    // The same service can arrive twice with different options ("Dolphin Island excursion" at $185 and $220): one row, two options.
    const merged = new Map<string, UnclaimedService>();
    for (const s of u.services) {
      const key = s.name.trim().toLowerCase();
      const cur = merged.get(key);
      if (!cur) merged.set(key, { ...s, variants: s.variants.slice() });
      else {
        for (const v of s.variants) if (!cur.variants.some((x) => x.label.toLowerCase() === v.label.toLowerCase() && x.price === v.price)) cur.variants.push(v);
        if (!cur.desc && s.desc) cur.desc = s.desc;
      }
    }
    return [...merged.values()].map((s) => ({
      id: uid("s"),
      name: s.name,
      desc: s.desc || "",
      live: true,
      durationMin: minutesIn(s.variants.map((v) => v.label).join(" ")) || 60,
      capacity: 8,
      photo: s.photo || undefined,
      variants: s.variants.map((v) => ({ id: uid("v"), label: v.label, price: cleanPrice(v.price), per: unitOf(v.per || u.options[v.optionIdx]?.per) })),
    }));
  }
  if (u.options.length) {
    // The same rule as above: two options named "Dolphin Island excursion" are one service with two prices,
    // not two rows the operator has to tell apart by the small print.
    const byName = new Map<string, OpService>();
    for (const o of u.options) {
      const key = o.name.trim().toLowerCase();
      const v: OpVariant = { id: uid("v"), label: o.detail || "Standard", price: cleanPrice(o.price), per: unitOf(o.per) };
      const cur = byName.get(key);
      if (cur) {
        if (!cur.variants.some((x) => x.label.toLowerCase() === v.label.toLowerCase() && x.price === v.price)) cur.variants.push(v);
        continue;
      }
      byName.set(key, { id: uid("s"), name: o.name, desc: "", live: true, durationMin: minutesIn(o.detail) || 60, capacity: 8, variants: [v] });
    }
    return [...byName.values()];
  }
  return [];
}

/**
 * "1.5 hours", "90 min", "2 hr" as minutes; 0 when the text names none. A notice or refund window is not a
 * length (see duration.ts), so a service imported from "Cancellations prior to 72 hours" no longer opens the
 * dashboard as a booking a whole day long.
 */
export function minutesIn(text: string | null | undefined): number {
  const m = withoutNoticeWindows(text || "").match(/(\d+(?:\.\d+)?)\s*(?:-|to)?\s*(\d+(?:\.\d+)?)?\s*(hours?|hrs?|h\b|minutes?|mins?|m\b)/i);
  if (!m) return 0;
  const n = Number(m[2] || m[1]);
  const mins = /^(m|min|mins|minute|minutes)$/i.test(m[3]) ? n : n * 60;
  return mins > 0 && mins <= 24 * 60 ? Math.round(mins) : 0;
}

function unitOf(per?: string | null): string {
  const p = (per || "").replace(/^\//, "").trim().toLowerCase();
  if (!p || p === "each") return "person";
  if (p === "hr") return "hour";
  return p;
}

export function defaultProfile(u: Unclaimed, owner: { name: string; email: string; phone: string }): OperatorProfile {
  const c = contactFor(u);
  return {
    v: 1,
    id: u.id,
    claimedAt: Date.now(),
    ownerName: owner.name,
    ownerEmail: owner.email,
    ownerPhone: owner.phone,
    accepting: true,
    published: true,
    // Off until the owner decides. A shop that claims its listing to look around should not start promising
    // guests confirmed slots it has not seen; with this off, every booking arrives as a request to accept.
    instantBook: false,
    assistant: true,
    title: u.title,
    cat: u.cat,
    blurb: u.blurb || "",
    // Only a number a guest could actually ring: the crawl also stores two numbers in one field, a `tel:` link
    // still percent-encoded and the odd unrendered template, and none of those is worth prefilling as theirs.
    phone: callablePhone(c?.phone) || "",
    // The inbox this shop's booking alerts go to, and only an address someone could write to: the crawl also
    // stored addresses still percent-encoded, a site template's own "info@mysite.com" and a name masked with
    // asterisks, none of which is worth handing an owner as theirs.
    email: contactEmail(c?.email) || "",
    website: c?.website || (u.src && !u.src.startsWith("osm-") ? siteUrl(u.src) : ""),
    address: (c && addressLine(c)) || u.area,
    cover: u.cover || "",
    photos: (u.photos || []).slice(),
    // The published cancellation line has its own field below; the same sentence is not also an "other policy",
    // or the card shows it twice and the operator edits one copy while the other stays.
    policy: [...(u.policies || []), ...(u.gap && !/not stated|not published|unknown|not copied|we'?ll ask|we will ask|ask when you request/i.test(u.gap) ? [u.gap] : [])].filter((l, i, a) => a.indexOf(l) === i && l !== u.cancellation).slice(0, 8),
    ...knowFrom(u),
    services: servicesFrom(u),
    addons: (u.addons || []).map((a) => ({ id: uid("a"), name: a.name, detail: a.detail || "", price: a.price })),
    // The week the listing page was already showing guests, hour lines first and the synced contact record
    // after, which is what `itemWeek` reads. Only the contact record was read here, so 10,508 shops whose
    // published hours a guest could read on their own listing were handed an invented 9 to 5 on the day they
    // claimed, and the hours on the page changed the moment they did.
    hours: weekToHours(itemWeek(u)),
    slotMinutes: 60,
    leadHours: 2,
    windowDays: 60,
    blockedDates: [],
    blockedSlots: [],
    bookings: [],
    decisions: {},
    notify: { email: true, sms: true, push: true },
    payout: null,
  };
}

/* ---------- sample bookings so a fresh dashboard is not empty ---------- */

const NAMES = ["Maya R.", "Jordan P.", "Alex T.", "Sam K.", "Priya N.", "Chris D.", "Taylor M.", "Dev S.", "Lena W.", "Marcus B.", "Ava L.", "Noah F."];
const NOTES = ["First time, a little nervous.", "Birthday trip for my brother.", "Can we start earlier if there's space?", "", "Two kids, ages 9 and 12.", "", "Celebrating our anniversary.", "", "We'll have one person watching from shore.", ""];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The demo dashboard a visitor sees before claiming. The only profile that may carry sample bookings. */
export function isDemoProfile(p: Pick<OperatorProfile, "ownerEmail" | "ownerName">): boolean {
  return p.ownerEmail === "owner@example.com" && p.ownerName === "Demo owner";
}

export function sampleBookings(p: OperatorProfile): OpBooking[] {
  if (!isDemoProfile(p)) return [];
  // Prefer services with a price so the demo totals mean something. Fall back to anything bookable.
  const priced = p.services.map((s) => ({ ...s, variants: s.variants.filter((v) => v.price != null) })).filter((s) => s.variants.length);
  const svcs = priced.length ? priced : p.services.filter((s) => s.variants.length);
  if (!svcs.length) return [];
  const seed = hash(p.id);
  const out: OpBooking[] = [];
  const today = startOfToday();
  const offsets = [-21, -14, -9, -6, -3, -1, 0, 0, 1, 1, 2, 3, 4, 6, 8];
  const slots = ["09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00"];
  offsets.forEach((off, k) => {
    // Each row gets its own hash. `(seed + k * 7919) % 1000` made `r + k` a multiple of 4 for every row, so with
    // two or four services every sample was the same service, the same party size and one of three names.
    const r = hash(p.id + ":" + k + ":" + seed) % 1000;
    const s = svcs[(k + r) % svcs.length];
    const v = s.variants[r % s.variants.length];
    const d = new Date(today);
    d.setDate(d.getDate() + off);
    const qty = 1 + ((r + k) % 4);
    const past = off < 0;
    let status: OpStatus = past ? "completed" : "accepted";
    if (past && k === 2) status = "noshow";
    if (!past && (k === 7 || k === 9 || k === 12)) status = "new";
    if (!past && k === 10) status = "cancelled";
    out.push({
      id: "smp" + k,
      code: (p.title.replace(/[^A-Z]/gi, "").slice(0, 2).toUpperCase() || "OS") + "-" + (1000 + ((r * 37 + k) % 9000)),
      guest: NAMES[(r + k) % NAMES.length],
      service: s.name,
      variant: v.label,
      price: v.price,
      qty,
      total: v.price != null ? v.price * (v.per === "person" ? qty : 1) : null,
      date: dateKey(d),
      slot: slots[(r + k * 3) % slots.length],
      status,
      note: NOTES[(r + k) % NOTES.length] || undefined,
      created: d.getTime() - 86400000 * (2 + (r % 5)),
      source: "sample",
    });
  });
  return out;
}

/* ---------- guest bookings from this browser, merged in ---------- */

export function guestBookingsFor(p: OperatorProfile, guest: Booking[]): OpBooking[] {
  const u = experienceById(p.id);
  return guest
    .filter((b) => b.listing === p.id)
    .map((b) => {
      const { optionIdx, extras } = splitAddons(b.addons);
      // What the guest booked is what the booking wrote down at confirm time. The index in `addons` is only a
      // fallback for bookings made before that was recorded: it points into the live menu, so deleting or
      // reordering a service used to relabel every earlier booking row with whatever now sat at that position.
      const opt = b.service == null && optionIdx != null && u ? u.options[optionIdx] : null;
      return {
        id: "g" + b.code,
        code: b.code,
        guest: b.guest?.name || "Guest " + b.code.slice(-2),
        email: b.guest?.email,
        phone: b.guest?.phone,
        service: b.service || opt?.name || (u?.title ?? "Booking"),
        variant: b.service != null ? b.variant || "" : opt?.detail || "",
        price: b.service != null ? b.price ?? null : opt?.price ?? null,
        qty: b.qty,
        total: b.total,
        addons: extras,
        date: b.date,
        slot: b.slot,
        status: p.decisions[b.code] || (p.instantBook ? "accepted" : "new"),
        created: b.created,
        source: "guest" as const,
      };
    });
}

/** Bookings the API holds for this listing: the real ones, from any guest on any device. */
export function remoteBookingsFor(list: RemoteBooking[]): OpBooking[] {
  // A pending row is a guest still on the Stripe page; it becomes a request once the card is authorized.
  return list.filter((b) => b.status !== "pending").map((b) => ({
    id: "r" + b.code,
    code: b.code,
    guest: b.guest.name,
    email: b.guest.email || undefined,
    phone: b.guest.phone || undefined,
    service: b.service,
    variant: b.variant,
    price: null,
    qty: b.qty,
    total: b.total,
    subtotal: b.pricing?.subtotal ?? null,
    addons: b.addons,
    date: b.date,
    slot: b.slot,
    status: b.status as OpStatus,
    note: b.note,
    created: Date.parse(b.created) || Date.now(),
    source: "remote" as const,
    payment: b.payment?.state,
  }));
}

/**
 * What the dashboard shows. Real bookings from the API first; the browser-local ones fill in when the API is
 * unreachable; sample bookings only on a profile that has none of either, so the demo is never empty.
 */
export function allBookings(p: OperatorProfile, guest: Booking[], remote: RemoteBooking[] | null = null): OpBooking[] {
  const real = remote ? remoteBookingsFor(remote) : [];
  const codes = new Set(real.map((b) => b.code));
  const local = guestBookingsFor(p, guest).filter((b) => !codes.has(b.code));
  const samples = real.length || local.length || !isDemoProfile(p) ? [] : p.bookings.filter((b) => b.source === "sample");
  const mine = p.bookings.filter((b) => b.source !== "sample");
  return [...real, ...local, ...mine, ...samples].sort((a, b) => a.date.localeCompare(b.date) || a.slot.localeCompare(b.slot));
}

export function setBookingStatus(p: OperatorProfile, b: OpBooking, status: OpStatus): OperatorProfile {
  if (b.source === "guest") return { ...p, decisions: { ...p.decisions, [b.code]: status } };
  return { ...p, bookings: p.bookings.map((x) => (x.id === b.id ? { ...x, status } : x)) };
}

export function bookingTotal(b: OpBooking): number {
  return b.total ?? (b.price != null ? b.price * b.qty : 0);
}

/**
 * What the operator receives for one booking: their own price behind the guest total, less Outset's 5%,
 * worked out by the same rule as the transfer, the Payouts page and the "You receive" line in their booking
 * email. A booking's `total` is what the guest paid, which carries the guest's service fee on top.
 *
 * Only real bookings are money. A sample row's total is the operator's price with no guest fee on it, so
 * taking a fee back off it would invent a discount the demo never gave; `isMoney` is the filter for that.
 */
export function bookingPayout(b: OpBooking): number {
  return operatorNet(bookingSubtotal(b));
}

/**
 * The operator's own price behind a booking. The API records it when it prices the booking, and that is the
 * number the transfer and the "Your price" line in the email use, so it is read first.
 *
 * Working it back out of the guest total is a guess, because the service fee steps down at $100 and $500 and
 * stops at $25: 600 of the operator prices between $1 and $2,000 in cent steps share a total with a higher
 * price, and the inverse returns the higher one. A $495.01 trip totals $515.01, comes back as $500.01, and
 * was shown to the operator as "you receive $475.01" against the $470.26 Stripe sends. The guess stays for a
 * booking made in this browser, which never had the API price it, and it is right for every other price.
 */
export function bookingSubtotal(b: OpBooking): number {
  if (b.subtotal != null && b.subtotal > 0) return b.subtotal;
  return subtotalFromTotal(bookingTotal(b));
}

/** A booking whose money is real. Sample rows are examples, and the Payouts page has never counted them. */
export const isMoney = (b: OpBooking): boolean => b.source !== "sample";

/** Cent-exact sum of what the operator receives across a list of bookings. */
export function payoutSum(rows: OpBooking[]): number {
  return rows.filter(isMoney).reduce((n, b) => n + Math.round(bookingPayout(b) * 100), 0) / 100;
}

/**
 * Money still to come: confirmed, not yet run, from today through the next seven days. The Home page's first
 * tile. A trip completed today is money already earned, and counting it here as well put the same booking in
 * both of that page's tiles at once.
 */
export function onTheBooks(bookings: OpBooking[], from: Date = startOfToday()): OpBooking[] {
  const todayKey = dateKey(from);
  const end = new Date(from);
  end.setDate(end.getDate() + 7);
  const endKey = dateKey(end);
  return bookings.filter((b) => b.status === "accepted" && b.date >= todayKey && b.date < endKey && isMoney(b));
}

/**
 * What the Home page's Next 7 days tab says when it has nothing to list. That tab lists confirmed bookings
 * only, so "Your calendar is open" was told to a shop with five requests waiting in that very week, two lines
 * under a Needs action badge reading 5, and to a shop whose next booking is eight days out.
 */
export function weekAheadLine(waiting: number, later: number): string {
  if (waiting > 0) return `Nothing confirmed in the next 7 days. ${waiting} ${waiting === 1 ? "request is" : "requests are"} still waiting on your answer.`;
  if (later > 0) return `Nothing in the next 7 days. ${later} ${later === 1 ? "booking" : "bookings"} after that.`;
  return "Nothing booked in the next 7 days. Your calendar is open.";
}

/** Money earned: trips completed in the last `days` days, up to and including today. The Home page's second tile. */
export function completedLately(bookings: OpBooking[], days = 30, from: Date = startOfToday()): OpBooking[] {
  const todayKey = dateKey(from);
  const start = new Date(from);
  start.setDate(start.getDate() - days);
  const startKey = dateKey(start);
  return bookings.filter((b) => b.status === "completed" && b.date >= startKey && b.date <= todayKey && isMoney(b));
}

/**
 * Whether an Accept, a Decline or a Cancel on this booking reaches the guest at all.
 *
 * Email is the only channel that exists, text messages are still deferred, and the booking form asks for a
 * name and a mobile and nothing else, so an address is optional. A decision is emailed by the API, which only
 * holds bookings that came through it: one made in this same browser, and a sample row, are decided on the
 * device and nothing goes anywhere. The drawer used to promise an automatic note in every one of those cases.
 */
export function guestHearsBack(b: OpBooking): boolean {
  return b.source === "remote" && !!b.email?.trim();
}

/** "$120", or "Quote" when the option had no published price. */
export function fmtTotal(b: OpBooking): string {
  if (b.total == null && b.price == null) return "Quote";
  // money() keeps cents at two places: a $7.50 add-on used to print "$7.5", and a fee total "$161.255".
  return money(bookingTotal(b));
}

/* ---------- the listing the guest sees, rebuilt from the profile ---------- */

/**
 * One day of the week as the listing's Hours block reads it out, and as Otto quotes it back when a guest asks
 * what time they open. The dashboard stores a 24 hour clock because that is what a time input speaks; a guest
 * page does not. Claiming a shop used to swap its own "9:00 AM - 5:00 PM" line for "Sun: 09:00 to 17:00", so
 * the one thing claiming should never change, the hours a guest reads, is the one thing it changed. Every
 * other time on the guest side is fmtTime, down to the rule that emails may never print a 24 hour clock.
 */
export function hoursLine(h: DayHours, i: number): string {
  return DAY_SHORT[i] + ": " + (h.closed ? "Closed" : fmtTime(h.open) + " to " + fmtTime(h.close));
}

export function toCatalog(p: OperatorProfile, base: Unclaimed): Partial<Unclaimed> {
  const options: UnclaimedOption[] = [];
  const services: UnclaimedService[] = [];
  for (const s of p.services) {
    // A row with no name is one the operator has not finished. A nameless line in the guest's picker is worse
    // than no line at all: there is nothing to tell them what they would be booking.
    if (!s.live || !s.variants.length || !s.name.trim()) continue;
    // "Add option" opens a blank row, and that row reached the guest page as a nameless "Price on request"
    // line next to the finished ones. A row with no label and no price is one the operator is still typing.
    // The last row stays whatever it holds, so a service is never published with nothing to pick.
    const rows = s.variants.length === 1 ? s.variants : s.variants.filter((v) => v.label.trim() || v.price != null);
    const variants = (rows.length ? rows : s.variants.slice(0, 1)).map((v) => {
      // A price saved by an older editor could be negative or not a number at all; the guest sees neither.
      const price = cleanPrice(v.price);
      options.push({ name: s.name, detail: v.label, price, per: "/" + v.per, perGuest: v.perGuest ?? perUnitLooksPerGuest(v.per) });
      return { label: v.label, price, per: "/" + v.per, optionIdx: options.length - 1 };
    });
    services.push({ name: s.name, desc: s.desc || null, photo: s.photo || undefined, variants, maxGuests: s.capacity > 0 ? s.capacity : undefined });
  }
  // "Add" under Add-ons opens an empty row, and that row reached the guest listing before the operator had
  // typed a character: an Add-ons section holding one nameless tick box reading "Free", which a guest could
  // tick and have turn up at the shop as an extra with no name. An add-on is on the menu once it has a name.
  const addons: UnclaimedOption[] = p.addons.filter((a) => a.name.trim()).map((a) => ({ name: a.name, detail: a.detail, price: cleanPrice(a.price) }));
  return {
    // A claimed shop that switched Instant Book on is the only kind a guest sees as Instant.
    instant: p.instantBook,
    // Paused in the dashboard: the guest page and the booking API both refuse new bookings until it is back on.
    accepting: p.accepting,
    // The Assistant page's switch. Off means the listing stops offering Otto to guests; before this the switch
    // saved and nothing read it, so an operator who turned Otto off still had it answering every guest.
    assistant: p.assistant,
    title: p.title || base.title,
    cat: p.cat,
    blurb: p.blurb || base.blurb,
    // The cover the operator picked, as long as it is still in their gallery, else the first photo they have,
    // else nothing. `undefined` is dropped by JSON on the way to every other device, so an operator who
    // removed a photo they did not want on their listing, or emptied the gallery altogether, published
    // `photos: []` and kept the crawled cover on every card, on the hero and in the guest's gallery, which
    // reads `cover` before `photos`. Their own browser showed the scene art, so only they could not see it.
    // "" survives the round trip and the Photo component falls back to the activity's scene art.
    cover: (p.photos.includes(p.cover) ? p.cover : p.photos[0]) || "",
    photos: p.photos,
    options,
    services,
    addons,
    gap: p.policy.length ? p.policy.join(" ") : base.gap,
    // The structured sections the listing page and Otto read. The operator's own lines replace the scraped ones.
    policies: p.policy.length ? p.policy : base.policies,
    // A cleared field is published as "" and not as undefined. This patch reaches guests through JSON (the API's
    // GET /profiles/:id and the nightly sync), and JSON drops an undefined key, so `{ ...scraped, ...patch }` on
    // the other side found no key and kept the scraped line: an operator who removed their cancellation policy
    // saw it back on their listing from any other device, together with the "Free cancellation" badge (`fc`)
    // read from it. An empty string survives the round trip and reads as "no line" everywhere it is used.
    cancellation: cancelLine(p, base),
    fc: freeCancel(cancelLine(p, base)) || "",
    // The operator's own version replaces the published text once they have opened that field, even if they cleared it.
    requirements: p.requirements ?? base.requirements,
    includes: p.includes ?? base.includes,
    checkin: p.checkin !== undefined ? p.checkin.trim() : base.checkin,
    faq: p.faq ? p.faq.filter((f) => f.q.trim() && f.a.trim()) : base.faq,
    hoursText: p.hours.some((h) => !h.closed) ? p.hours.map(hoursLine) : base.hoursText,
    // itemWeek() reads the compact `hrs` week before the hour lines, so a browse record that carries one would
    // keep showing the crawled hours after the operator changed them. The operator's hours win.
    //
    // An empty week and not `undefined`, for the reason spelled out above `cancellation`: this patch reaches
    // every guest who is not the operator as JSON, and JSON drops an undefined key, so the crawled week came
    // back on the other side and was read first. The operator's own browser showed their hours and nobody
    // else's did. A shop that published Monday to Saturday, 7 AM to 11 AM, and shut on Sunday, was advertised
    // to every guest as open nine to five every day of the week, Sunday included.
    hrs: p.hours.some((h) => !h.closed) ? [] : base.hrs,
    // Same story for the duration on the card, the listing hero, the booking sheet and Otto's answer, all of
    // which read `dur` before deriving one from the menu. `dur` is the duration crawled off the shop's site
    // before it was claimed, so an operator whose every service now says 90 min was still advertised as "4
    // hours". Their own menu wins where it states one; where it states none, the crawled fact stands.
    dur: menuDuration({ ...base, options, services }) || base.dur,
    // The operator's own guide replaces the kind's default once they have opened that section; absent keeps the default.
    guide: p.guide ? { steps: p.guide.steps.filter((s) => s.trim()), bring: p.guide.bring.filter((s) => s.trim()), goodFor: p.guide.goodFor.trim() } : undefined,
    contact: contactPatch(p, base),
  };
}

/**
 * The phone and address the guest page prints, from the profile. Before this the two fields saved and never
 * reached the listing: the page kept reading the crawled contact record. The crawled record is read past any
 * earlier override (`base` may already carry one), so clearing a field falls back to nothing, not to a stale edit.
 */
function contactPatch(p: OperatorProfile, base: Unclaimed): OperatorContact | undefined {
  // A seed or a test item may carry no source domain; then there is no crawled record to read past.
  const crawled = base.src ? contactFor({ ...base, contact: undefined }) : null;
  const phone = (p.phone || "").trim() || null;
  const address = (p.address || "").trim();
  if (!crawled && !phone && !address) return undefined;
  const blank: OperatorContact = { domain: "", website: null, phone: null, email: null, street: null, city: null, region: null, postal: null, hours: [], bookingVendor: null, fetchedAt: null };
  const c = crawled || blank;
  // Untouched since the claim: the profile carries the crawled line, or the area when the site had none.
  const sameAddress = address === ((crawled && addressLine(crawled)) || base.area || "");
  return {
    ...c,
    phone,
    ...(sameAddress ? {} : { street: address || null, city: null, region: null, postal: null }),
  };
}

/**
 * A profile built from the slim browse record has no services, photos or blurb. Once the operator's detail file
 * arrives, fill only what is still empty; anything the operator typed stays as it is.
 *
 * It runs once and then never again, because "still empty" stops meaning "we have not filled this in yet" the
 * moment the operator starts working. An owner who took their whole menu down, or deleted every photo, opened
 * the dashboard again and found the crawled menu back, every time, with no way to keep it off: the profile
 * had no record of the difference between a field nobody had filled and one the operator had emptied.
 */
/** The things-to-know fields as the listing publishes them: the operator starts from these and edits, not from blank boxes. */
export function knowFrom(u: Unclaimed): Pick<OperatorProfile, "cancellation" | "requirements" | "includes" | "checkin" | "faq"> {
  const out: Pick<OperatorProfile, "cancellation" | "requirements" | "includes" | "checkin" | "faq"> = {};
  if (u.cancellation) out.cancellation = u.cancellation.slice(0, KNOW_LIMITS.cancellation);
  if (u.requirements?.length) out.requirements = u.requirements.slice(0, KNOW_LIMITS.requirements);
  if (u.includes?.length) out.includes = u.includes.slice(0, KNOW_LIMITS.includes);
  if (u.checkin) out.checkin = u.checkin.slice(0, KNOW_LIMITS.checkin);
  if (u.faq?.length) out.faq = u.faq.slice(0, KNOW_LIMITS.faq).map((f) => ({ q: faqText(f.q).slice(0, KNOW_LIMITS.question), a: faqText(f.a).slice(0, KNOW_LIMITS.answer) }));
  return out;
}

export function hydrateProfile(p: OperatorProfile, full: Unclaimed): OperatorProfile {
  if (p.hydrated) return p;
  const next = { ...p };
  let changed = false;
  // A profile from before the things-to-know fields existed starts from what the listing publishes, once.
  for (const [k, v] of Object.entries(knowFrom(full)) as [keyof ReturnType<typeof knowFrom>, unknown][]) {
    if (p[k] === undefined && v !== undefined) {
      (next as Record<string, unknown>)[k] = v;
      changed = true;
    }
  }
  if (!p.services.length && (full.services?.length || full.options.length)) {
    next.services = servicesFrom(full);
    changed = true;
  }
  if (!p.photos.length && full.photos?.length) {
    next.photos = full.photos.slice();
    next.cover = p.cover || full.cover || full.photos[0];
    changed = true;
  }
  if (!p.blurb && full.blurb) {
    next.blurb = full.blurb;
    changed = true;
  }
  if (!p.addons.length && full.addons?.length) {
    next.addons = full.addons.map((a) => ({ id: uid("a"), name: a.name, detail: a.detail || "", price: a.price }));
    changed = true;
  }
  if (!p.policy.length && full.policies?.length) {
    next.policy = full.policies.filter((l) => l !== (next.cancellation ?? full.cancellation)).slice(0, 8);
    changed = true;
  }
  // Sample bookings belong to the demo dashboard only. A real owner's dashboard never shows made-up guests.
  if (changed && !p.bookings.length && isDemoProfile(next)) next.bookings = sampleBookings(next);
  if (!changed) return p;
  next.hydrated = true;
  return next;
}

function pushToCatalog(p: OperatorProfile, remote = true): void {
  const base = experienceById(p.id);
  if (!base) return;
  const patch = toCatalog(p, base);
  setOperatorOverride(p.id, patch, p.published);
  if (!remote) return;
  // Persist beyond this browser when the operator arrived through a signed claim link.
  saveRemoteProfile(p.id, { profile: p, patch, published: p.published, owner: { name: p.ownerName, email: p.ownerEmail, phone: p.ownerPhone } });
}

/* ---------- misc helpers for the screens ---------- */

export function pickDemoOperator(): Unclaimed | null {
  const all = getCatalog();
  const scored = all
    .filter((u) => u.services && u.services.length >= 2 && u.cover && u.options.length > 0 && u.options.every((o) => o.price != null))
    .map((u) => ({ u, s: ((u.photos?.length || 0) > 3 ? 2 : 0) + (u.metroId === "tampa" ? 3 : 0) + Math.min(4, u.services?.length || 0) + Math.min(3, Math.log10((u.reviews || 0) + 1)) }))
    .sort((a, b) => b.s - a.s);
  return scored[0]?.u || all[0] || null;
}

/** The dashboard a visitor sees before claiming: a real, well-filled operator with sample bookings. Reused if it already exists. */
export function demoProfile(): OperatorProfile | null {
  const u = pickDemoOperator();
  if (!u) return null;
  const existing = loadProfile(u.id);
  if (existing) return existing;
  const p = defaultProfile(u, { name: "Demo owner", email: "owner@example.com", phone: "" });
  p.bookings = sampleBookings(p);
  saveProfile(p);
  return p;
}

export function contactOf(p: OperatorProfile): OperatorContact | null {
  const u = experienceById(p.id);
  return u ? contactFor(u) : null;
}

/**
 * A spot in the dashboard a checklist item, or a click on the live preview, can jump straight to.
 * Each one names the page it lives on; the field itself carries data-jump="<name>" in the markup.
 */
export type JumpField = "title" | "about" | "photos" | "phone" | "address" | "policy" | "guide" | "services" | "price" | "hours" | "owner" | "payout";

export const JUMP_PAGE: Record<JumpField, "listing" | "services" | "hours" | "settings" | "payouts"> = {
  title: "listing",
  about: "listing",
  photos: "listing",
  phone: "listing",
  address: "listing",
  policy: "listing",
  guide: "listing",
  services: "services",
  price: "services",
  hours: "hours",
  owner: "settings",
  payout: "payouts",
};

/** True while the hours are still the 9 to 5 every day we fill in when a website names none. */
export function hoursAreDefault(p: OperatorProfile): boolean {
  return p.hours.every((h) => !h.closed && h.open === "09:00" && h.close === "17:00");
}

export function hasCancelLine(p: OperatorProfile): boolean {
  return !!p.cancellation?.trim() || p.policy.some((l) => /cancel|refund/i.test(l));
}

/** The cancellation line guests see: the operator's own field, else a cancellation line among their policies, else the published one. */
function cancelLine(p: OperatorProfile, base: Unclaimed): string {
  if (p.cancellation !== undefined) return p.cancellation.trim();
  return p.policy.find((l) => /cancel|refund/i.test(l)) || (p.policy.length ? "" : base.cancellation || "");
}

/* ---------- owner contact details (Settings) ---------- */

/** The same caps the API applies (backend/src/api/profiles.ts cleanOwner), so nothing is cut off silently on save. */
export const OWNER_NAME_MAX = 120;
export const OWNER_EMAIL_MAX = 200;
export const OWNER_PHONE_MAX = 40;

/** One address, no spaces, a dot in the domain. Booking alerts go here, so "not an email" must not count. */
export function validOwnerEmail(s: string): boolean {
  const t = s.trim();
  return t.length <= OWNER_EMAIL_MAX && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t);
}

/** Seven to fifteen digits once the punctuation is gone: "+1 (727) 555-0100", "727.555.0100". Letters or emoji are not a number. */
export function validOwnerPhone(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > OWNER_PHONE_MAX) return false;
  if (!/^[+\d][\d\s().-]*(?:\s*(?:x|ext\.?)\s*\d{1,6})?$/i.test(t)) return false;
  const digits = t.replace(/(?:x|ext\.?)\s*\d{1,6}$/i, "").replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

export type SetupCheck = { id: string; label: string; hint: string; done: boolean; page: string; field: JumpField };

/**
 * A price the guest will actually be charged. Zero is not one: the money code on both sides treats a zero as
 * no published price, so a guest booking a $0 option is told "Pay on site" and the operator's email carries no
 * money. The checklist counted it as done and said the menu was finished.
 */
export const isPriced = (v: OpVariant): boolean => v.price != null && v.price > 0;

/**
 * Only what guests can book, which is what toCatalog publishes. A service switched off is not on the menu, so
 * it is not a gap in the menu, and neither is one still waiting for a name: a guest never sees either.
 */
export const liveVariants = (p: OperatorProfile): OpVariant[] => p.services.filter((s) => s.live && s.name.trim()).flatMap((s) => s.variants);

/** Checklist that drives the setup progress on Home. */
export function setupChecks(p: OperatorProfile): SetupCheck[] {
  const live = liveVariants(p);
  const priced = live.filter(isPriced).length;
  const total = live.length;
  return [
    { id: "owner", label: "Add your name and mobile for booking alerts", hint: "So new bookings reach you", done: !!p.ownerName.trim() && (validOwnerPhone(p.ownerPhone) || validOwnerEmail(p.ownerEmail)), page: "settings", field: "owner" },
    ...listingChecks(p).map((c) => (c.id === "cover" ? { ...c, label: "Add at least 3 photos", done: p.photos.length >= 3 && !!p.cover } : c.id === "price" ? { ...c, label: total ? "Set a price on every option" : "Add your first service", done: total > 0 && priced === total } : c)),
    { id: "payout", label: "Connect your bank for payouts", hint: "Get paid for card bookings", done: !!p.payout, page: "payouts", field: "payout" },
  ];
}

/**
 * The few things that most change whether a guest books, in the order an owner should do them.
 * Shown at the top of the Listing page; each item jumps to the one field that fixes it.
 */
export function listingChecks(p: OperatorProfile): SetupCheck[] {
  const priced = liveVariants(p).some(isPriced);
  return [
    { id: "cover", label: "Cover photo", hint: "The first thing guests see", done: !!p.cover, page: "listing", field: "photos" },
    { id: "price", label: "A priced service", hint: p.services.length ? "Guests book what has a price" : "Add what guests can book", done: priced, page: "services", field: "price" },
    { id: "hours", label: "Opening hours", hint: "Check the times guests can pick", done: !hoursAreDefault(p) || !!p.hoursConfirmed, page: "hours", field: "hours" },
    { id: "phone", label: "Phone number", hint: "Guests call before they book", done: !!p.phone.trim(), page: "listing", field: "phone" },
    { id: "cancel", label: "Cancellation line", hint: "Guests look for it before paying", done: hasCancelLine(p), page: "listing", field: "policy" },
    { id: "about", label: "Short description", hint: "Two or three sentences", done: p.blurb.trim().length >= 60, page: "listing", field: "about" },
  ];
}

export function timeOptions(step = 30): string[] {
  const out: string[] = [];
  for (let m = 0; m < 24 * 60; m += step) out.push(String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"));
  return out;
}

export const minutesOfDay = (t: string): number => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

/**
 * The minutes a day's hours run for, from midnight of that day. A shop that closes after midnight ("10am to
 * 12am", "6pm to 1am") stores a close at or before its open, and its own website is where those hours came
 * from. Such a run ends past 1440 and its tail belongs to the next date. Mirrors runOf in the API's openSlots,
 * down to the rule that only a close in the small hours wraps: an opening time raised past the closing time is
 * an inverted day, not a night shift, and must not sell start times all night for a shop that is shut.
 */
export const LATEST_WRAP = 6 * 60;
export function hoursRun(h: DayHours | undefined): { start: number; end: number } | null {
  if (!h || h.closed) return null;
  const open = minutesOfDay(h.open);
  const close = minutesOfDay(h.close);
  if (!Number.isFinite(open) || !Number.isFinite(close) || close === open) return null;
  if (close > open) return { start: open, end: close };
  return close <= LATEST_WRAP ? { start: open, end: close + 1440 } : null;
}

/**
 * The start times this shop's hours put on one date: its own run up to midnight, plus whatever the day before
 * left past midnight. A close at or before the open used to produce nothing, so a shop open until midnight
 * showed the operator an empty calendar and offered a guest no time at all.
 *
 * A day the operator took off is this date's own business, and the calendar draws it closed itself. The tail
 * belongs to another date, though, and scheduledSlots in the API drops it when that date is off, so a shop
 * open Friday 6pm to 1am with Friday taken off offers a guest no midnight on Saturday. The calendar offered
 * the operator that midnight as an open slot until this read the same day off.
 */
export function slotsForDay(p: OperatorProfile, d: Date): string[] {
  const step = Number.isFinite(p.slotMinutes) && p.slotMinutes >= 15 ? p.slotMinutes : 60;
  const out: string[] = [];
  const push = (m: number) => out.push(String(Math.floor((m % 1440) / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"));
  const today = hoursRun(p.hours[d.getDay()]);
  if (today) for (let m = today.start; m + 1 <= Math.min(today.end, 1440); m += step) push(m);
  const before = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
  const prev = p.blockedDates.includes(dateKey(before)) ? null : hoursRun(p.hours[before.getDay()]);
  if (prev && prev.end > 1440) for (let m = prev.start; m + 1 <= prev.end; m += step) if (m >= 1440) push(m);
  return out.sort();
}

export function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function relDay(iso: string): string {
  const t = startOfToday();
  const d = isoToDate(iso);
  const diff = Math.round((d.getTime() - t.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  // A date in another year names it: "Wed, Dec 25" for a day off next Christmas read as this one.
  return DAY_SHORT[d.getDay()] + ", " + d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.getFullYear() === t.getFullYear() ? undefined : "numeric" });
}
