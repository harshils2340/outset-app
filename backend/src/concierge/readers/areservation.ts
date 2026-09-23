import { UNNAMED_RATE, type Departure, type LiveRead } from "../live.ts";
import { addDays, lastDayOf, zonedYmd } from "../shopday.ts";
import { isConcessionFare } from "../../lib/fares.ts";

/**
 * Live availability from aReservation (Indexic), the way its own booking page gets it.
 *
 * aReservation is 34 booking links in this catalog, nearly all of them Florida and Gulf watersports:
 * parasailing in Daytona, Cocoa Beach, Panama City and St Augustine, jet ski rentals, tiki boats, dolphin
 * tours. The link is `link.areservation.com/event/<company>[/<event>]`, a Vite single-page app whose HTML
 * carries nothing, and `src/enrich/vendors.ts` filed it as "no public API documented". There is one; it is
 * simply the app's own, read out of its bundle on 23 September 2026, and it answers a plain `fetch` with no
 * key, no cookie and no browser. Every visitor's browser makes exactly these calls.
 *
 *   `GET https://linkapi.areservation.com/api/Company/<slug>`
 *       `{ companyID, name, homeUrl, lat, lon }`. The slug is the one in the link.
 *   `GET .../api/<companyID>/Events`                       every event on sale, with `eventId`, `name`,
 *                                                          `urlFriendlyName`, `minRate`, `maxRate`.
 *   `GET .../api/<companyID>/Events/Group/<groupId>`       the same for a link carrying `?Groupid=`.
 *   `GET .../api/<companyID>/Events/<urlFriendlyName>`     one event with its `rates[]`: `description`,
 *                                                          `internal`, `flatRate`, `rateEffectives[].rate`.
 *   `GET .../api/<companyID>/Events/<eventId>/Dates?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`
 *                                                          `[{ day, minTime, timeCount }]`, the days with
 *                                                          something on.
 *   `GET .../api/<companyID>/Events/<eventId>/DateTimes/YYYY-MM-DD?clientTicketList=<rateId>!<n>`
 *                                                          the day's times: `startTime` with the shop's own
 *                                                          UTC offset, `sell_Status` (`O` open, `S` sold),
 *                                                          `totalTicketAmount` for the tickets asked about.
 *
 * Dates go in as `yyyy-MM-dd`. `20260926` answers an empty list from `Dates` and a SQL overflow from
 * `DateTimes`, which is how the format was learned.
 *
 * **The price asked for one ticket is the slot's own price.** `DateTimes` is asked with `<rateId>!1`, so
 * `totalTicketAmount` is what one seat at that time costs after any `rateAdjustmentPercent` the shop set on
 * the day, rather than the sheet rate. Checked: two 500ft flights on 26 September 2026 came back as $158.00
 * against a sheet rate of $79.00, and Daytona's own copy says "Observers are $30+tax" and refunds are "less
 * 3rd party booking fee", so the figure is before tax and before the fee. Every departure says so.
 *
 * Rates marked `internal` are not sold online (a comp observer, a private trip booked by phone) and are left
 * out entirely. A `flatRate` rate is the whole boat and is filed as a group rate, so it is never the headline.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const API = "https://linkapi.areservation.com/api";

const VENDOR = "areservation";

export type AreservationRef = {
  /** The company's slug in the link: `daytonaparasail`, `shorelinewatersports.com`. */
  company: string;
  /** One event, when the link names one: `Parasailing-16`. */
  event: string | null;
  /** A group of events, when the link carries `?Groupid=`. */
  group: string | null;
};

/**
 * The shop out of any aReservation URL we hold.
 *
 * Four shapes are in the catalog:
 *   `link.areservation.com/event/daytonaparasail/Parasailing-16`    one event
 *   `link.areservation.com/event/chelanparasail`                    the company's events
 *   `link.areservation.com/eventCalendar/floridacoastalboatrentals` the same, as a calendar
 *   `link.areservation.com/event/ranalli?Groupid=632`               one group of events
 * `/catalog/<company>?justGiftCards=true` is the gift-card store and has no time of day, so it is not a
 * booking link and returns null, the same way `peek.ts` and `bookeo.ts` refuse a voucher page.
 */
export function areservationRef(url: string): AreservationRef | null {
  const m = url.match(/areservation\.com\/(event|eventCalendar)\/([A-Za-z0-9][A-Za-z0-9._-]{1,80})(?:\/([A-Za-z0-9][A-Za-z0-9._-]{0,120}))?\/?(?:\?([^#]*))?/i);
  if (!m) return null;
  const company = m[2];
  const event = m[1].toLowerCase() === "event" && m[3] && !/^\d{4}-\d{2}-\d{2}$/.test(m[3]) ? m[3] : null;
  const group = m[4]?.match(/(?:^|&)groupid=(\d+)/i)?.[1] ?? null;
  return { company, event, group };
}

/** A JSON body, or nothing. Checked for a JSON opening character, not for `res.ok`: an edge error page is HTML with a 200. */
async function api<T>(path: string, timeoutMs = 12000): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, {
      headers: { "user-agent": UA, accept: "application/json", "x-requested-with": "XMLHttpRequest" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const body = await res.text();
    if (!/^\s*[[{]/.test(body)) return null;
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

type Company = { companyID?: number; name?: string | null };
type EventSummary = { eventId?: number; name?: string | null; urlFriendlyName?: string | null; minRate?: number | null; maxRate?: number | null; durationInSeconds?: number | null };
type Rate = {
  rateId?: number;
  description?: string | null;
  internal?: boolean;
  flatRate?: boolean;
  maxTickets?: number | null;
  minReservation?: number | null;
  rateEffectives?: { effectiveFrom?: string; effectiveTo?: string; rate?: number | null }[] | null;
};
type EventDetail = EventSummary & { rates?: Rate[] | null };
type DayEntry = { day?: string; minTime?: string; timeCount?: number };
type DateTime = { eventDateID?: number; startTime?: string; eventDateTime?: string; sell_Status?: string; totalTicketAmount?: number | null };

/**
 * Companies and their events, cached for the life of the process. A company id never changes and a rate
 * sheet changes by the season, while the times change by the minute and are fetched every read. A slug that
 * does not resolve is cached too, so one bad link is not asked about five times in one answer.
 */
const COMPANIES = new Map<string, Company | null>();
const EVENTS = new Map<string, EventDetail | null>();

/** Forget every company and event, so one test's shop is not read as another's. */
export function clearAreservationCache(): void {
  COMPANIES.clear();
  EVENTS.clear();
}

async function companyOf(slug: string): Promise<Company | null> {
  const hit = COMPANIES.get(slug);
  if (hit !== undefined) return hit;
  const c = await api<Company>(`/Company/${encodeURIComponent(slug)}`);
  const out = typeof c?.companyID === "number" ? c : null;
  COMPANIES.set(slug, out);
  return out;
}

async function eventOf(companyId: number, key: string | number): Promise<EventDetail | null> {
  const k = `${companyId}/${key}`;
  const hit = EVENTS.get(k);
  if (hit !== undefined) return hit;
  const e = await api<EventDetail>(`/${companyId}/Events/${encodeURIComponent(String(key))}`);
  const out = typeof e?.eventId === "number" ? e : null;
  EVENTS.set(k, out);
  return out;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

/** The rate in force today, which is the last effective row whose window holds today. */
function rateToday(r: Rate, today: string): number | null {
  const rows = (r.rateEffectives || []).filter((e) => {
    const from = (e.effectiveFrom || "").slice(0, 10);
    const to = (e.effectiveTo || "9999-12-31").slice(0, 10);
    return (!from || from <= today) && today <= to;
  });
  return rows.length ? num(rows[rows.length - 1].rate) : null;
}

/**
 * The rate sheet as a guest can buy it, and which row to ask the day's times about.
 *
 * `internal` rows are not on sale online and are dropped outright. A `flatRate` row is the whole boat and
 * is kept, marked as a group rate, so `plan.ts` never re-picks it as a head price. Concession fares are
 * skipped for the headline for the reason they always are: real, and not something the guest can buy.
 */
export function ratesOf(event: EventDetail, today: string): { rates: Departure["rates"]; ask: { rateId: number; label: string | null } | null } {
  const rates: (Departure["rates"][number] & { rateId: number })[] = [];
  for (const r of event.rates || []) {
    if (r.internal || typeof r.rateId !== "number") continue;
    const price = rateToday(r, today);
    if (price == null) continue;
    rates.push({
      rateId: r.rateId,
      label: (r.description || "").trim() || UNNAMED_RATE,
      price,
      minParty: num(r.minReservation),
      maxParty: num(r.maxTickets),
      ...(r.flatRate ? { group: true } : {}),
    });
  }
  const perHead = rates.filter((r) => !r.group);
  const open = perHead.filter((r) => !isConcessionFare(r.label));
  const pool = open.length ? open : perHead;
  const cheapest = pool.length ? pool.reduce((a, b) => (a.price <= b.price ? a : b)) : null;
  return {
    rates: rates.map(({ rateId: _id, ...rest }) => rest),
    ask: cheapest ? { rateId: cheapest.rateId, label: cheapest.label === UNNAMED_RATE ? null : cheapest.label } : null,
  };
}

/**
 * The local date and clock out of `2026-09-26T10:30:00-04:00`, read as digits. The offset is the shop's own
 * and is real, unlike TripWorks' `+00:00`, so it is also what decides whether the slot has already gone.
 */
function localOf(stamp: string | undefined): { date: string; time: string } | null {
  const m = stamp?.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  return m ? { date: m[1], time: `${m[2]}:${m[3]}` } : null;
}

export async function areservationLive(
  bookingUrl: string,
  opts: { from?: Date; days?: number; maxItems?: number; tz?: string | null } = {},
): Promise<LiveRead | null> {
  const ref = areservationRef(bookingUrl);
  if (!ref) return null;

  const company = await companyOf(ref.company);
  if (!company?.companyID) return { business: ref.company, vendor: VENDOR, departures: [], note: "aReservation did not answer for this shop." };
  const cid = company.companyID;
  const business = company.name || ref.company;

  const start = opts.from ?? new Date();
  const horizon = Math.min(opts.days ?? 7, 14);
  const maxItems = opts.maxItems ?? 4;
  const startDate = zonedYmd(start, opts.tz);
  const lastDate = lastDayOf(startDate, horizon);
  const now = Date.now();

  /** The events to ask about: the one the link names, else the group's or the company's first few. */
  let events: EventDetail[] = [];
  if (ref.event) {
    const e = await eventOf(cid, ref.event);
    if (e) events = [e];
  } else {
    const list = await api<EventSummary[]>(ref.group ? `/${cid}/Events/Group/${ref.group}` : `/${cid}/Events`);
    const keys = (list || []).map((e) => e.urlFriendlyName || e.eventId).filter((k): k is string | number => k != null).slice(0, maxItems);
    events = (await Promise.all(keys.map((k) => eventOf(cid, k)))).filter((e): e is EventDetail => !!e);
  }
  if (!events.length) return { business, vendor: VENDOR, departures: [], note: "aReservation listed nothing bookable for this shop." };

  const out: Departure[] = [];
  await Promise.all(
    events.slice(0, maxItems).map(async (event) => {
      const id = event.eventId!;
      const { rates, ask } = ratesOf(event, startDate);
      /**
       * A ticket has to be named to ask for a day's times, and the price that comes back is that ticket's.
       * With nothing sellable a head at all (a boat sold only whole), the first group rate is asked about so
       * the times still come back, and the headline stays empty.
       */
      const askId = ask?.rateId ?? (event.rates || []).find((r) => !r.internal && typeof r.rateId === "number")?.rateId;
      if (askId == null) return;

      /**
       * Which days have anything on, one call for the window, then the times for the first day or two with
       * something, one call each. A shop with three events over a fortnight is then four or five calls, not
       * forty-two. When `Dates` answers nothing the first two days are asked directly, because an empty
       * list from a shape that is only known from a schema is not proof the shop is shut.
       */
      const listed = await api<DayEntry[]>(`/${cid}/Events/${id}/Dates?startDate=${startDate}&endDate=${lastDate}`);
      let days = (listed || [])
        .filter((d) => (d.timeCount ?? 1) > 0)
        .map((d) => (d.day || "").slice(0, 10))
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= startDate && d <= lastDate)
        .sort();
      if (!days.length) days = [startDate, addDays(startDate, 1)].filter((d) => d <= lastDate);

      for (const date of days.slice(0, 3)) {
        const times = await api<DateTime[]>(`/${cid}/Events/${id}/DateTimes/${date}?clientTicketList=${askId}!1`);
        const before = out.length;
        for (const t of (times || []).slice(0, 12)) {
          // Only a slot the shop itself marks open. `S` is sold out; anything unrecognised is not a seat.
          if (t.sell_Status !== "O") continue;
          const local = localOf(t.startTime || t.eventDateTime);
          if (!local || local.date < startDate || local.date > lastDate) continue;
          // A departure that has already left is not an answer to "this afternoon". The stamp carries the shop's offset.
          const at = Date.parse(t.startTime || t.eventDateTime || "");
          if (Number.isFinite(at) && at <= now) continue;

          const slotPrice = ask ? num(t.totalTicketAmount) : null;
          out.push({
            item: event.name || `Event ${id}`,
            date: local.date,
            time: local.time,
            fromPrice: ask ? (slotPrice ?? rates.find((r) => !r.group && r.label === (ask.label ?? UNNAMED_RATE))?.price ?? null) : null,
            priceLabel: ask?.label ?? null,
            taxIncluded: false,
            rates,
            bookUrl: `https://link.areservation.com/event/${ref.company}/${event.urlFriendlyName || id}/${local.date}`,
            seatsLeft: null,
          });
          if (out.length - before >= 6) break;
        }
        // A day with something open is enough for this event: a guest is choosing between shops, not dates.
        if (out.length > before) break;
      }
    }),
  );

  out.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  return {
    business,
    vendor: VENDOR,
    departures: out,
    note: out.length ? null : `Nothing bookable online in the next ${horizon} days.`,
  };
}
