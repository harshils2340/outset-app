import { db } from "../db/client.ts";
import { fareharborShortname, peekRef, xolaSeller } from "./widgets.ts";

/**
 * Real open dates and times, read live from the operator's own booking system.
 *
 * FareHarbor, Peek and Xola all publish the calendar their own embed draws from, with no key and no
 * account: the same JSON a guest's browser already fetches when the widget loads on the operator's site.
 * So instead of guessing "probably 9am, 11am, 1pm" we show the operator's actual departures, how many
 * seats are left, and the vendor's own book link for that exact slot.
 *
 * Rules this file keeps, because these are someone else's servers:
 *  - 8 second timeout on every call, one attempt, no retries.
 *  - at most 3 upstream requests per operator per uncached call (MAX_CALLS).
 *  - a 10 minute in-memory cache, keyed by operator + window, plus a longer-lived cache of the vendor's
 *    catalog (item ids, activity ids, experience ids) so a second look at another date is nearly free.
 *  - nothing throws. A vendor that is slow, down, or has changed its shape returns { live: false } and the
 *    listing page falls back to whatever it showed before.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TIMEOUT_MS = 8000;
const MAX_CALLS = 3;
const TTL_MS = 10 * 60 * 1000;
const CATALOG_TTL_MS = 60 * 60 * 1000;
const MAX_DAYS = 60;

export type Slot = {
  /** Local wall-clock start, "YYYY-MM-DDTHH:MM". The vendor's own timezone, not ours: never shift it. */
  startsAt: string;
  /** What the guest reads: "8:15 AM · Waikiki Glass Bottom Boat Cruise". */
  label: string;
  priceCents?: number;
  seatsLeft?: number;
  bookUrl: string;
};
export type AvailabilityDay = { date: string; slots: Slot[] };
export type Availability = {
  vendor: "fareharbor" | "peek" | "xola" | null;
  live: boolean;
  updatedAt: string;
  days: AvailabilityDay[];
  /** Set when the vendor answered but the request budget stopped us short of the whole window. */
  partial?: boolean;
  note?: string;
};

/* ---------- plumbing ---------- */

type Cached = { at: number; value: unknown };
const cache = new Map<string, Cached>();
const catalogCache = new Map<string, Cached>();

function cacheGet<T>(m: Map<string, Cached>, key: string, ttl: number): T | null {
  const hit = m.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > ttl) {
    m.delete(key);
    return null;
  }
  return hit.value as T;
}
function cacheSet(m: Map<string, Cached>, key: string, value: unknown): void {
  if (m.size > 5000) m.clear();
  m.set(key, { at: Date.now(), value });
}

/** One upstream attempt. No retry: their server said what it said. */
async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json", ...headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** A hard budget of upstream calls, shared across every request a single lookup makes. */
function budget(max: number) {
  let left = max;
  return {
    get left() {
      return left;
    },
    async get<T>(url: string, headers?: Record<string, string>): Promise<T | null> {
      if (left <= 0) return null;
      left -= 1;
      return getJson<T>(url, headers);
    },
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The window as a list of "YYYY-MM-DD", walked in UTC so a DST change cannot drop or double a day. */
function windowDates(fromISO: string, days: number): string[] {
  const start = new Date(fromISO + "T00:00:00Z");
  const out: string[] = [];
  for (let i = 0; i < days; i += 1) out.push(isoDate(new Date(start.getTime() + i * 86400000)));
  return out;
}

/** "1730" or 1730 to "17:30". Xola and Xola-style schedules carry times as HHMM integers. */
function hhmm(raw: number | string): string | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 2359) return null;
  const h = Math.floor(n / 100);
  const m = n % 100;
  if (h > 23 || m > 59) return null;
  return `${pad(h)}:${pad(m)}`;
}

/** "17:30" to "5:30 PM". */
function clock(time: string): string {
  const [hs, ms] = time.split(":");
  const h = Number(hs);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${ms} ${suffix}`;
}

const labelOf = (time: string, name: string) => (name ? `${clock(time)} · ${name}` : clock(time));

function emptyDays(dates: string[]): Map<string, Slot[]> {
  return new Map(dates.map((d) => [d, [] as Slot[]]));
}

function shape(vendor: Availability["vendor"], byDate: Map<string, Slot[]>, dates: string[], extra: Partial<Availability> = {}): Availability {
  return {
    vendor,
    live: true,
    updatedAt: new Date().toISOString(),
    days: dates.map((date) => ({ date, slots: (byDate.get(date) || []).slice(0, 40) })),
    ...extra,
  };
}

const dead = (vendor: Availability["vendor"], note?: string): Availability => ({ vendor, live: false, updatedAt: new Date().toISOString(), days: [], ...(note ? { note } : {}) });

/* ---------- FareHarbor ----------
 * fareharbor.com/api/v1/companies/<shortname>/calendar/<YYYY>/<MM>/
 *   -> every departure the whole company sells that month, each carrying its item, start_at, capacity
 *      left, is_sold_out and a book_url. One call covers an operator with twenty boats, which matters:
 *      Hubbard's Marina runs seventeen items with September departures, so reading them one at a time
 *      spent the whole call budget on three of them and reported an empty calendar.
 * fareharbor.com/api/v1/companies/<shortname>/items/[<pk>/calendar/<YYYY>/<MM>/] -> the same per item,
 *      kept as a fallback for the rare company whose month calendar does not answer.
 * Both answer JSON to a plain unauthenticated fetch, no key and no partner agreement. (The
 * /minimal/availabilities/date/<d>/ path is a 404; /availabilities/date/<d>/ works but costs a call a day.) */

type FhItem = { pk: number; name: string; uri?: string; is_archived?: boolean; is_unlisted?: boolean; is_private?: boolean; is_retail?: boolean };
type FhAvailability = {
  start_at?: string;
  approximate_available_capacity?: number | null;
  is_sold_out?: boolean;
  is_bookable?: boolean;
  is_unlisted?: boolean;
  book_url?: string | null;
  availability_headline?: string | null;
  item?: FhItem;
};
type FhCalendar = { calendar?: { weeks?: { days?: { at?: string; availabilities?: FhAvailability[] }[] }[] } };

/**
 * Which trip a departure belongs to. The company calendar usually carries only a stub reference,
 * `{ cls, uri }`, so the name comes from the item catalog by primary key; a private, retail or archived
 * item is not something a guest can book and is left out.
 */
function fhItemOf(a: FhAvailability, byPk: Map<number, FhItem>): FhItem | null {
  const ref = a.item;
  const pk = typeof ref?.pk === "number" ? ref.pk : Number(ref?.uri?.match(/\/items\/(\d+)\//)?.[1] ?? NaN);
  const it = Number.isFinite(pk) ? byPk.get(pk) : null;
  const full = it || (ref?.name ? ref : null);
  if (!full || !full.name) return null;
  return full.is_archived || full.is_unlisted || full.is_private || full.is_retail ? null : full;
}

function monthsOf(dates: string[]): string[] {
  return [...new Set(dates.map((d) => d.slice(0, 7)))];
}

async function fareharbor(shortname: string, dates: string[]): Promise<Availability> {
  const b = budget(MAX_CALLS);
  const base = "https://fareharbor.com/api/v1/companies/" + encodeURIComponent(shortname) + "/";
  const want = new Set(dates);
  const months = monthsOf(dates);
  const byDate = emptyDays(dates);

  // The item catalog, cached for a day: the calendar's departures name their trip only by primary key.
  const key = "fh:" + shortname;
  let items = cacheGet<FhItem[]>(catalogCache, key, CATALOG_TTL_MS);
  if (!items) {
    const listed = await b.get<{ items: FhItem[] }>(base + "items/");
    if (!listed?.items) return dead("fareharbor", "item catalog unavailable");
    items = listed.items.filter((i) => i && i.name && !i.is_archived && !i.is_unlisted && !i.is_private && !i.is_retail);
    cacheSet(catalogCache, key, items);
  }
  if (!items.length) return dead("fareharbor", "no bookable items");
  const byPk = new Map(items.map((i) => [i.pk, i]));

  const add = (at: string, a: FhAvailability, item: FhItem): void => {
    if (!a.start_at || a.is_unlisted || a.is_sold_out || a.is_bookable === false) return;
    // Capacity zero on a departure FareHarbor still calls bookable and not sold out means the company keeps its
    // numbers private, not that the boat is full: 135 of Hubbard's Marina's 151 September departures read that
    // way. So is_sold_out and is_bookable decide whether to show it, and a seat count is only quoted when real.
    const cap = a.approximate_available_capacity;
    const seats = typeof cap === "number" && cap > 0 ? cap : undefined;
    const startsAt = a.start_at.slice(0, 16);
    byDate.get(at)!.push({
      startsAt,
      label: labelOf(startsAt.slice(11, 16), a.availability_headline || item.name),
      ...(seats != null ? { seatsLeft: seats } : {}),
      bookUrl: a.book_url ? "https://fareharbor.com" + a.book_url : `https://fareharbor.com/embeds/book/${shortname}/items/${item.pk}/`,
    });
  };

  // One call a month for the whole company, which is every departure of every boat.
  const monthCals = await Promise.all(
    months.map((ym) => {
      const [y, m] = ym.split("-");
      return b.get<FhCalendar>(`${base}calendar/${y}/${m}/`);
    }),
  );
  let reached = 0;
  for (const cal of monthCals) {
    if (!cal?.calendar?.weeks) continue;
    reached += 1;
    for (const week of cal.calendar.weeks) {
      for (const day of week.days || []) {
        if (!day.at || !want.has(day.at)) continue;
        for (const a of day.availabilities || []) {
          const item = fhItemOf(a, byPk);
          if (item) add(day.at, a, item);
        }
      }
    }
  }

  // Only when the company calendar says nothing: walk items one at a time, as far as the budget reaches.
  let partial: { partial?: boolean; note?: string } = {};
  if (!reached) {
    const jobs: { item: FhItem; ym: string }[] = [];
    for (const item of items) for (const ym of months) if (jobs.length < b.left) jobs.push({ item, ym });
    const cals = await Promise.all(
      jobs.map(({ item, ym }) => {
        const [y, m] = ym.split("-");
        return b.get<FhCalendar>(`${base}items/${item.pk}/calendar/${y}/${m}/`);
      }),
    );
    for (let i = 0; i < jobs.length; i += 1) {
      const cal = cals[i];
      if (!cal?.calendar?.weeks) continue;
      reached += 1;
      for (const week of cal.calendar.weeks) {
        for (const day of week.days || []) {
          if (!day.at || !want.has(day.at)) continue;
          for (const a of day.availabilities || []) add(day.at, a, fhItemOf(a, byPk) || jobs[i].item);
        }
      }
    }
    const covered = items.length * months.length;
    if (jobs.length < covered) partial = { partial: true, note: `${jobs.length} of ${covered} item-months read` };
  }
  if (!reached) return dead("fareharbor", "calendar unavailable");
  for (const list of byDate.values()) list.sort((x, y) => x.startsAt.localeCompare(y.startsAt));
  return shape("fareharbor", byDate, dates, partial);
}

/* ---------- Peek ----------
 * book.peek.com/services/api/programs/<code>                                  -> the activities
 * book.peek.com/services/api/availability-dates?activity-id=&start-date=&end-date=  -> which dates are open
 * book.peek.com/services/api/availability-dates/<date>/availability-times?activity_id=  -> that date's
 *   start times, seats and per-ticket prices.
 * The key in the operator's own book.peek.com/s/<key>/<code> URL is the public widget key; it is the same
 * one their embed sends from the browser. Dates are cheap (one call for the window), times cost one call
 * per date, so a wide window gets open dates plus real times for the first few open ones, and a request
 * for a single date spends the whole budget on that date's times. */

type PeekDoc = { data?: { id: string }; included?: { type: string; id: string; attributes: Record<string, unknown> }[] };
type PeekDates = { data?: { id: string; attributes?: { date?: string; "availability-status"?: string; "num-start-times"?: number; "price-range"?: { amount: string }[] } }[] };
type PeekTimes = {
  data?: {
    id: string;
    attributes?: { time?: string; spots?: number; prices?: { pricing?: { price?: { amount?: string }; list_price?: { amount?: string } }[] }[] };
  }[];
};

const peekHeaders = (key: string) => ({ Accept: "application/vnd.api+json", Authorization: "Key " + key });

type PeekPrices = { pricing?: { price?: { amount?: string }; list_price?: { amount?: string } }[] }[];

function peekLowest(prices: PeekPrices | undefined): number | undefined {
  const amounts: number[] = [];
  for (const p of prices || []) {
    for (const row of p.pricing || []) {
      const n = Number(row.price?.amount ?? row.list_price?.amount);
      if (Number.isFinite(n) && n > 0) amounts.push(n);
    }
  }
  return amounts.length ? Math.round(Math.min(...amounts) * 100) : undefined;
}

async function peek(refKey: string, code: string, dates: string[]): Promise<Availability> {
  const b = budget(MAX_CALLS);
  const api = "https://book.peek.com/services/api/";
  const h = peekHeaders(refKey);

  const ckey = "peek:" + refKey + ":" + code;
  let activities = cacheGet<{ id: string; name: string }[]>(catalogCache, ckey, CATALOG_TTL_MS);
  if (!activities) {
    const doc = await b.get<PeekDoc>(api + "programs/" + encodeURIComponent(code), h);
    if (!doc?.included) return dead("peek", "program unavailable");
    activities = doc.included
      .filter((x) => x.type === "activity" && typeof x.attributes?.name === "string")
      .map((x) => ({ id: x.id, name: String(x.attributes.name) }));
    cacheSet(catalogCache, ckey, activities);
  }
  if (!activities.length) return dead("peek", "no activities");

  const from = dates[0];
  const to = dates[dates.length - 1];
  const want = new Set(dates);
  const byDate = emptyDays(dates);
  const bookUrl = `https://book.peek.com/s/${refKey}/${code}`;
  const open: { date: string; activity: { id: string; name: string } }[] = [];
  let reached = false;

  // Open dates, per activity, merged. One call each while the budget lasts.
  for (const act of activities) {
    if (b.left <= 1 && open.length) break;
    if (b.left <= 0) break;
    const url = `${api}availability-dates?activity-id=${encodeURIComponent(act.id)}&start-date=${from}&end-date=${to}&use-legacy-api=false`;
    const res = await b.get<PeekDates>(url, h);
    if (!res?.data) continue;
    reached = true;
    for (const row of res.data) {
      const date = row.attributes?.date || row.id;
      if (!date || !want.has(date)) continue;
      if (row.attributes?.["availability-status"] !== "available") continue;
      open.push({ date, activity: act });
    }
  }
  if (!reached) return dead("peek", "availability feed unavailable");
  open.sort((x, y) => x.date.localeCompare(y.date));

  // Real start times for as many of the open dates as the budget still allows.
  let timed = 0;
  for (const slot of open) {
    if (b.left <= 0) break;
    const url = `${api}availability-dates/${slot.date}/availability-times?activity_id=${encodeURIComponent(slot.activity.id)}&use-legacy-api=false`;
    const res = await b.get<PeekTimes>(url, h);
    if (!res?.data) continue;
    timed += 1;
    for (const row of res.data) {
      const raw = row.attributes?.time;
      if (!raw) continue;
      const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(raw.trim());
      if (!m) continue;
      let h24 = Number(m[1]) % 12;
      if (m[3] && m[3].toUpperCase() === "PM") h24 += 12;
      if (!m[3]) h24 = Number(m[1]);
      const time = `${pad(h24)}:${m[2]}`;
      const spots = typeof row.attributes?.spots === "number" ? row.attributes.spots : undefined;
      if (spots === 0) continue;
      const priceCents = peekLowest(row.attributes?.prices);
      byDate.get(slot.date)!.push({
        startsAt: `${slot.date}T${time}`,
        label: labelOf(time, slot.activity.name),
        ...(priceCents != null ? { priceCents } : {}),
        ...(spots != null ? { seatsLeft: spots } : {}),
        bookUrl,
      });
    }
  }

  // Dates the budget never reached still say "open" — one all-day slot, so the page can offer the date.
  for (const slot of open) {
    const list = byDate.get(slot.date)!;
    if (list.length) continue;
    list.push({ startsAt: slot.date + "T00:00", label: slot.activity.name || "Available", bookUrl });
  }
  for (const list of byDate.values()) list.sort((x, y) => x.startsAt.localeCompare(y.startsAt));
  return shape("peek", byDate, dates, timed < open.length ? { partial: true, note: `exact times read for ${timed} of ${open.length} open dates` } : {});
}

/* ---------- Xola ----------
 * xola.com/api/experiences?seller=<id>                               -> the seller's published experiences
 * xola.com/api/availability?experience=<id,id,id>&start=&end=        -> { expId: { date: { HHMM: seatsLeft } } }
 * Both are public. This is the richest of the three: real seats left per departure, for every experience
 * in one call. */

type XolaExp = { id: string; name: string; status?: string; visible?: boolean; priceSchemes?: { price: number }[] };
type XolaAvail = Record<string, Record<string, Record<string, number>> | unknown[]>;

async function xola(seller: string, dates: string[]): Promise<Availability> {
  const b = budget(MAX_CALLS);

  const ckey = "xola:" + seller;
  let exps = cacheGet<XolaExp[]>(catalogCache, ckey, CATALOG_TTL_MS);
  if (!exps) {
    const res = await b.get<{ data: XolaExp[] }>("https://xola.com/api/experiences?seller=" + encodeURIComponent(seller) + "&limit=100");
    if (!res?.data) return dead("xola", "experience feed unavailable");
    exps = res.data.filter((e) => e && e.name && (!e.status || e.status === "published") && e.visible !== false);
    cacheSet(catalogCache, ckey, exps);
  }
  if (!exps.length) return dead("xola", "no published experiences");

  // One availability call covers many experiences; cap the id list so the URL stays sane.
  const batch = exps.slice(0, 12);
  const ids = batch.map((e) => e.id).join(",");
  const url = `https://xola.com/api/availability?experience=${encodeURIComponent(ids)}&start=${dates[0]}&end=${dates[dates.length - 1]}`;
  const avail = await b.get<XolaAvail>(url);
  if (!avail || typeof avail !== "object") return dead("xola", "availability feed unavailable");

  const want = new Set(dates);
  const byDate = emptyDays(dates);
  for (const e of batch) {
    const rows = avail[e.id];
    if (!rows || Array.isArray(rows)) continue;
    const prices = (e.priceSchemes || []).map((p) => p.price).filter((n) => typeof n === "number" && n > 0);
    const priceCents = prices.length ? Math.round(Math.min(...prices) * 100) : undefined;
    const bookUrl = `https://checkout.xola.com/index.html#seller/${seller}/experiences/${e.id}`;
    for (const [date, times] of Object.entries(rows as Record<string, Record<string, number>>)) {
      if (!want.has(date) || !times || typeof times !== "object") continue;
      for (const [raw, seats] of Object.entries(times)) {
        const time = hhmm(raw);
        if (!time) continue;
        if (typeof seats === "number" && seats <= 0) continue;
        byDate.get(date)!.push({
          startsAt: `${date}T${time}`,
          label: labelOf(time, e.name),
          ...(priceCents != null ? { priceCents } : {}),
          ...(typeof seats === "number" ? { seatsLeft: seats } : {}),
          bookUrl,
        });
      }
    }
  }
  for (const list of byDate.values()) list.sort((x, y) => x.startsAt.localeCompare(y.startsAt));
  return shape("xola", byDate, dates, exps.length > batch.length ? { partial: true, note: `${batch.length} of ${exps.length} experiences read` } : {});
}

/* ---------- lookup ---------- */

/**
 * The booking URL for an operator. Accepts the raw operators.id (a uuid) or the guest-facing listing id
 * the site uses ("o-<domain slug>"), because the listing page only ever knows the latter.
 */
export function bookingUrlFor(operatorId: string): string | null {
  const byId = db.prepare("SELECT fact_value FROM facts WHERE operator_id = ? AND fact_key = 'booking_url' LIMIT 1").get(operatorId) as { fact_value?: string } | undefined;
  if (byId?.fact_value) return byId.fact_value;
  if (!operatorId.startsWith("o-")) return null;
  // "o-example-com" was built as slug(domain); match it back without scanning every row in JS.
  const row = db
    .prepare(
      `SELECT f.fact_value AS fact_value FROM operators o
         JOIN facts f ON f.operator_id = o.id AND f.fact_key = 'booking_url'
        WHERE 'o-' || replace(replace(lower(o.domain), '.', '-'), '/', '-') = ?
        LIMIT 1`,
    )
    .get(operatorId) as { fact_value?: string } | undefined;
  return row?.fact_value || null;
}

export function vendorFor(bookingUrl: string): "fareharbor" | "peek" | "xola" | null {
  if (fareharborShortname(bookingUrl)) return "fareharbor";
  if (peekRef(bookingUrl)) return "peek";
  if (xolaSeller(bookingUrl)) return "xola";
  return null;
}

/**
 * The operator's real calendar for `days` days starting `fromISO`, or { live: false } when there is no
 * supported vendor, the vendor did not answer, or anything at all went wrong. Never throws.
 */
export async function getAvailability(operatorId: string, fromISO: string, days: number): Promise<Availability> {
  try {
    const from = DATE_RE.test(fromISO) && !Number.isNaN(Date.parse(fromISO + "T00:00:00Z")) ? fromISO : isoDate(new Date());
    const span = Math.min(Math.max(Math.trunc(days) || 14, 1), MAX_DAYS);
    const key = `${operatorId}|${from}|${span}`;
    const hit = cacheGet<Availability>(cache, key, TTL_MS);
    if (hit) return hit;

    const bookingUrl = bookingUrlFor(operatorId);
    if (!bookingUrl) return dead(null, "no booking url");
    const vendor = vendorFor(bookingUrl);
    if (!vendor) return dead(null, "unsupported booking system");

    const dates = windowDates(from, span);
    let result: Availability;
    if (vendor === "fareharbor") result = await fareharbor(fareharborShortname(bookingUrl)!, dates);
    else if (vendor === "peek") {
      const ref = peekRef(bookingUrl)!;
      result = await peek(ref.key, ref.code, dates);
    } else result = await xola(xolaSeller(bookingUrl)!, dates);

    // Only cache an answer worth keeping; a failure should be retried on the next look, not pinned for 10 minutes.
    if (result.live) cacheSet(cache, key, result);
    return result;
  } catch {
    return dead(null, "unavailable");
  }
}
