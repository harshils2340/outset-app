import type { Booking, CategoryId, OperatorContact, Unclaimed, UnclaimedOption, UnclaimedService } from "../data/types";
import { saveRemoteProfile } from "./api";
import { addressLine, contactFor, experienceById, fmtPhone, getCatalog, setOperatorOverride, siteUrl } from "./catalog";
import { dateKey, startOfToday } from "./dates";

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
  addons?: string[];
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM, 24 hour */
  slot: string;
  status: OpStatus;
  note?: string;
  created: number;
  /** guest: a real booking made in this browser's guest app. sample: seeded so the dashboard is not empty. */
  source: "guest" | "sample";
};

export type OpVariant = { id: string; label: string; price: number | null; per: string };

export type OpService = {
  id: string;
  name: string;
  desc: string;
  live: boolean;
  durationMin: number;
  capacity: number;
  variants: OpVariant[];
};

export type OpAddon = { id: string; name: string; detail: string; price: number | null };

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
};

const SESSION_KEY = "outset.operator.session.v1";
const PROFILE_PREFIX = "outset.operator.profile.v1.";
const INDEX_KEY = "outset.operator.index.v1";

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const PER_UNITS = ["person", "hour", "trip", "boat", "group", "vehicle", "room", "day"];

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

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota / private mode */
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

export function loadProfile(id: string): OperatorProfile | null {
  const p = read<OperatorProfile>(PROFILE_PREFIX + id);
  return p && p.v === 1 ? p : null;
}

export function saveProfile(p: OperatorProfile): void {
  write(PROFILE_PREFIX + p.id, p);
  const idx = new Set(read<string[]>(INDEX_KEY) || []);
  idx.add(p.id);
  write(INDEX_KEY, Array.from(idx));
  pushToCatalog(p);
}

export function deleteProfile(id: string): void {
  try {
    localStorage.removeItem(PROFILE_PREFIX + id);
  } catch {
    /* ignore */
  }
  const idx = (read<string[]>(INDEX_KEY) || []).filter((x) => x !== id);
  write(INDEX_KEY, idx);
  setOperatorOverride(id, null, true);
}

/** Every business claimed in this browser. */
export function claimedIds(): string[] {
  return read<string[]>(INDEX_KEY) || [];
}

/** Called once after the catalog loads so guest pages show operator edits. */
export function applyStoredProfiles(): number {
  let n = 0;
  for (const id of claimedIds()) {
    const p = loadProfile(id);
    if (p) {
      pushToCatalog(p);
      n += 1;
    }
  }
  return n;
}

/* ---------- defaults from the scraped record ---------- */

const TIME_RE = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i;
const DAY_RE: [RegExp, number[]][] = [
  [/\b(daily|every ?day|7 days)\b/i, [0, 1, 2, 3, 4, 5, 6]],
  [/\bmon(?:day)?\s*(?:-|–|to|through)\s*fri(?:day)?\b/i, [1, 2, 3, 4, 5]],
  [/\bmon(?:day)?\s*(?:-|–|to|through)\s*sat(?:urday)?\b/i, [1, 2, 3, 4, 5, 6]],
  [/\bmon(?:day)?\s*(?:-|–|to|through)\s*sun(?:day)?\b/i, [0, 1, 2, 3, 4, 5, 6]],
  [/\bsat(?:urday)?\s*(?:-|–|to|through|&|and)\s*sun(?:day)?\b/i, [0, 6]],
  [/\bweekends?\b/i, [0, 6]],
  [/\bweekdays?\b/i, [1, 2, 3, 4, 5]],
  [/\bsun(?:day)?\b/i, [0]],
  [/\bmon(?:day)?\b/i, [1]],
  [/\btue(?:s|sday)?\b/i, [2]],
  [/\bwed(?:nesday)?\b/i, [3]],
  [/\bthu(?:rs|rsday)?\b/i, [4]],
  [/\bfri(?:day)?\b/i, [5]],
  [/\bsat(?:urday)?\b/i, [6]],
];

function to24(h: number, m: number, ap: string | undefined, fallbackPm: boolean): string {
  let hh = h;
  const a = (ap || "").toLowerCase();
  if (a === "pm" && hh < 12) hh += 12;
  if (a === "am" && hh === 12) hh = 0;
  if (!a && fallbackPm && hh < 12 && hh < 8) hh += 12;
  return String(hh).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

/** Best effort read of scraped hour lines. Unknown days fall back to 9 to 5. */
export function parseHours(lines: string[]): DayHours[] {
  const out: DayHours[] = Array.from({ length: 7 }, () => ({ closed: false, open: "09:00", close: "17:00" }));
  let touched = false;
  for (const line of lines) {
    const t = TIME_RE.exec(line);
    const closed = /\bclosed\b/i.test(line);
    let days: number[] | null = null;
    for (const [re, d] of DAY_RE) {
      if (re.test(line)) {
        days = d;
        break;
      }
    }
    if (!days) days = t ? [0, 1, 2, 3, 4, 5, 6] : null;
    if (!days) continue;
    for (const d of days) {
      if (closed && !t) {
        out[d] = { closed: true, open: "09:00", close: "17:00" };
        touched = true;
      } else if (t) {
        out[d] = { closed: false, open: to24(Number(t[1]), Number(t[2] || 0), t[3], false), close: to24(Number(t[4]), Number(t[5] || 0), t[6], true) };
        touched = true;
      }
    }
  }
  void touched;
  return out;
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
      durationMin: 60,
      capacity: 8,
      variants: s.variants.map((v) => ({ id: uid("v"), label: v.label, price: v.price, per: unitOf(v.per || u.options[v.optionIdx]?.per) })),
    }));
  }
  if (u.options.length) {
    return u.options.map((o) => ({
      id: uid("s"),
      name: o.name,
      desc: "",
      live: true,
      durationMin: 60,
      capacity: 8,
      variants: [{ id: uid("v"), label: o.detail || "Standard", price: o.price, per: unitOf(o.per) }],
    }));
  }
  return [];
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
    instantBook: true,
    assistant: true,
    title: u.title,
    cat: u.cat,
    blurb: u.blurb || "",
    phone: c?.phone ? fmtPhone(c.phone) : "",
    email: c?.email || "",
    website: c?.website || (u.src && !u.src.startsWith("osm-") ? siteUrl(u.src) : ""),
    address: (c && addressLine(c)) || u.area,
    cover: u.cover || "",
    photos: (u.photos || []).slice(),
    policy: u.gap && !/not stated|not published|unknown/i.test(u.gap) ? [u.gap] : [],
    services: servicesFrom(u),
    addons: (u.addons || []).map((a) => ({ id: uid("a"), name: a.name, detail: a.detail || "", price: a.price })),
    hours: parseHours(c?.hours || []),
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

export function sampleBookings(p: OperatorProfile): OpBooking[] {
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
    const r = (seed + k * 7919) % 1000;
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
      const optIdx = b.addons.length && /^\d+$/.test(b.addons[0]) ? Number(b.addons[0]) : null;
      const opt = optIdx != null && u ? u.options[optIdx] : null;
      const extras = b.addons.filter((a) => !/^\d+$/.test(a));
      return {
        id: "g" + b.code,
        code: b.code,
        guest: "Guest " + b.code.slice(-2),
        service: opt?.name || (u?.title ?? "Booking"),
        variant: opt?.detail || "",
        price: opt?.price ?? null,
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

export function allBookings(p: OperatorProfile, guest: Booking[]): OpBooking[] {
  return [...guestBookingsFor(p, guest), ...p.bookings].sort((a, b) => a.date.localeCompare(b.date) || a.slot.localeCompare(b.slot));
}

export function setBookingStatus(p: OperatorProfile, b: OpBooking, status: OpStatus): OperatorProfile {
  if (b.source === "guest") return { ...p, decisions: { ...p.decisions, [b.code]: status } };
  return { ...p, bookings: p.bookings.map((x) => (x.id === b.id ? { ...x, status } : x)) };
}

export function bookingTotal(b: OpBooking): number {
  return b.total ?? (b.price != null ? b.price * b.qty : 0);
}

/** "$120", or "Quote" when the option had no published price. */
export function fmtTotal(b: OpBooking): string {
  if (b.total == null && b.price == null) return "Quote";
  return "$" + bookingTotal(b).toLocaleString("en-US");
}

/* ---------- the listing the guest sees, rebuilt from the profile ---------- */

export function toCatalog(p: OperatorProfile, base: Unclaimed): Partial<Unclaimed> {
  const options: UnclaimedOption[] = [];
  const services: UnclaimedService[] = [];
  for (const s of p.services) {
    if (!s.live || !s.variants.length) continue;
    const variants = s.variants.map((v) => {
      options.push({ name: s.name, detail: v.label, price: v.price, per: "/" + v.per });
      return { label: v.label, price: v.price, per: "/" + v.per, optionIdx: options.length - 1 };
    });
    services.push({ name: s.name, desc: s.desc || null, variants });
  }
  const addons: UnclaimedOption[] = p.addons.map((a) => ({ name: a.name, detail: a.detail, price: a.price }));
  return {
    title: p.title || base.title,
    cat: p.cat,
    blurb: p.blurb || base.blurb,
    cover: p.cover || undefined,
    photos: p.photos,
    options,
    services,
    addons,
    gap: p.policy.length ? p.policy.join(" ") : base.gap,
  };
}

function pushToCatalog(p: OperatorProfile): void {
  const base = experienceById(p.id);
  if (!base) return;
  const patch = toCatalog(p, base);
  setOperatorOverride(p.id, patch, p.published);
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

/** Checklist that drives the setup progress on Home. */
export function setupChecks(p: OperatorProfile): { id: string; label: string; done: boolean; page: string }[] {
  const priced = p.services.flatMap((s) => s.variants).filter((v) => v.price != null).length;
  const total = p.services.flatMap((s) => s.variants).length;
  return [
    { id: "owner", label: "Add your name and mobile for booking alerts", done: !!p.ownerName.trim() && !!(p.ownerPhone.trim() || p.ownerEmail.trim()), page: "settings" },
    { id: "photos", label: "Add at least 3 photos", done: p.photos.length >= 3 && !!p.cover, page: "listing" },
    { id: "prices", label: total ? "Set a price on every option" : "Add your first service", done: total > 0 && priced === total, page: "services" },
    { id: "hours", label: "Confirm your opening hours", done: p.hours.some((h) => !h.closed), page: "hours" },
    { id: "about", label: "Write a short description", done: p.blurb.trim().length >= 60, page: "listing" },
    { id: "contact", label: "Add a phone number and address", done: !!p.phone && !!p.address, page: "listing" },
    { id: "policy", label: "State your cancellation policy", done: p.policy.length > 0, page: "listing" },
    { id: "payout", label: "Add a payout method", done: !!p.payout, page: "payouts" },
  ];
}

export function timeOptions(step = 30): string[] {
  const out: string[] = [];
  for (let m = 0; m < 24 * 60; m += step) out.push(String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"));
  return out;
}

export function slotsForDay(p: OperatorProfile, d: Date): string[] {
  const h = p.hours[d.getDay()];
  if (!h || h.closed) return [];
  const [oh, om] = h.open.split(":").map(Number);
  const [ch, cm] = h.close.split(":").map(Number);
  const out: string[] = [];
  for (let m = oh * 60 + om; m + 1 <= ch * 60 + cm; m += p.slotMinutes) out.push(String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"));
  return out;
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
  return DAY_SHORT[d.getDay()] + ", " + d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
