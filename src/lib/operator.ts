import type { Booking, CategoryId, OperatorContact, Unclaimed, UnclaimedOption, UnclaimedService } from "../data/types";
import { forgetClaim, saveRemoteProfile, type RemoteBooking } from "./api";
import { addressLine, contactFor, experienceById, fmtPhone, getCatalog, setOperatorOverride, siteUrl } from "./catalog";
import { dateKey, startOfToday } from "./dates";
import { fmtTime } from "./format";
import { freeCancel } from "./listingDerive";

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
  source: "guest" | "sample" | "remote";
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
  /** The owner looked at the 9 to 5 hours we filled in for them and said they are right. */
  hoursConfirmed?: boolean;
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

// Plenty of sites write "9:00 a.m. – 6:00 p.m.", and with only bare am/pm accepted the whole line was dropped
// and the shop was given an invented 9 to 5 week instead of the one it published.
const TIME_RE = /(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?\s*(?:-|–|—|to)\s*(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)/i;
const DAY_NO: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const DAY_WORD = "(sun|mon|tue|wed|thu|fri|sat)[a-z]*\\.?";
/** "Friday through Sunday", "Tue-Sat", "Thurs – Mon". Wraps round the week, so Friday to Sunday is Fri, Sat, Sun. */
const RANGE_RE = new RegExp("\\b" + DAY_WORD + "\\s*(?:-|–|—|to|through|thru|till|until)\\s*" + DAY_WORD + "\\b", "i");
/** Every day the line names, in the order they appear: "Mon, Wed & Fri" is three days, not one. */
const DAY_LIST_RE = new RegExp("\\b" + DAY_WORD + "\\b", "gi");
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/**
 * The days one published line is about. A named range is expanded round the week; anything else is every
 * weekday name the line carries. Only "Friday through Sunday" style ranges expand: "Monday & Friday" is two
 * days, not five.
 */
function daysIn(line: string): number[] | null {
  if (/\b(daily|every ?day|7 days|all week)\b/i.test(line)) return ALL_DAYS;
  if (/\bweekends?\b/i.test(line)) return [0, 6];
  if (/\bweekdays?\b/i.test(line)) return [1, 2, 3, 4, 5];
  const range = RANGE_RE.exec(line);
  if (range) {
    const from = DAY_NO[range[1].toLowerCase()];
    const to = DAY_NO[range[2].toLowerCase()];
    const out: number[] = [];
    for (let i = 0; i < 7; i++) {
      const d = (from + i) % 7;
      out.push(d);
      if (d === to) break;
    }
    return out;
  }
  const named = Array.from(line.matchAll(DAY_LIST_RE), (m) => DAY_NO[m[1].toLowerCase()]);
  const uniq = named.filter((d, i) => named.indexOf(d) === i);
  return uniq.length ? uniq : null;
}

function to24(h: number, m: number, ap: string | undefined, fallbackPm: boolean): string {
  let hh = h;
  const a = (ap || "").toLowerCase().replace(/\./g, "");
  if (a === "pm" && hh < 12) hh += 12;
  if (a === "am" && hh === 12) hh = 0;
  if (!a && fallbackPm && hh < 12 && hh < 8) hh += 12;
  return String(hh).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

/**
 * Best effort read of the hour lines the operator's own site published.
 *
 * A shop that published nothing has no week to show, so it starts on a plain 9 to 5 the owner can correct.
 * A shop that published something has said which days it opens, and a day it did not name is a day it did not
 * say it opens. Keeping the 9 to 5 on those days invented availability: "open Saturday & Sunday only from
 * 11:00am to 7:00pm" came out as a shop open Monday to Friday 9 to 5, and a dropzone flying Friday through
 * Sunday took Monday bookings. Unnamed days are closed instead, and the Availability page shows the whole
 * week, so an owner who does open on one can switch it back on in a click.
 */
export function parseHours(lines: string[]): DayHours[] {
  const out: DayHours[] = Array.from({ length: 7 }, () => ({ closed: false, open: "09:00", close: "17:00" }));
  const spoken = Array.from({ length: 7 }, () => false);
  for (const line of lines) {
    const t = TIME_RE.exec(line);
    const closed = /\bclosed\b/i.test(line);
    const days = daysIn(line) || (t ? ALL_DAYS : null);
    if (!days) continue;
    for (const d of days) {
      if (closed && !t) {
        out[d] = { closed: true, open: "09:00", close: "17:00" };
        spoken[d] = true;
      } else if (t) {
        out[d] = { closed: false, open: to24(Number(t[1]), Number(t[2] || 0), t[3], false), close: to24(Number(t[4]), Number(t[5] || 0), t[6], true) };
        spoken[d] = true;
      }
    }
  }
  if (spoken.some(Boolean)) for (let d = 0; d < 7; d++) if (!spoken[d]) out[d] = { closed: true, open: "09:00", close: "17:00" };
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
      durationMin: minutesIn(s.variants.map((v) => v.label).join(" ")) || 60,
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
      durationMin: minutesIn(o.detail) || 60,
      capacity: 8,
      variants: [{ id: uid("v"), label: o.detail || "Standard", price: o.price, per: unitOf(o.per) }],
    }));
  }
  return [];
}

/** "1.5 hours", "90 min", "2 hr" as minutes; 0 when the text names none. */
export function minutesIn(text: string | null | undefined): number {
  const m = (text || "").match(/(\d+(?:\.\d+)?)\s*(?:-|to)?\s*(\d+(?:\.\d+)?)?\s*(hours?|hrs?|h\b|minutes?|mins?|m\b)/i);
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
    phone: c?.phone ? fmtPhone(c.phone) : "",
    email: c?.email || "",
    website: c?.website || (u.src && !u.src.startsWith("osm-") ? siteUrl(u.src) : ""),
    address: (c && addressLine(c)) || u.area,
    cover: u.cover || "",
    photos: (u.photos || []).slice(),
    policy: [...(u.policies || []), ...(u.gap && !/not stated|not published|unknown|not copied|we'?ll ask|we will ask|ask when you request/i.test(u.gap) ? [u.gap] : [])].filter((l, i, a) => a.indexOf(l) === i).slice(0, 8),
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
        guest: b.guest?.name || "Guest " + b.code.slice(-2),
        email: b.guest?.email,
        phone: b.guest?.phone,
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
    addons: b.addons,
    date: b.date,
    slot: b.slot,
    status: b.status as OpStatus,
    note: b.note,
    created: Date.parse(b.created) || Date.now(),
    source: "remote" as const,
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

/** "$120", or "Quote" when the option had no published price. */
export function fmtTotal(b: OpBooking): string {
  if (b.total == null && b.price == null) return "Quote";
  return "$" + bookingTotal(b).toLocaleString("en-US");
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
    const variants = s.variants.map((v) => {
      options.push({ name: s.name, detail: v.label, price: v.price, per: "/" + v.per });
      return { label: v.label, price: v.price, per: "/" + v.per, optionIdx: options.length - 1 };
    });
    services.push({ name: s.name, desc: s.desc || null, variants });
  }
  // "Add" under Add-ons opens an empty row, and that row reached the guest listing before the operator had
  // typed a character: an Add-ons section holding one nameless tick box reading "Free", which a guest could
  // tick and have turn up at the shop as an extra with no name. An add-on is on the menu once it has a name.
  const addons: UnclaimedOption[] = p.addons.filter((a) => a.name.trim()).map((a) => ({ name: a.name, detail: a.detail, price: a.price }));
  return {
    // A claimed shop that switched Instant Book on is the only kind a guest sees as Instant.
    instant: p.instantBook,
    // Paused in the dashboard: the guest page and the booking API both refuse new bookings until it is back on.
    accepting: p.accepting,
    title: p.title || base.title,
    cat: p.cat,
    blurb: p.blurb || base.blurb,
    cover: p.cover || undefined,
    photos: p.photos,
    options,
    services,
    addons,
    gap: p.policy.length ? p.policy.join(" ") : base.gap,
    // The structured sections the listing page and Otto read. The operator's own lines replace the scraped ones.
    policies: p.policy.length ? p.policy : base.policies,
    cancellation: p.policy.find((l) => /cancel|refund/i.test(l)) || (p.policy.length ? undefined : base.cancellation),
    fc: freeCancel(p.policy.find((l) => /cancel|refund/i.test(l)) || (p.policy.length ? "" : base.cancellation)) || undefined,
    hoursText: p.hours.some((h) => !h.closed) ? p.hours.map(hoursLine) : base.hoursText,
  };
}

/**
 * A profile built from the slim browse record has no services, photos or blurb. Once the operator's detail file
 * arrives, fill only what is still empty; anything the operator typed stays as it is.
 */
export function hydrateProfile(p: OperatorProfile, full: Unclaimed): OperatorProfile {
  const next = { ...p };
  let changed = false;
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
    next.policy = full.policies.slice(0, 8);
    changed = true;
  }
  // Sample bookings belong to the demo dashboard only. A real owner's dashboard never shows made-up guests.
  if (changed && !p.bookings.length && isDemoProfile(next)) next.bookings = sampleBookings(next);
  return changed ? next : p;
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
export type JumpField = "title" | "about" | "photos" | "phone" | "address" | "policy" | "services" | "price" | "hours" | "owner" | "payout";

export const JUMP_PAGE: Record<JumpField, "listing" | "services" | "hours" | "settings" | "payouts"> = {
  title: "listing",
  about: "listing",
  photos: "listing",
  phone: "listing",
  address: "listing",
  policy: "listing",
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
  return p.policy.some((l) => /cancel|refund/i.test(l));
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
    { id: "owner", label: "Add your name and mobile for booking alerts", hint: "So new bookings reach you", done: !!p.ownerName.trim() && !!(p.ownerPhone.trim() || p.ownerEmail.trim()), page: "settings", field: "owner" },
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
  return DAY_SHORT[d.getDay()] + ", " + d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
