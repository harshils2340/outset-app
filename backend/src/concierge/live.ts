import { db } from "../db/client.ts";
import { fareharborShortname } from "../enrich/widgets.ts";

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
  /** Cheapest way in, and what that ticket is called. Dollars, fees included, as the guest would be charged. */
  fromPrice: number | null;
  priceLabel: string | null;
  /** Every ticket type on this departure, so a group of four is priced like a group of four. */
  rates: { label: string; price: number; minParty: number | null; maxParty: number | null }[];
  /** The operator's own page for this exact departure. Where the agent, or the guest, finishes the booking. */
  bookUrl: string;
  seatsLeft: number | null;
};

export type LiveRead = {
  business: string;
  vendor: "fareharbor" | "agent" | "none";
  departures: Departure[];
  /** Said plainly when there is nothing to sell, because "no availability" is an answer, not a failure. */
  note: string | null;
};

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type FhDay = { formatted_date?: string; availabilities?: FhAvail[] };
type FhAvail = {
  pk?: number; start_at?: string; is_bookable?: boolean; is_sold_out?: boolean; is_unlisted?: boolean;
  is_bookable_only_by_phone?: boolean; approximate_available_capacity?: number | null; book_url?: string;
  item?: { pk?: number; name?: string };
};

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
  for (let i = 0; i <= horizon; i += 1) {
    const d = new Date(start.getTime() + i * 86400_000);
    months.add(`${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/`);
  }

  const days: FhDay[] = [];
  for (const m of months) {
    const cal = await getJson<{ calendar?: { weeks?: { days?: FhDay[] }[] } }>(base + "calendar/" + m);
    for (const w of cal?.calendar?.weeks || []) days.push(...(w.days || []));
  }
  if (!days.length) return { business: sn, vendor: "fareharbor", departures: [], note: "FareHarbor did not answer for this shop." };

  /**
   * Local dates, not UTC. FareHarbor publishes a departure's day in the shop's own calendar, and toISOString()
   * is four or five hours ahead of Eastern: after eight in the evening it rolls the date forward, so "tomorrow"
   * quietly became the day after tomorrow and the noon flight a guest was asking about was never offered.
   */
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const firstDay = ymd(start);
  const lastDay = ymd(new Date(start.getTime() + horizon * 86400_000));

  // One entry per item per day: the earliest bookable departure of each.
  const picked: { av: FhAvail; date: string }[] = [];
  const seen = new Set<string>();
  for (const day of days) {
    const date = day.formatted_date || "";
    if (date < firstDay || date > lastDay) continue;
    for (const av of day.availabilities || []) {
      if (!av.is_bookable || av.is_sold_out || av.is_unlisted || av.is_bookable_only_by_phone) continue;
      const key = date + "|" + (av.item?.pk ?? av.item?.name ?? "");
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
  const named = (d: { av: FhAvail }) => (d.av.item?.name && !/^booking$/i.test(d.av.item.name) ? 0 : 1);
  picked.sort((a, b) => named(a) - named(b) || (a.av.start_at || "").localeCompare(b.av.start_at || ""));

  // Price only the first few distinct items: four calls each, and a guest is choosing between kinds of tour.
  const pricedItems = new Set<number>();
  const out: Departure[] = [];
  let sheetPk: number | null = null;

  for (const { av, date } of picked) {
    if (out.length >= 24) break;
    const itemPk = av.item?.pk;
    const wantPrice = itemPk != null && !pricedItems.has(itemPk) && pricedItems.size < maxItems;
    let rates: Departure["rates"] = [];

    if (wantPrice && av.pk != null) {
      pricedItems.add(itemPk!);
      const detail = await getJson<{ availability?: { customer_type_rates?: { pk: number; minimum_party_size: number | null; maximum_party_size: number | null; customer_prototype?: { display_name?: string | null; customer_type?: { singular?: string | null } | null } | null }[] } }>(
        base + `items/${itemPk}/availabilities/${av.pk}/`,
      );
      const ctrs = detail?.availability?.customer_type_rates || [];
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
    const CONCESSION = /\b(child|kid|infant|youth|junior|senior|student|toddler|baby)\b/i;
    const open = rates.filter((r) => !CONCESSION.test(r.label));
    const pool = open.length ? open : rates;
    const cheapest = pool.length ? pool.reduce((a, b) => (a.price <= b.price ? a : b)) : null;
    out.push({
      item: av.item?.name || "Booking",
      date,
      time: (av.start_at || "").slice(11, 16),
      fromPrice: cheapest?.price ?? null,
      priceLabel: cheapest?.label ?? null,
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
    .prepare("SELECT f.fact_value AS u FROM facts f JOIN operators o ON o.id = f.operator_id WHERE o.domain = ? AND f.fact_key = 'booking_url' LIMIT 1")
    .get(domain) as { u: string } | undefined;
  return row?.u || null;
}

/** Live availability for one operator, by whichever route its booking system allows. */
export async function liveFor(domain: string, opts: { from?: Date; days?: number } = {}): Promise<LiveRead> {
  const url = bookingUrlFor(domain);
  if (!url) return { business: domain, vendor: "none", departures: [], note: "We hold no booking link for this business; it would go to the phone agent." };
  const fh = await fareharborLive(url, opts);
  if (fh) return fh;
  return { business: domain, vendor: "agent", departures: [], note: "No feed to read: this one needs the browser agent." };
}
