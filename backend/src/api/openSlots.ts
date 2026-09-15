import { Hono } from "hono";
import { ID, rateLimit } from "./auth.ts";
import { getProfile, listBookings } from "../lib/repo.ts";
import type { StoredBooking } from "./bookings.ts";
import type { StoredProfile } from "./profiles.ts";

/**
 * Which start times a guest may still book, and the one rule the booking route enforces so two guests cannot
 * take the same time.
 *
 * A claimed shop's dashboard sets the hours, the slot length, the notice, the window, days off and blocked
 * slots (all in `profile`, the dashboard's own record). An unclaimed listing has none of that, so it offers
 * the same fixed times the guest page always showed. Either way a time drops out once the bookings at it
 * reach the service's capacity; with no capacity known, one booking fills it. That is what "once you book
 * something it disappears" means here.
 *
 * `GET /bookings/open/:listing?from=YYYY-MM-DD&days=N&service=<name>` is public and read-only: it says which
 * times are open, never who booked them.
 */

/** The fixed times an unclaimed listing offers. Mirrors src/data/slots.ts. */
export const DEFAULT_SLOTS = ["07:00", "09:00", "11:00", "13:00", "15:00", "17:00"];
const MAX_DAYS = 60;
/** A guest on the Stripe page holds the time this long; the session itself expires after 30 minutes. */
const PENDING_HOLD_MS = 30 * 60 * 1000;

type DayHours = { closed: boolean; open: string; close: string };
type DashboardProfile = {
  hours?: DayHours[];
  slotMinutes?: number;
  leadHours?: number;
  windowDays?: number;
  blockedDates?: string[];
  blockedSlots?: string[];
  services?: { name?: string; live?: boolean; capacity?: number }[];
};

const hhmm = (m: number) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
const minutes = (t: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
const key = (s: string | undefined) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * A real day on the calendar. new Date(2027, 1, 30) rolls forward to March 2, so "2027-02-30" used to be
 * answered with another day's times instead of being called bad input.
 */
function dayOf(date: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
}
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The times a shop's own settings open on one day, before bookings are counted. */
export function scheduledSlots(profile: DashboardProfile | null, date: string, now = new Date()): string[] {
  const d = dayOf(date);
  if (!d) return [];
  const todayKey = iso(now);
  if (date < todayKey) return [];
  // Notice: a time is bookable only when it is at least `lead` hours away. Unclaimed listings keep the one
  // hour the guest page always applied.
  const lead = profile ? (Number.isFinite(profile.leadHours) ? Number(profile.leadHours) : 2) : 1;
  const earliestMs = now.getTime() + lead * 3600000;
  const soonEnough = (t: string) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(minutes(t) / 60), minutes(t) % 60).getTime() >= earliestMs;
  if (!profile || !Array.isArray(profile.hours) || profile.hours.length !== 7) {
    return DEFAULT_SLOTS.filter(soonEnough);
  }
  const window = Number.isFinite(profile.windowDays) && Number(profile.windowDays) > 0 ? Number(profile.windowDays) : 60;
  const last = new Date(now.getFullYear(), now.getMonth(), now.getDate() + window);
  if (d > last) return [];
  if ((profile.blockedDates || []).includes(date)) return [];
  const h = profile.hours[d.getDay()];
  if (!h || h.closed) return [];
  const open = minutes(h.open);
  const close = minutes(h.close);
  const step = Number.isFinite(profile.slotMinutes) && Number(profile.slotMinutes) >= 15 ? Number(profile.slotMinutes) : 60;
  if (!Number.isFinite(open) || !Number.isFinite(close) || close <= open) return [];
  const blocked = new Set((profile.blockedSlots || []).filter((s) => s.startsWith(date + "|")).map((s) => s.slice(date.length + 1)));
  const out: string[] = [];
  for (let m = open; m + 1 <= close; m += step) {
    const t = hhmm(m);
    if (soonEnough(t) && !blocked.has(t)) out.push(t);
  }
  return out;
}

/** How many guests one time can hold for a service. Unknown means one booking fills it. */
export function capacityFor(profile: DashboardProfile | null, service: string): number | null {
  const list = (profile?.services || []).filter((s) => s.live !== false);
  const named = list.find((s) => key(s.name) === key(service));
  const cap = named?.capacity ?? (list.length ? Math.max(...list.map((s) => Number(s.capacity) || 0)) : 0);
  return Number.isFinite(cap) && cap > 0 ? cap : null;
}

/** Bookings that hold a time: requests, confirmed trips, and a card session that is still fresh. */
export function holdsSlot(b: StoredBooking, now = Date.now()): boolean {
  if (b.status === "new" || b.status === "accepted" || b.status === "completed") return true;
  if (b.status === "pending") return now - (Date.parse(b.created) || 0) < PENDING_HOLD_MS;
  return false;
}

/** Guests already booked at one time, and whether any booking sits there at all. */
export function bookedAt(list: StoredBooking[], date: string, slot: string, now = Date.now()): { count: number; qty: number } {
  let count = 0;
  let qty = 0;
  for (const b of list) {
    if (b.date !== date || b.slot !== slot || !holdsSlot(b, now)) continue;
    count++;
    qty += Math.max(1, Number(b.qty) || 1);
  }
  return { count, qty };
}

/** Whether a time can still take `qty` more guests for `service`. */
export function slotOpen(profile: DashboardProfile | null, list: StoredBooking[], date: string, slot: string, service: string, qty: number, now = new Date()): { open: boolean; reason?: string } {
  if (!scheduledSlots(profile, date, now).includes(slot)) return { open: false, reason: "That time is not open for booking" };
  const cap = capacityFor(profile, service);
  const taken = bookedAt(list, date, slot, now.getTime());
  if (cap == null) return taken.count ? { open: false, reason: "That time was just booked" } : { open: true };
  return taken.qty + Math.max(1, qty) <= cap ? { open: true } : { open: false, reason: taken.qty ? "That time was just booked" : "Not enough room at that time" };
}

export type OpenDay = { date: string; slots: string[] };

export async function openSlots(listing: string, from: string, days: number, service = "", now = new Date()): Promise<{ known: boolean; claimed: boolean; days: OpenDay[] }> {
  const rec = await getProfile<StoredProfile>(listing).catch(() => null);
  const profile = (rec?.profile as DashboardProfile | null) || null;
  const list = await listBookings<StoredBooking>(listing).catch(() => [] as StoredBooking[]);
  const start = dayOf(from) || new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const out: OpenDay[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const date = iso(d);
    const slots = scheduledSlots(profile, date, now).filter((t) => slotOpen(profile, list, date, t, service, 1, now).open);
    out.push({ date, slots });
  }
  return { known: true, claimed: !!profile, days: out };
}

export const openSlotsRoute = new Hono();

openSlotsRoute.get("/bookings/open/:listing", rateLimit(240, 60 * 60 * 1000), async (c) => {
  const id = String(c.req.param("listing") ?? "");
  if (!ID.test(id)) return c.json({ error: "bad listing" }, 400);
  const fromRaw = String(c.req.query("from") ?? "").trim();
  if (fromRaw && !dayOf(fromRaw)) return c.json({ error: "from must be YYYY-MM-DD" }, 400);
  const daysRaw = String(c.req.query("days") ?? "").trim();
  if (daysRaw && !/^\d{1,3}$/.test(daysRaw)) return c.json({ error: "days must be a number" }, 400);
  const days = Math.min(Math.max(Number(daysRaw || 14), 1), MAX_DAYS);
  const service = String(c.req.query("service") ?? "").slice(0, 120);
  c.header("cache-control", "no-store");
  return c.json(await openSlots(id, fromRaw, days, service));
});
