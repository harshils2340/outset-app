import type { Departure, LiveRead } from "../live.ts";
import { isConcessionFare } from "../../lib/fares.ts";

/**
 * Live availability from TripWorks, the way TripWorks' own booking widget gets it.
 *
 * TripWorks is 23 booking links in this catalog — helicopter tours, parasailing, whale watching, hot air
 * balloons, pirate cruises — and it turned out to be the cheapest vendor read so far: two plain `fetch`
 * calls, no key, no token, no browser. It is the same shape `resova.ts` and `peek.ts` found, minus even the
 * key: a Vue widget served from `<slug>.tripworks.com` talking to a Symfony API on its own host, and the API
 * does not ask who is calling.
 *
 * Two calls per shop, whatever the shop's size:
 *
 *   `POST /api/init`
 *       `{"isAuthenticated":false}`. The widget's whole world: `properties.company_name`,
 *       `properties.default_timezone`, `properties.currency`, and `experiences[]` — every activity with its
 *       id, its name, and its own location's IANA timezone. This is the only place the activity names live;
 *       the availability payload knows nothing but ids.
 *
 *   `POST /api/experiences/getInDateRange/<YYYY-MM-DD>/<YYYY-MM-DD>`
 *       `{"isAuthenticated":false,"showTimeslots":true,"showPrices":true}`. Every experience, every day in
 *       the range, every timeslot in the day, with its price, its remaining seats and whether it is on sale
 *       online. One request answers "what can this business sell in the next week", which is the question,
 *       so unlike Resova (one call per room per day) nothing multiplies here.
 *
 * The only header that matters is `x-requested-with: XMLHttpRequest`; the endpoints are the widget's own and
 * every visitor's browser sends exactly these requests with no credentials at all.
 *
 * Measured 20 September 2026 against the catalog's real TripWorks links: a cold read of a shop is about a
 * second and a half for both calls together, and the date-range payload runs to a few hundred kilobytes
 * because it carries every customer type of every slot.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/**
 * `LiveRead["vendor"]` is `"fareharbor" | "resova" | "peek" | "checkfront" | "replay" | "agent" | "none"` and
 * does not yet carry `"tripworks"`. Adding it is a one-word change in `live.ts`, which this file deliberately
 * does not make because several readers are being written at once and `live.ts` has an owner. Until it lands
 * the name is asserted here rather than a neighbouring vendor's being borrowed, so the value a caller sees is
 * already the right one.
 */
const VENDOR = "tripworks" as LiveRead["vendor"];

/**
 * The shop out of any TripWorks URL we hold.
 *
 * Four shapes are in the catalog and all four are the same host:
 *   `https://harborbreeze.tripworks.com/widgets/tripBuilder?defaultView=agenda`
 *   `https://area-bfe.tripworks.com/widget/18852e72-7bfe-48d7-b320-963515a074c2`
 *   `https://whiterock-sea-tours.tripworks.com/`
 *   `https://www.google.com/url?q=https%3A%2F%2Fnemesis-balloon-team.tripworks.com%2Fwidgets%2F…`
 *
 * The last one is a Google redirect our crawl swallowed whole, so the string is unescaped before it is
 * matched. `build.` and `cdn-images.` are TripWorks' own asset hosts and are not shops.
 */
export function tripworksAccount(url: string): string | null {
  let s = url;
  if (/%3a%2f%2f/i.test(s) || /%2f/i.test(s)) {
    try {
      s = decodeURIComponent(s);
    } catch {
      // A half-encoded URL is still worth matching as it stands.
    }
  }
  const m = s.match(/https?:\/\/([a-z0-9][a-z0-9-]{1,60})\.tripworks\.com/i);
  if (!m) return null;
  const slug = m[1].toLowerCase();
  if (slug === "build" || slug === "cdn-images" || slug === "www") return null;
  return slug;
}

/**
 * The one activity a link points at, when it points at one.
 *
 * `?experience=13952` is TripWorks' way of linking straight to a single trip, and a shop that sells nine
 * things has told us which of them this listing is about. `?experience=` is honoured; the opaque
 * `/widget/<uuid>` form names a widget configuration rather than an experience and is not resolvable without
 * the widget itself, so those links read the whole shop.
 */
function experienceOf(url: string): number | null {
  const m = url.match(/[?&]experience=(\d{2,9})\b/);
  return m ? Number(m[1]) : null;
}

/** A JSON body, or nothing. Checked for a JSON opening character, not for `res.ok`: a booking host behind an edge cache serving an HTML error page is not a hypothetical. */
async function api<T>(slug: string, path: string, body: unknown, timeoutMs = 15000): Promise<T | null> {
  try {
    const res = await fetch(`https://${slug}.tripworks.com${path}`, {
      method: "POST",
      headers: {
        "user-agent": UA,
        accept: "application/json",
        "content-type": "application/json",
        "x-requested-with": "XMLHttpRequest",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!/^\s*[[{]/.test(text)) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

type InitDoc = {
  success?: boolean;
  properties?: { company_name?: string; name?: string; default_timezone?: string; currency?: string };
  experiences?: {
    id?: number;
    name?: string;
    internal_name?: string;
    duration?: number | null;
    location?: { timezone?: string | null } | null;
  }[];
};

type Shop = {
  business: string;
  timezone: string | null;
  /** Activity id → what the shop calls it, and the clock its slots are published on. */
  experiences: Map<number, { name: string; timezone: string | null }>;
};

/**
 * The shop's own description of itself, cached for the life of the process.
 *
 * `/api/init` is a hundred kilobytes and never changes inside a session, while availability changes by the
 * minute — so the two are fetched together the first time and only the second one is paid for again. The
 * failure is cached too: a slug that does not resolve (the catalog holds `whiterock-seat-tours`, a typo of a
 * real shop) must not be asked five more times in one answer.
 */
const SHOPS = new Map<string, Shop | null>();

async function shopOf(slug: string): Promise<Shop | null> {
  const cached = SHOPS.get(slug);
  if (cached !== undefined) return cached;
  const init = await api<InitDoc>(slug, "/api/init", { isAuthenticated: false });
  let out: Shop | null = null;
  if (init?.properties) {
    const experiences = new Map<number, { name: string; timezone: string | null }>();
    for (const e of init.experiences || []) {
      if (typeof e.id !== "number") continue;
      experiences.set(e.id, {
        name: e.name || e.internal_name || "Booking",
        timezone: e.location?.timezone || null,
      });
    }
    out = {
      business: init.properties.company_name || init.properties.name || slug,
      timezone: init.properties.default_timezone || null,
      experiences,
    };
  }
  SHOPS.set(slug, out);
  return out;
}

/** Local dates, never UTC: `toISOString()` is five hours ahead of Eastern and rolls "tonight" into tomorrow. */
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * What time it is where the shop is.
 *
 * Every TripWorks time is the shop's own wall clock, and TripWorks says which clock that is, twice: the
 * account's `default_timezone` and, better, the experience's own location timezone — Harbor Breeze runs trips
 * out of two harbours and a national operator could run them in two states. It matters for exactly one
 * decision, whether a slot has already started, and getting it wrong is visible in both directions: a Florida
 * shop read from Ontario would have its 5pm dropped at 5:30 Eastern although it is 4:30 there, and a
 * Californian shop would be offered a slot that sailed two hours ago.
 */
function nowWhereTheyAre(timezone: string | null): { date: string; minutes: number } {
  const d = new Date();
  if (timezone) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hour12: false,
      }).formatToParts(d);
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
      const [y, mo, da, h, mi] = [get("year"), get("month"), get("day"), get("hour"), get("minute")];
      if (y && mo && da && h && mi) return { date: `${y}-${mo}-${da}`, minutes: (Number(h) % 24) * 60 + Number(mi) };
    } catch {
      // An unrecognised zone name is not worth failing a read over; fall through to this machine's clock.
    }
  }
  return { date: ymd(d), minutes: d.getHours() * 60 + d.getMinutes() };
}

/**
 * The 24-hour start time of a slot.
 *
 * `start_time` is `"2026-09-20T09:00:00+00:00"` for a slot the widget labels `"9:00 AM"` in Long Beach, which
 * is to say the offset is a lie of convenience: TripWorks stamps the shop's wall clock with `+00:00` rather
 * than converting it. So the digits are read out of the string and no `Date` is constructed from it — parsing
 * that stamp and formatting it back would move every Californian slot eight hours. `label` is the same moment
 * rendered for a reader and is only parsed when `start_time` is missing.
 */
function slotTime(startTime: string | null, label: string | null): string | null {
  const iso = startTime?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (iso) return `${iso[4]}:${iso[5]}`;
  const m = label?.match(/^(\d{1,2}):(\d{2})\s*([AaPp])/);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toLowerCase() === "p") h += 12;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

type CustomerType = { id?: number; name?: string; price?: number | null; is_visible?: boolean };
type Availability = { customer_type?: CustomerType | null; availability_cnt?: number | null };
type Timeslot = {
  id?: number;
  label?: string;
  time_label?: string;
  start_time?: string;
  is_past?: boolean;
  is_anytime?: boolean;
  is_ecom_visible?: boolean;
  availability_cnt?: number | null;
  capacity_cnt?: number | null;
  min_price?: number | null;
  experience_timeslot_status?: { slug?: string; name?: string } | null;
  availabilities?: Availability[] | null;
};
type DayEntry = { experience_id?: number; date?: string; timeslots?: Timeslot[] | null };
type RangeDoc = { success?: boolean; dates?: Record<string, DayEntry[]> };

/** Activity and ticket names that mean "this is not a seat you can buy at this time". See where they are used. */
const NOT_A_DEPARTURE = /\b(wait\s?list(ed)?|call\s+to\s+book|standby|stand-by|enquir|inquir)\b/i;

/**
 * What one seat at this time really costs.
 *
 * `min_price` on the slot, in cents. It is the slot's own number, not the experience's teaser, and it moves
 * with the day — Harbor Breeze's whale watch is 5800 on a Saturday and 4800 on the Monday after — which is
 * exactly the property that makes it worth reading live.
 *
 * The customer types on the slot are deliberately **not** quoted, and this is the one subtle thing in this
 * file. `customer_type.price` looks like money and is not: Jersey Shore Pirates' "Adult" carries 10000 on a
 * cruise whose real ticket is $32 (their own site says so, and `min_price` says 3200), Gators Parasail's
 * "Parasailer" carries the same 10000 against a `min_price` of 8500, and Harbor Breeze's "Adult" carries 3500
 * against 5800. The number repeats across unrelated shops in round hundredths — 10000, 5000, 3000 — so it is
 * a share of something, not a fare, and quoting it would be the Resova `from.price` mistake with a worse
 * error bar. When the vendor publishes two numbers that disagree, quote the one the checkout would charge and
 * say nothing about the other.
 *
 * That leaves one unnamed ticket per departure, which is honest: the price is real, the label is not known,
 * and a nameless rate is never allowed to be the headline over a named one anywhere else in this codebase.
 * `isConcessionFare` is still applied to the named customer types for the one thing they can be trusted on —
 * whether the only ticket on sale is a child's — because a slot whose every visible type is a concession
 * should not be sold to an adult as the cheapest way in.
 */
function priceOfSlot(slot: Timeslot): { price: number | null; label: string | null; rates: Departure["rates"]; bookable: boolean } {
  const cents = typeof slot.min_price === "number" && slot.min_price > 0 ? slot.min_price : null;
  const price = cents == null ? null : Math.round(cents) / 100;
  const visible = (slot.availabilities || [])
    .filter((a) => a.customer_type?.is_visible === true)
    .map((a) => a.customer_type?.name)
    .filter((n): n is string => !!n);
  const open = visible.filter((n) => !isConcessionFare(n));
  /**
   * Named only when the shop sells exactly one visible kind of ticket, because then the name is not a guess:
   * a helicopter that sells "Shared" and nothing else is a shared seat at this price. Two or more and the
   * headline would have to claim which of them `min_price` belongs to, and it does not say.
   */
  const label = open.length === 1 ? open[0] : null;
  const rates: Departure["rates"] = price == null ? [] : [{ label: label || "Ticket", price, minParty: null, maxParty: null }];
  /** Every ticket on sale at this time is a waitlist or a "call to book": the slot exists, the seat does not. */
  const bookable = !visible.length || !visible.every((n) => NOT_A_DEPARTURE.test(n));
  // Every visible ticket is a concession: real, but not something to head a shortlist with.
  if (price != null && visible.length && !open.length) return { price, label: null, rates, bookable };
  return { price, label, rates, bookable };
}

export async function tripworksLive(
  bookingUrl: string,
  opts: { from?: Date; days?: number; maxItems?: number } = {},
): Promise<LiveRead | null> {
  const slug = tripworksAccount(bookingUrl);
  if (!slug) return null;

  const shop = await shopOf(slug);
  if (!shop) return { business: slug, vendor: VENDOR, departures: [], note: "TripWorks did not answer for this shop." };

  const start = opts.from ?? new Date();
  const horizon = Math.min(opts.days ?? 7, 14);
  const maxItems = opts.maxItems ?? 4;
  const only = experienceOf(bookingUrl);

  /**
   * One call for the whole shop and a window of days, in two windows: the next two days first, and the rest
   * of the horizon only if those came back empty.
   *
   * The range endpoint answers for every activity at once, which is why it is cheaper than Resova's
   * one-call-per-room-per-day — thirteen activities over a week is 91 requests there and two here — but the
   * payload carries every customer type of every slot and it grows with both. Most shops are a few hundred
   * kilobytes for a week. Southern Utah Adventure Center is **10.5MB and nine seconds**, which on its own
   * blows the per-shop deadline in `plan.ts`; its first two days are a fraction of that, and a guest asking
   * "tonight" is answered from them. A week is only paid for when the near days really had nothing.
   */
  const fetchRange = async (fromDay: number, toDay: number): Promise<RangeDoc | null> =>
    api<RangeDoc>(
      slug,
      `/api/experiences/getInDateRange/${ymd(new Date(start.getTime() + fromDay * 86400_000))}/${ymd(new Date(start.getTime() + toDay * 86400_000))}`,
      { isAuthenticated: false, showTimeslots: true, showPrices: true },
      20000,
    );

  const near = Math.min(horizon, 2);
  const first = await fetchRange(0, near);
  if (!first?.dates) {
    return { business: shop.business, vendor: VENDOR, departures: [], note: "TripWorks did not answer for this shop." };
  }

  const out: Departure[] = [];
  /** One activity is done once it has a day with something free: a guest is choosing between shops, not between dates. */
  const settled = new Set<number>();
  const offered: number[] = [];

  /** One window of days, walked in date order: the payload's key order is not a promise and "tonight" must beat "Friday". */
  const collect = (dates: Record<string, DayEntry[]>) => {
    for (const date of Object.keys(dates).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()) {
      for (const entry of dates[date] || []) {
        const id = entry.experience_id;
        if (typeof id !== "number") continue;
        if (only != null && id !== only) continue;
        if (settled.has(id)) continue;
        // The first few activities only, in the order the shop's own menu puts them in; a menu is ordered on purpose.
        if (!offered.includes(id)) {
          if (offered.length >= maxItems) continue;
          offered.push(id);
        }

        const meta = shop.experiences.get(id);
        /**
         * A waitlist is not availability, and neither is "call to book".
         *
         * HeliNY publishes an experience called "Flight Waitlist" whose slots are open, priced at nothing and
         * seat an unlimited number of people, and the Nemesis Balloon Team sells a "30' Marketing Balloon"
         * whose only ticket type is named "Call to Book". Both come back looking exactly like a bookable
         * departure and neither is one: offering "10:00, HeliNY, price unknown" to a guest is worse than
         * saying nothing, because they would click through to a form that books them nothing.
         */
        if (NOT_A_DEPARTURE.test(meta?.name || "")) continue;
        const timezone = meta?.timezone || shop.timezone;
        const today = nowWhereTheyAre(timezone);
        if (date < today.date) continue;

        /**
         * One departure per distinct time, cheapest. A shop can publish the same 11:00 twice — a whale watch
         * off two docks, a rental at two durations — and two identical cards at two prices is not a choice a
         * guest can read.
         */
        const best = new Map<string, Departure>();
        for (const slot of entry.timeslots || []) {
          /**
           * A whitelist of reasons to believe a slot, not a blacklist of reasons to drop one: TripWorks has
           * more ways of saying no than of saying yes, and a new one appearing must not turn into a departure
           * we offer a guest.
           */
          if (slot.experience_timeslot_status?.slug !== "open") continue;
          if (slot.is_ecom_visible === false) continue; // sold in person or by phone only, not online
          if (slot.is_past === true) continue; // their own clock's answer, and it is the shop's clock
          const seats = typeof slot.availability_cnt === "number" ? slot.availability_cnt : null;
          if (seats != null && seats <= 0) continue;

          const time = slotTime(slot.start_time || null, slot.label || slot.time_label || null);
          if (!time) continue;
          /**
           * `is_past` is trusted and checked again here. It is computed on their side against the shop's clock
           * and it is right, but it is a boolean in a payload that may have been cached for a minute, and a
           * slot that started ten minutes ago is not availability. Against the shop's own wall clock, because
           * these times are the shop's own wall clock.
           */
          if (date === today.date && Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) <= today.minutes) continue;

          const { price, label, rates, bookable } = priceOfSlot(slot);
          if (!bookable) continue;
          const departure: Departure = {
            item: meta?.name || `Experience ${id}`,
            date,
            time,
            fromPrice: price,
            priceLabel: label,
            /**
             * Tax is added at their checkout, as with FareHarbor, Resova and Peek. Nothing in this payload
             * claims otherwise — there is no tax-inclusive flag anywhere in it — and under-quoting a guest is
             * the failure that matters, so this stays false until somebody can prove a TripWorks total
             * includes tax.
             */
            taxIncluded: false,
            rates,
            bookUrl: `https://${slug}.tripworks.com/widgets/tripBuilder?showDetail=1&defaultView=experience&experience=${id}`,
            seatsLeft: seats,
        };
        const held = best.get(time);
        if (!held || (departure.fromPrice ?? Infinity) < (held.fromPrice ?? Infinity)) best.set(time, departure);
      }

      if (best.size) {
        // Sorted before it is cut, never after: the payload's slot order is the shop's, not the clock's.
        out.push(...[...best.values()].sort((a, b) => a.time.localeCompare(b.time)).slice(0, 6));
        settled.add(id);
      }
    }
  }
  };

  collect(first.dates);
  if (!out.length && horizon > near) {
    const rest = await fetchRange(near + 1, horizon);
    if (rest?.dates) collect(rest.dates);
  }

  out.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  return {
    business: shop.business,
    vendor: VENDOR,
    departures: out,
    note: out.length ? null : `Nothing bookable online in the next ${horizon} days.`,
  };
}
