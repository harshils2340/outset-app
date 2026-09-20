import { db } from "../db/client.ts";
import { fareharborShortname } from "../enrich/widgets.ts";
import { resovaLive } from "./resova.ts";
import { isConcessionFare } from "../lib/fares.ts";

/**
 * What a business can actually sell you, right now, read from the booking system it really runs.
 *
 * The catalog knows who exists and roughly what they charge. This answers the harder question a guest asks:
 * is there a seat at seven tonight, and what will it cost me? Nobody can answer that from a crawl, because the
 * answer changes by the minute and lives inside whatever booking software the shop happens to use.
 *
 * FareHarbor first, because 1,441 of our 11,045 booking links are FareHarbor and it answers in JSON with no key
 * and no browser: the calendar gives every departure this month, and four calls deep is the real price per
 * customer type with fees in it. Everything else falls to the browser agent, which is slower and less certain,
 * so it is only asked when there is no feed to read.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

export type Departure = {
  /** What the shop calls it: "Heli Tour #1", "Romantic Jewel". */
  item: string;
  /** Local date and time as the operator publishes them, e.g. 2026-09-20 and "12:00". */
  date: string;
  time: string;
  /**
   * Cheapest way in, and what that ticket is called. FareHarbor's own answer carries the booking fee but not
   * tax: its pricing payload says `include_taxes: false` outright. Checked against Toronto Heli Tours' real
   * checkout, which shows $114.30 where the API says $99.51, so quoting the API figure as the price would
   * under-quote a guest by a sixth. It is shown as a pre-tax price and said to be one.
   */
  fromPrice: number | null;
  priceLabel: string | null;
  /** False for FareHarbor: their checkout adds tax on top of this. */
  taxIncluded: boolean;
  /** Every ticket type on this departure, so a group of four is priced like a group of four. */
  rates: { label: string; price: number; minParty: number | null; maxParty: number | null }[];
  /** The operator's own page for this exact departure. Where the agent, or the guest, finishes the booking. */
  bookUrl: string;
  seatsLeft: number | null;
};

export type LiveRead = {
  business: string;
  vendor: "fareharbor" | "resova" | "peek" | "checkfront" | "xola" | "rezdy" | "acuity" | "tripworks" | "bookeo" | "square" | "replay" | "agent" | "none";
  departures: Departure[];
  /** Said plainly when there is nothing to sell, because "no availability" is an answer, not a failure. */
  note: string | null;
};

/**
 * A minute's memory, and one flight per URL.
 *
 * Reading a company for the first time is slow — measured on Toronto helicopter tours, the first read took
 * 7.4 seconds and hit the per-shop deadline with nothing to show, while every read after it came back in
 * three. On a cold process that is the difference between a guest seeing two live departures and seeing none,
 * and it made the same query answer differently minute to minute.
 *
 * Sixty seconds, because a booking calendar does not meaningfully change inside a minute and the product's
 * whole claim is that these times are current. The in-flight map matters as much as the cache: three shops
 * are asked in parallel and a busy evening means several guests asking about the same town at once, so
 * identical requests share one answer instead of racing each other.
 */
/**
 * Ten minutes, not one.
 *
 * Measured 20 September 2026: a cold FareHarbor company costs between half a second and sixteen seconds for
 * its month calendars alone (Toronto Heli Tours: 16.5s of a 20.7s read, 80% of the total), and a warm one
 * costs about 250ms. That cost is FareHarbor's, not ours — reversing the order of a sequential and a parallel
 * fetch showed the second one always fast whichever way round it went, so it is their cache we are paying
 * for, and we cannot make it faster. We can decline to pay it again every minute.
 *
 * At sixty seconds the concierge re-paid it constantly, and a cold read blows the 12s deadline in plan.ts, so
 * the same question answered with live times or with none depending on whether anyone had asked about that
 * shop in the last minute. That is the non-determinism: not a race, a cache that expired faster than the
 * thing it was caching cost to rebuild.
 *
 * Ten minutes is what `src/enrich/availability.ts` already uses for the same data on the guest listing page,
 * so the two surfaces now agree on how stale a booking calendar may be. A calendar can change inside ten
 * minutes; the guest then clicks through to the operator's own page and finds the slot gone, which is the
 * same thing that happens if they take nine minutes to decide.
 */
const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; value: unknown }>();
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Whether this company has been read recently enough to answer quickly.
 *
 * The first read of a FareHarbor company takes several seconds and every read after it takes a fraction of
 * one, so a single deadline is wrong in both directions: generous enough for the cold case it wastes a
 * guest's time on the warm one, tight enough for the warm case it drops exactly the read somebody is
 * watching. A demo is by definition the first question after a quiet period, which is why this only ever
 * failed in front of an audience.
 */
export function feedIsWarm(bookingUrl: string): boolean {
  const company = bookingUrl.match(/fareharbor\.com\/(?:embeds\/book\/)?([a-z0-9-]+)/i)?.[1]
    ?? bookingUrl.match(/https?:\/\/([a-z0-9-]+)\.resova\./i)?.[1];
  if (!company) return false;
  const now = Date.now();
  for (const [url, hit] of cache) {
    if (now - hit.at < TTL_MS && url.includes(company)) return true;
  }
  return false;
}

/**
 * Forget everything read so far.
 *
 * The cache is keyed on the URL and lives as long as the process, which is right in production and wrong in a
 * test file: two tests asking the same shop about the same day share a URL, so the second one was answered
 * from the first one's stub and a sold-out day came back with yesterday's departure in it. A new stub is a new
 * world, so the stub helper clears this.
 */
export function clearFeedCache(): void {
  cache.clear();
  inFlight.clear();
}

async function getJson<T>(url: string): Promise<T | null> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T | null;
  const running = inFlight.get(url);
  if (running) return (await running) as T | null;

  const work = (async () => {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  })();
  inFlight.set(url, work);
  try {
    const value = await work;
    cache.set(url, { at: Date.now(), value });
    // A demo laptop left running should not grow a map forever.
    if (cache.size > 400) for (const [k, v] of cache) if (Date.now() - v.at > TTL_MS) cache.delete(k);
    return value;
  } finally {
    inFlight.delete(url);
  }
}

type FhDay = { formatted_date?: string; availabilities?: FhAvail[] };
type FhAvail = {
  pk?: number; start_at?: string; is_bookable?: boolean; is_sold_out?: boolean; is_unlisted?: boolean;
  is_bookable_only_by_phone?: boolean; approximate_available_capacity?: number | null; book_url?: string;
  headline?: string | null; availability_headline?: string | null;
  item?: { pk?: number; name?: string; uri?: string };
};

/**
 * A departure that has already left is not an answer to "tonight". The calendar publishes the whole of today,
 * and the earliest departure of each item is the one we offer, so a guest asking at nine in the evening was
 * being shown this morning's ten o'clock as if they could still take it.
 *
 * `start_at` carries the shop's own UTC offset, which is why the time shown is the operator's local one, and it
 * is also what makes this comparable from a server in another time zone. A time with no offset is left alone:
 * we would not know whose clock it is on.
 */
export function departed(startAt: string | undefined, now: number = Date.now()): boolean {
  if (!startAt || !/(?:Z|[+-]\d{2}:?\d{2})$/.test(startAt.trim())) return false;
  const t = Date.parse(startAt);
  return Number.isFinite(t) && t < now;
}

/**
 * Which item a departure belongs to, however the company's calendar happens to say it.
 *
 * Most of them embed the item inline, with its `pk` and its name. Some send only a reference —
 * `{"cls":"Item","uri":"/api/v1/companies/parasailtoronto/items/154657/"}` — and our reader keyed on
 * `item.pk`, so for those companies every single departure was skipped and the shop came back "price on
 * request" with thirty bookable slots and five real fares sitting behind them. The id is in the URI, and
 * failing that in the booking link, which carries `/items/<pk>/availability/<pk>/book/`.
 */
function itemPkOf(av: FhAvail): number | null {
  if (typeof av.item?.pk === "number") return av.item.pk;
  const fromUri = av.item?.uri?.match(/\/items\/(\d+)/)?.[1];
  const fromBook = av.book_url?.match(/\/items\/(\d+)/)?.[1];
  const n = Number(fromUri ?? fromBook);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Live departures from FareHarbor. Four public calls: the month's calendar, then for each departure we price,
 * its customer types, the sheet that applies online, and that sheet's totals. Pricing is the slow part, so only
 * the first few departures of each distinct item are priced: a guest is choosing between "Heli Tour #1" and
 * "Romantic Jewel", not between forty identical noon slots.
 */
export async function fareharborLive(bookingUrl: string, opts: { from?: Date; days?: number; maxItems?: number } = {}): Promise<LiveRead | null> {
  const sn = fareharborShortname(bookingUrl);
  if (!sn) return null;
  const base = "https://fareharbor.com/api/v1/companies/" + encodeURIComponent(sn) + "/";
  const start = opts.from || new Date();
  const horizon = opts.days ?? 14;
  const maxItems = opts.maxItems ?? 4;

  // The calendar is published a month at a time, so a fortnight's horizon can straddle two of them.
  const months = new Set<string>();
  for (let i = 0; i < Math.max(horizon, 1); i += 1) {
    const d = new Date(start.getTime() + i * 86400_000);
    months.add(`${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/`);
  }

  /**
   * Both months at once. A fortnight's horizon straddles two of them, each is a megabyte or more, and they
   * were fetched one after the other: the read waited out the first company-wide calendar before asking for
   * the second. Nothing in the second depends on the first, so this is the sum of two cold latencies where
   * it only ever needed to be the larger of them.
   *
   * Not the 97% saving a naive before-and-after suggests. Timing a sequential run and then a parallel one
   * measures FareHarbor's cache warming up, not our concurrency: run parallel first instead and the ordering
   * reverses. What this actually buys is one month's cold latency, which on a slow company is several seconds.
   */
  const days: FhDay[] = [];
  // `months` is a Set, so it is spread before mapping; Set has no .map and this threw at runtime, not compile.
  const cals = await Promise.all([...months].map((m) => getJson<{ calendar?: { weeks?: { days?: FhDay[] }[] } }>(base + "calendar/" + m)));
  for (const cal of cals) {
    for (const w of cal?.calendar?.weeks || []) days.push(...(w.days || []));
  }
  if (!days.length) return { business: sn, vendor: "fareharbor", departures: [], note: "FareHarbor did not answer for this shop." };

  /**
   * Local dates, not UTC. FareHarbor publishes a departure's day in the shop's own calendar, and toISOString()
   * is four or five hours ahead of Eastern: after eight in the evening it rolls the date forward, so "tomorrow"
   * quietly became the day after tomorrow and the noon flight a guest was asking about was never offered.
   */
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  /**
   * A day's horizon is that day, not that day and the next one. "escape room tonight" asks for one day, and
   * counting the last day from the first one rather than past it was offering tomorrow evening under a line
   * that says "here is what's actually free", with nothing saying the date had moved.
   */
  const firstDay = ymd(start);
  const lastDay = ymd(new Date(start.getTime() + Math.max(horizon - 1, 0) * 86400_000));

  // One entry per item per day: the earliest bookable departure of each.
  const picked: { av: FhAvail; date: string }[] = [];
  const seen = new Set<string>();
  for (const day of days) {
    const date = day.formatted_date || "";
    if (date < firstDay || date > lastDay) continue;
    for (const av of day.availabilities || []) {
      if (!av.is_bookable || av.is_sold_out || av.is_unlisted || av.is_bookable_only_by_phone) continue;
      if (departed(av.start_at)) continue;
      const key = date + "|" + (itemPkOf(av) ?? av.item?.name ?? "");
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push({ av, date });
    }
  }
  /**
   * Named first. Plenty of shops leave an item called "Booking", which tells a guest nothing, and pricing is
   * four calls a piece, so spending that budget on "Booking" instead of "Heli Tour #1" wastes the only calls
   * we make. Within a name, earliest wins.
   */
  const named = (d: { av: FhAvail }) => {
    const n = d.av.item?.name || d.av.headline;
    return n && !/^booking$/i.test(n) ? 0 : 1;
  };
  picked.sort((a, b) => named(a) - named(b) || (a.av.start_at || "").localeCompare(b.av.start_at || ""));

  // Price only the first few distinct items: four calls each, and a guest is choosing between kinds of tour.
  const pricedItems = new Set<number>();
  const itemNames = new Map<number, string>();
  const out: Departure[] = [];
  let sheetPk: number | null = null;
  let pricedCount = 0;

  /**
   * The pricing budget counts departures, not distinct items.
   *
   * It used to stop after the first departure of each of `maxItems` items, which is right for a shop selling
   * four different tours and wrong for one selling the same charter on thirty days: Parasail Toronto priced
   * its first slot and then offered two more with "price on request" beside them, for the identical boat. The
   * sheet is shared across a company, so every extra departure after the first costs two calls.
   */
  const priceBudget = Math.max(maxItems, 8);

  for (const { av, date } of picked) {
    if (out.length >= 24) break;
    const itemPk = itemPkOf(av);
    // A new item always earns a price; after that, spare budget goes on further dates of the ones we know.
    const wantPrice = itemPk != null && (!pricedItems.has(itemPk) ? pricedItems.size < maxItems : pricedCount < priceBudget);
    let rates: Departure["rates"] = [];

    if (wantPrice && av.pk != null) {
      pricedItems.add(itemPk!);
      pricedCount += 1;
      const detail = await getJson<{ availability?: { item?: { name?: string | null } | null; customer_type_rates?: { pk: number; minimum_party_size: number | null; maximum_party_size: number | null; customer_prototype?: { display_name?: string | null; customer_type?: { singular?: string | null } | null } | null }[] } }>(
        base + `items/${itemPk}/availabilities/${av.pk}/`,
      );
      const ctrs = detail?.availability?.customer_type_rates || [];
      // The calendar gave a reference, not a name; this call already went out, so take the name from it.
      const named = detail?.availability?.item?.name;
      if (named && itemPk != null) itemNames.set(itemPk, named);
      if (sheetPk == null) {
        const sheets = await getJson<{ effective_sheets?: { total_sheet?: { pk?: number } } }>(base + `availabilities/${av.pk}/effective-sheets/`);
        sheetPk = sheets?.effective_sheets?.total_sheet?.pk ?? null;
      }
      if (sheetPk != null) {
        const pricing = await getJson<{ price_previews?: { customer_types?: { customer_type_rate: number; total: number | null }[] } }>(
          base + `total-sheets/${sheetPk}/pricing/availabilities/${av.pk}/`,
        );
        const byRate = new Map<number, number>();
        // A zero total is FareHarbor saying "ask us", not "free". Quoting $0.00 to a guest is worse than quoting nothing.
        for (const c of pricing?.price_previews?.customer_types || []) if (typeof c.total === "number" && c.total > 0) byRate.set(c.customer_type_rate, c.total);
        rates = ctrs
          .map((c) => {
            const cents = byRate.get(c.pk);
            const label = c.customer_prototype?.display_name || c.customer_prototype?.customer_type?.singular || "Ticket";
            return cents == null ? null : { label, price: Math.round(cents) / 100, minParty: c.minimum_party_size, maxParty: c.maximum_party_size };
          })
          .filter(Boolean) as Departure["rates"];
      }
    }

    /**
     * The headline price is the cheapest ticket an adult can actually buy. Quoting "$115.54 Child" to someone
     * who said "for 2" is a lie of omission: they cannot buy that, and the number they see is not the number
     * they would pay. Child, senior and student rates are only the headline when nothing else is sold.
     */
    const open = rates.filter((r) => !isConcessionFare(r.label));
    const pool = open.length ? open : rates;
    const cheapest = pool.length ? pool.reduce((a, b) => (a.price <= b.price ? a : b)) : null;
    out.push({
      item: av.item?.name || (itemPk != null ? itemNames.get(itemPk) : null) || av.headline || av.availability_headline || "Booking",
      date,
      time: (av.start_at || "").slice(11, 16),
      fromPrice: cheapest?.price ?? null,
      priceLabel: cheapest?.label ?? null,
      taxIncluded: false,
      rates,
      bookUrl: av.book_url ? "https://fareharbor.com" + av.book_url : bookingUrl,
      seatsLeft: typeof av.approximate_available_capacity === "number" ? av.approximate_available_capacity : null,
    });
  }

  return {
    business: sn,
    vendor: "fareharbor",
    departures: out,
    note: out.length ? null : "Nothing bookable online in the next " + horizon + " days.",
  };
}

/** The booking link we hold for an operator, by domain. */
export function bookingUrlFor(domain: string): string | null {
  const row = db
    /**
     * The READABLE link wins, not whichever row came first.
     *
     * `LIMIT 1` with no ORDER BY is answered from `idx_facts_op_key` in rowid order, so a shop holding both
     * its own hand-built page and a FareHarbor one we later found is answered from the older, unreadable row
     * and its live calendar is never opened. Thirty-eight operators are in exactly that state today.
     */
    .prepare(
      `SELECT f.fact_value AS u FROM facts f JOIN operators o ON o.id = f.operator_id
        WHERE o.domain = ? AND f.fact_key = 'booking_url'
        ORDER BY (f.fact_value NOT LIKE '%fareharbor%' AND f.fact_value NOT LIKE '%resova%' AND f.fact_value NOT LIKE '%peek.com%') LIMIT 1`,
    )
    .get(domain) as { u: string } | undefined;
  return row?.u || null;
}

/** Live availability for one operator, by whichever route its booking system allows. */
export async function liveFor(domain: string, opts: { from?: Date; days?: number } = {}): Promise<LiveRead> {
  const url = bookingUrlFor(domain);
  if (!url) return { business: domain, vendor: "none", departures: [], note: "We hold no booking link for this business; it would go to the phone agent." };
  const fh = await fareharborLive(url, opts);
  if (fh) return fh;
  const rv = await resovaLive(url, opts);
  if (rv) return rv;
  return { business: domain, vendor: "agent", departures: [], note: "No feed to read: this one needs the browser agent." };
}
