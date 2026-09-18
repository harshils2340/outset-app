import { Hono } from "hono";
import { ID, rateLimit } from "./auth.ts";
import { getProfile, listBookings } from "../lib/repo.ts";
import type { StoredBooking } from "./bookings.ts";
import type { StoredProfile } from "./profiles.ts";
import { instantOf, todayIn, zoneForArea } from "../lib/zone.ts";
import { readJson } from "../lib/store.ts";
import { encodeWeek, isTradingHoursLine } from "../sync/hours.ts";
import { startTimesOn, type StatedDay } from "../../../src/lib/startTimes.ts";

/**
 * Which start times a guest may still book, and the one rule the booking route enforces so two guests cannot
 * take the same time.
 *
 * A claimed shop's dashboard sets the hours, the slot length, the notice, the window, days off and blocked
 * slots (all in `profile`, the dashboard's own record). An unclaimed listing has none of that, so it offers
 * the fixed times the guest page always showed, minus the ones its own published hours say it is shut for
 * (`week`, and `src/lib/startTimes.ts` for the rule). Either way a time drops out once the bookings at it
 * reach the service's capacity; with no capacity known, one booking fills it. That is what "once you book
 * something it disappears" means here.
 *
 * `GET /bookings/open/:listing?from=YYYY-MM-DD&days=N&service=<name>&guests=N` is public and read-only: it says
 * which times are open to a party that size, never who booked them.
 */

/** The fixed times an unclaimed listing offers. Mirrors src/data/slots.ts. */
export const DEFAULT_SLOTS = ["07:00", "09:00", "11:00", "13:00", "15:00", "17:00"];
const MAX_DAYS = 60;
/** A guest on the Stripe page holds the time this long; the session itself expires after 30 minutes. */
const PENDING_HOLD_MS = 30 * 60 * 1000;

/** The seven days an unclaimed listing's own website publishes, Sunday first. Null when it publishes none. */
export type PublishedWeek = StatedDay[] | null;

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

/**
 * The dashboard record is stored as the operator's device sent it, so nothing here may assume a field has the
 * shape it should. `services: "none"` in one saved profile made this route, and every booking for that listing,
 * answer 500 on `.filter is not a function`: one bad write took the shop's guest booking path down for good.
 */
const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

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

/**
 * The minutes one weekday's hours run for, as an open interval from midnight of that day. A shop that closes
 * after midnight ("10am to 12am", "6pm to 1am") stores a closing time at or before its opening time, and its
 * own website is where those hours came from, so this is not a typo an operator can be asked to fix. Such a run
 * ends past 1440 and its tail belongs to the next calendar date. Closed, unreadable and zero-length days have
 * no run at all.
 *
 * Only a close in the small hours wraps. An operator who raises the opening time past their own closing time
 * has inverted the day by accident, not moved it past midnight, and reading 6pm to 5pm as a 23 hour shift
 * would sell start times all night for a shop that is shut.
 */
const LATEST_WRAP = 6 * 60;
function runOf(h: DayHours | undefined): { start: number; end: number } | null {
  if (!h || h.closed) return null;
  const open = minutes(h.open);
  const close = minutes(h.close);
  if (!Number.isFinite(open) || !Number.isFinite(close) || close === open) return null;
  if (close > open) return { start: open, end: close };
  return close <= LATEST_WRAP ? { start: open, end: close + 1440 } : null;
}

/**
 * The times a shop's own settings open on one day, before bookings are counted.
 *
 * A day's own evening run ends at midnight, and the hours of the day before can leave a tail on this one: a
 * shop open Friday 6pm to 1am offers midnight on Saturday, because Saturday is the date that guest turns up on
 * and the date their booking is stored under. Before this, a close at or before the open produced nothing at
 * all, so a listing whose hours row read "Open until 12:00 AM" answered "No more start times today" on every
 * day of the year and neither the guest nor the operator was told why.
 */
export function scheduledSlots(profile: DashboardProfile | null, date: string, now = new Date(), zone?: string | null, week?: PublishedWeek): string[] {
  const d = dayOf(date);
  if (!d) return [];
  // A shop's opening times are wall clock times where it stands, so both "what day is it" and "has this time
  // passed" have to be asked in its zone. Without one, fall back to the server's, which is what this did
  // everywhere before and is only right for a listing whose region we do not know.
  const todayKey = zone ? todayIn(zone, now) : iso(now);
  if (date < todayKey) return [];
  // Notice: a time is bookable only when it is at least `lead` hours away. Unclaimed listings keep the one
  // hour the guest page always applied.
  const lead = profile ? (Number.isFinite(profile.leadHours) ? Number(profile.leadHours) : 2) : 1;
  const earliestMs = now.getTime() + lead * 3600000;
  const atOf = (t: string) =>
    zone ? instantOf(date, t, zone) : new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(minutes(t) / 60), minutes(t) % 60).getTime();
  const soonEnough = (t: string) => atOf(t) >= earliestMs;
  if (!profile || !Array.isArray(profile.hours) || profile.hours.length !== 7) {
    // Nobody has claimed this listing, so the fixed times are all we have, minus the ones the shop's own
    // website says it is shut for. `startTimes.ts` has the rule and the phone and desktop pages read the same
    // one; a day the site says nothing about keeps all six.
    return startTimesOn(week ? week[d.getDay()] ?? null : null, DEFAULT_SLOTS).filter(soonEnough);
  }
  const window = Number.isFinite(profile.windowDays) && Number(profile.windowDays) > 0 ? Number(profile.windowDays) : 60;
  const from = dayOf(todayKey) || new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const last = new Date(from.getFullYear(), from.getMonth(), from.getDate() + window);
  if (d > last) return [];
  const off = new Set(asArray<string>(profile.blockedDates).map(String));
  if (off.has(date)) return [];
  const step = Number.isFinite(profile.slotMinutes) && Number(profile.slotMinutes) >= 15 ? Number(profile.slotMinutes) : 60;
  const blocked = new Set(asArray<string>(profile.blockedSlots).filter((s) => String(s).startsWith(date + "|")).map((s) => String(s).slice(date.length + 1)));
  const out: string[] = [];
  const push = (m: number) => {
    const t = hhmm(m % 1440);
    if (soonEnough(t) && !blocked.has(t)) out.push(t);
  };
  // This day's own run, up to midnight. Anything past midnight is the next date's.
  const today = runOf(profile.hours[d.getDay()]);
  if (today) for (let m = today.start; m + 1 <= Math.min(today.end, 1440); m += step) push(m);
  // The tail the day before left on this one, on the same grid its evening ran on. A day the operator took off
  // is off for its late session too.
  const before = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
  const prev = off.has(iso(before)) ? null : runOf(profile.hours[before.getDay()]);
  if (prev && prev.end > 1440) for (let m = prev.start; m + 1 <= prev.end; m += step) if (m >= 1440) push(m);
  return out.sort();
}

/** How many guests one time can hold for a service. Unknown means one booking fills it. */
export function capacityFor(profile: DashboardProfile | null, service: string): number | null {
  const live = asArray<NonNullable<DashboardProfile["services"]>[number]>(profile?.services).filter((s) => s && s.live !== false);
  const named = live.find((s) => key(s.name) === key(service));
  const cap = named?.capacity ?? (live.length ? Math.max(...live.map((s) => Number(s.capacity) || 0)) : 0);
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
export function slotOpen(profile: DashboardProfile | null, bookings: StoredBooking[], date: string, slot: string, service: string, qty: number, now = new Date(), zone?: string | null, week?: PublishedWeek): { open: boolean; reason?: string } {
  if (!scheduledSlots(profile, date, now, zone, week).includes(slot)) return { open: false, reason: "That time is not open for booking" };
  const cap = capacityFor(profile, service);
  const taken = bookedAt(bookings, date, slot, now.getTime());
  if (cap == null) return taken.count ? { open: false, reason: "That time was just booked" } : { open: true };
  if (taken.qty + Math.max(1, qty) <= cap) return { open: true };
  // A time with two seats left is still offered, so a party of four was told "that time was just booked" for a
  // time nobody had taken out, reloaded the picker, saw it there, and was told the same thing again. Say what is
  // actually left, so the guest can bring fewer people or pick a time that holds them all.
  const left = cap - taken.qty;
  if (left <= 0) return { open: false, reason: "That time was just booked" };
  if (!taken.qty) return { open: false, reason: `That time holds ${cap} guest${cap === 1 ? "" : "s"}, not ${qty}` };
  return { open: false, reason: `Only ${left} spot${left === 1 ? "" : "s"} left at that time` };
}

export type OpenDay = { date: string; slots: string[] };

/**
 * `guests` is the party the page is about to book for. A time that holds one more guest is open to a single
 * guest and not to a couple, and the picker offered it to both: the couple picked it, were refused, reloaded,
 * and saw it offered again. Asking for the party size means a time the party does not fit in is simply not
 * there. It defaults to one, which is what the route answered before.
 */
/**
 * Which times are open across a run of days, without asking the same question twice.
 *
 * The obvious loop calls slotOpen once per slot, and slotOpen rebuilds that day's whole schedule and rescans
 * every booking each time, so a sixty day answer did that work several hundred times over. The party size and
 * the service capacity do not change between slots, and the bookings can be counted in one pass, so they are.
 * The result is the same as calling slotOpen on every slot, which is what the test asserts.
 *
 * Pure on purpose: everything it needs is passed in, so it can be tested without a database.
 */
export function openDaysFor(profile: DashboardProfile | null, list: StoredBooking[], start: Date, days: number, service: string, guests: number, now: Date, zone?: string | null, week?: PublishedWeek): OpenDay[] {
  const cap = capacityFor(profile, service);
  const need = Math.max(1, guests);
  const nowMs = now.getTime();
  // One pass over the bookings instead of one pass per slot.
  const taken = new Map<string, number>();
  for (const b of list) {
    if (!holdsSlot(b, nowMs)) continue;
    const key = b.date + "|" + b.slot;
    taken.set(key, (taken.get(key) || 0) + Math.max(1, Number(b.qty) || 1));
  }
  const out: OpenDay[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const date = iso(d);
    // Once per day, not once per slot.
    const slots = scheduledSlots(profile, date, now, zone, week).filter((t) => {
      const q = taken.get(date + "|" + t) || 0;
      return cap == null ? q === 0 : q + need <= cap;
    });
    out.push({ date, slots });
  }
  return out;
}

const ZONE_TTL = 60 * 60 * 1000;
export type DetailFile = { area?: string; lat?: number; lon?: number; hrs?: ([number, number] | null)[]; hoursText?: string[]; contact?: { hours?: string[] } | null };
type ListingFacts = { zone: string | null; week: PublishedWeek };
const facts = new Map<string, { at: number; facts: ListingFacts }>();

/**
 * The week the operator's own website publishes, as the guest app reads it (`itemWeek` in `src/lib/openNow.ts`).
 * The compact week the nightly sync baked into the detail file comes first, and the hour lines themselves are
 * the fallback, read by the sync's own parser, which is that file's twin. Lines that are not trading hours at
 * all (a campground's quiet hours) take the compact week down with them, because it was encoded from them.
 */
export function weekIn(detail: DetailFile | null): PublishedWeek {
  if (!detail) return null;
  const lines = (detail.hoursText || []).filter(isTradingHoursLine);
  if (detail.hoursText?.length && !lines.length) return null;
  const compact = Array.isArray(detail.hrs) && detail.hrs.length === 7 ? detail.hrs.map(statedDay) : null;
  if (compact && compact.some((d) => d)) return compact;
  // Hundreds of listings publish no hours of their own and carry them on their synced contact record instead,
  // which is where the listing page reads them from too (`contactFor`). Missing that made the two disagree.
  const from = lines.length ? lines : detail.contact?.hours || [];
  const parsed = from.length ? encodeWeek(from) : null;
  return parsed ? parsed.map(statedDay) : null;
}

/** One encoded day as a stated day, dropping anything no clock could show. Mirrors `compactDay`. */
function statedDay(d: [number, number] | null): StatedDay {
  if (!d) return null;
  const [open, close] = d;
  if (open === 0 && close === 0) return { open, close };
  // "00:00-23:59" is what a site builder writes when the owner never set any hours, not a shop open all day.
  if (open === 0 && close >= 24 * 60 - 1) return null;
  return open >= 0 && open < 24 * 60 && close > open && close - open <= 24 * 60 ? { open, close } : null;
}

/**
 * The listing's own timezone and published week. Read from the generated detail file, which the nightly sync
 * writes, so they are remembered for an hour rather than fetched on every slot request. A listing we cannot
 * place answers a null zone and the schedule falls back to the server's, unchanged.
 */
async function factsOf(listing: string): Promise<ListingFacts> {
  const hit = facts.get(listing);
  if (hit && Date.now() - hit.at < ZONE_TTL) return hit.facts;
  const detail = await readJson<DetailFile>(`o/${listing}.json`).catch(() => null);
  const found: ListingFacts = { zone: zoneForArea(detail?.area, detail?.lat, detail?.lon), week: weekIn(detail) };
  if (facts.size > 5000) facts.clear();
  facts.set(listing, { at: Date.now(), facts: found });
  return found;
}

export async function zoneOf(listing: string): Promise<string | null> {
  return (await factsOf(listing)).zone;
}

/** The hours the listing's own site publishes, for the days an unclaimed listing may offer start times on. */
export async function weekOf(listing: string): Promise<PublishedWeek> {
  return (await factsOf(listing)).week;
}

export async function openSlots(listing: string, from: string, days: number, service = "", now = new Date(), guests = 1): Promise<{ known: boolean; claimed: boolean; days: OpenDay[] }> {
  const [rec, list, known] = await Promise.all([
    getProfile<StoredProfile>(listing).catch(() => null),
    listBookings<StoredBooking>(listing).catch(() => [] as StoredBooking[]),
    factsOf(listing).catch(() => ({ zone: null, week: null }) as ListingFacts),
  ]);
  const profile = (rec?.profile as DashboardProfile | null) || null;
  const zone = known.zone;
  const start = dayOf(from) || dayOf(zone ? todayIn(zone, now) : iso(now)) || new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return { known: true, claimed: !!profile, days: openDaysFor(profile, list, start, days, service, guests, now, zone, known.week) };
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
  const guestsRaw = String(c.req.query("guests") ?? "").trim();
  if (guestsRaw && !/^\d{1,2}$/.test(guestsRaw)) return c.json({ error: "guests must be a number" }, 400);
  const guests = Math.min(Math.max(Number(guestsRaw || 1), 1), 60);
  c.header("cache-control", "no-store");
  return c.json(await openSlots(id, fromRaw, days, service, new Date(), guests));
});
