import { db } from "../db/client.ts";
import { fareharborShortname, peekRef, xolaSeller } from "./widgets.ts";
import { safeFetch } from "../lib/safeFetch.ts";
import { openFarePrice } from "../lib/fares.ts";

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
  /**
   * Set on a row that exists only to mark the date as open: the vendor said this date has departures and the
   * request budget ran out before their clock times were read. `startsAt` then carries the date and a
   * midnight that means nothing, so nothing may offer it as a start time.
   */
  timeUnknown?: true;
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
    const res = await safeFetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json", ...headers },
      timeoutMs: TIMEOUT_MS,
      maxBytes: 5_000_000,
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

  /**
   * One row per departure, however many times the calendar hands it to us.
   *
   * A FareHarbor month calendar is laid out in whole weeks, so it runs from the Sunday before the first of the
   * month to the Saturday after the last: September 2026 answers with 30 August to 3 October, and October with
   * 27 September to 31 October. Any window that crosses a month boundary therefore reads the straddling week
   * twice, and every departure in it was being added twice. Hawaii Glass Bottom Boats' 27 September came back
   * as 38 rows that were 19 departures, the same 8:15 cruise listed twice with the same seat count and the same
   * book link, and roughly half of all fourteen day windows cross a boundary.
   *
   * `book_url` carries FareHarbor's own availability primary key and so is the departure's identity; where the
   * company hides it, the trip and its start are. Two boats running the same trip name at nine are two items
   * with two pks and stay two rows, which is what a guest choosing between them needs.
   */
  const seen = new Set<string>();

  const add = (at: string, a: FhAvailability, item: FhItem): void => {
    if (!a.start_at || a.is_unlisted || a.is_sold_out || a.is_bookable === false) return;
    const identity = at + "|" + (a.book_url || `${a.start_at}|${item.pk}`);
    if (seen.has(identity)) return;
    seen.add(identity);
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

type PeekPrices = { pricing?: { price?: { amount?: string }; list_price?: { amount?: string } }[]; ticket_id?: string }[];

/**
 * The cheapest fare an adult could actually buy on this departure.
 *
 * It used to be the cheapest row of any kind, and a Peek price row carries no name, so an operator selling
 * Adult $100 and Infant $20 had every slot on the guest's listing page labelled $20. The concierge already
 * refused to do that for FareHarbor; the listing page, which reads this file, had no such rule at all, and
 * the two surfaces quoted different prices for the same shop.
 *
 * The name is a join away: a Peek price row names its `ticket_id`, and the program document lists tickets
 * with their names. `tickets` is that map. Where an operator publishes no ticket names, which is common
 * because plenty of shops price by duration rather than by person, nothing is filtered and the cheapest
 * stands, because an unnamed price is still better than none.
 */
function peekLowest(prices: PeekPrices | undefined, tickets?: Map<string, string>): number | undefined {
  const rows: { amount: number; label: string | null }[] = [];
  for (const p of prices || []) {
    const label = (p.ticket_id && tickets?.get(p.ticket_id)) || null;
    for (const row of p.pricing || []) {
      const n = Number(row.price?.amount ?? row.list_price?.amount);
      if (Number.isFinite(n) && n > 0) rows.push({ amount: n, label });
    }
  }
  const best = openFarePrice(rows, (r) => r.amount, (r) => r.label);
  return best == null ? undefined : Math.round(best * 100);
}

async function peek(refKey: string, code: string, dates: string[]): Promise<Availability> {
  const b = budget(MAX_CALLS);
  const api = "https://book.peek.com/services/api/";
  const h = peekHeaders(refKey);

  // "peek2": the cached shape gained the ticket names, and an entry written by the old code would be read
  // as an array of activities and lose them silently.
  const ckey = "peek2:" + refKey + ":" + code;
  type PeekCatalog = { activities: { id: string; name: string }[]; tickets: [string, string][] };
  let cat = cacheGet<PeekCatalog>(catalogCache, ckey, CATALOG_TTL_MS);
  if (!cat) {
    const doc = await b.get<PeekDoc>(api + "programs/" + encodeURIComponent(code), h);
    if (!doc?.included) return dead("peek", "program unavailable");
    cat = {
      activities: doc.included
        .filter((x) => x.type === "activity" && typeof x.attributes?.name === "string")
        .map((x) => ({ id: x.id, name: String(x.attributes.name) })),
      // The fare names, so a price row's ticket_id can be resolved and an infant fare never becomes the
      // headline. Shops that price by duration rather than by person publish none of these, which is fine.
      tickets: doc.included
        .filter((x) => x.type === "ticket" && typeof x.attributes?.name === "string")
        .map((x) => [x.id, String(x.attributes.name)] as [string, string]),
    };
    cacheSet(catalogCache, ckey, cat);
  }
  const activities = cat.activities;
  const ticketNames = new Map(cat.tickets);
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
      const priceCents = peekLowest(row.attributes?.prices, ticketNames);
      /**
       * One row per start, not one per way of buying it.
       *
       * Peek answers with a row per bookable variant of a timeslot, and for a rental that is one per
       * duration: Bowen Island E-Bikes' eleven o'clock came back four times, refids ...420, ...1860, ...3300
       * and ...4740, which are seven hours, one day, two days and three days, at $49, $98, $147 and $196.
       * Miami Tours' nine o'clock came back five times the same way. Nothing in what we show distinguishes
       * them, because the label is the activity's name and the book link is the shop's one booking page, so a
       * guest saw the same line four times and three of the prices were not the price of what they picked.
       * They also ate the forty slot ceiling: ten real departures filled it as forty rows.
       *
       * So a start is one row, priced at the cheapest way in, which is what `fromPrice` means everywhere else
       * in the catalog; the guest chooses the duration on Peek's own page. Seats are the largest any variant
       * offers rather than their sum, because they are the same bikes counted once per duration.
       */
      const startsAt = `${slot.date}T${time}`;
      const list = byDate.get(slot.date)!;
      const already = list.find((x) => x.startsAt === startsAt && !x.timeUnknown);
      if (already) {
        if (priceCents != null && (already.priceCents == null || priceCents < already.priceCents)) already.priceCents = priceCents;
        if (spots != null && (already.seatsLeft == null || spots > already.seatsLeft)) already.seatsLeft = spots;
        continue;
      }
      list.push({
        startsAt,
        label: labelOf(time, slot.activity.name),
        ...(priceCents != null ? { priceCents } : {}),
        ...(spots != null ? { seatsLeft: spots } : {}),
        bookUrl,
      });
    }
  }

  // Dates the budget never reached still say "open": one marker row, so a caller can tell an open date whose
  // times we could not read from a date the shop is shut. It is not a departure and carries no time.
  for (const slot of open) {
    const list = byDate.get(slot.date)!;
    if (list.length) continue;
    list.push({ startsAt: slot.date + "T00:00", label: slot.activity.name || "Available", bookUrl, timeUnknown: true });
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

/**
 * A Xola booking link is the seller's own id on 9 of the 54 listings that carry one, and a button embed on the
 * other 45. `xolaSeller` hands the button back as "button:<id>", which is not a seller and was being sent to
 * the experience feed as one, so every one of those 45 shops answered "experience feed unavailable" and showed
 * a guest our guessed nine, eleven and one instead of their own departures. The button names its seller,
 * which is what `readXola` has always done; kept for an hour, so it costs a call once.
 */
async function xolaSellerId(ref: string, b: ReturnType<typeof budget>): Promise<string | null> {
  if (!ref.startsWith("button:")) return ref;
  const ckey = "xola-button:" + ref;
  const known = cacheGet<string>(catalogCache, ckey, CATALOG_TTL_MS);
  if (known) return known;
  const doc = await b.get<{ seller?: { id?: string } }>("https://xola.com/api/buttons/" + encodeURIComponent(ref.slice(7)));
  const id = doc?.seller?.id;
  if (!id || !/^[a-f0-9]{24}$/i.test(id)) return null;
  cacheSet(catalogCache, ckey, id);
  return id;
}

async function xola(ref: string, dates: string[]): Promise<Availability> {
  const b = budget(MAX_CALLS);
  const seller = await xolaSellerId(ref, b);
  if (!seller) return dead("xola", "button names no seller");

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
  try {
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
  } catch {
    // The API host carries no crawl database; the published index below answers there.
    return null;
  }
}

/**
 * The booking links the sync publishes beside the catalog (public/live-index.json), for a host with no crawl
 * database. Fetched once an hour; a miss costs nothing more than the lookup.
 */
const LIVE_INDEX_URL = (process.env.SITE_URL || "https://onoutset.com/").replace(/\/?$/, "/") + "live-index.json";
const LIVE_INDEX_TTL_MS = 60 * 60 * 1000;
let liveIndex: { at: number; urls: Record<string, string> } | null = null;
let liveIndexLoading: Promise<void> | null = null;
/**
 * Drop the cached index. Only the availability corpus under src/eval calls this: each recorded case carries its
 * own one-entry index, and without a reset between cases the first case's index would answer for all of them.
 */
export function resetLiveIndexCache(): void {
  liveIndex = null;
  liveIndexLoading = null;
}

export async function publishedBookingUrl(operatorId: string): Promise<string | null> {
  if (!liveIndex || Date.now() - liveIndex.at > LIVE_INDEX_TTL_MS) {
    if (!liveIndexLoading) {
      liveIndexLoading = (async () => {
        try {
          const res = await fetch(LIVE_INDEX_URL, { signal: AbortSignal.timeout(10000), headers: { accept: "application/json" } });
          if (res.ok) {
            const j = (await res.json()) as { urls?: Record<string, string> };
            liveIndex = { at: Date.now(), urls: j.urls || {} };
          } else if (!liveIndex) liveIndex = { at: Date.now() - LIVE_INDEX_TTL_MS + 60000, urls: {} };
        } catch {
          if (!liveIndex) liveIndex = { at: Date.now() - LIVE_INDEX_TTL_MS + 60000, urls: {} };
        } finally {
          liveIndexLoading = null;
        }
      })();
    }
    await liveIndexLoading;
  }
  return liveIndex?.urls[operatorId] || null;
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

    const bookingUrl = bookingUrlFor(operatorId) || (await publishedBookingUrl(operatorId));
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
