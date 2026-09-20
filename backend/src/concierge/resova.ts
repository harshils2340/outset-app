import type { Departure, LiveRead } from "./live.ts";
import { isConcessionFare } from "../lib/fares.ts";

/**
 * Live availability from Resova, the way Resova's own booking page gets it.
 *
 * Escapology runs Resova at all 25 of its locations, which is why this is the second feed worth reading after
 * FareHarbor: one integration, a recognisable national brand, real times.
 *
 * Their booking page is an Angular app served from `<account>.resova.us`. The page itself is a 2KB shell that
 * declares two globals in plain sight — `baseUrl` and `aeuToken` — and every request the app then makes goes
 * to `https://<baseUrl>/api/booking/v1/...` with that token in an `X-API-KEY` header. The token is not a
 * secret and not ours: it is printed in the HTML of a public page, identical for every visitor, and it exists
 * so the shop's own booking widget can read the shop's own calendar. We read it the same way and ask the same
 * questions, which is exactly what the FareHarbor reader does a floor down.
 *
 * Two calls per shop, plus one per room per day:
 *
 *   `/misc/init`                                  everything the widget knows: settings, rooms, prices.
 *   `/availability/times/<item>?date=YYYY-MM-DD`  the day's slots, who is in them, what they cost.
 *
 * Only `/misc/init` and `/availability/times` return JSON. Every other path under `/api/booking/v1` falls
 * through to the Angular shell and answers `200` with HTML, so a reader that trusts the status code gets a
 * page of markup where it expected a list. Both are checked for a JSON body, not for `res.ok`.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/** The account out of any Resova URL we hold: `https://escapologywaterloo.resova.us/...` gives that name. */
export function resovaAccount(url: string): string | null {
  const m = url.match(/https?:\/\/([a-z0-9-]+)\.resova\.(?:us|com|co\.uk)/i);
  return m ? m[1].toLowerCase() : null;
}

type Session = { base: string; token: string };

/**
 * The public page, for the two globals it declares. Cached per account for the life of the process: the token
 * is stable, and a demo asking twice about the same shop should not fetch their homepage twice.
 */
const SESSIONS = new Map<string, Session | null>();

async function session(account: string): Promise<Session | null> {
  const cached = SESSIONS.get(account);
  if (cached !== undefined) return cached;
  let out: Session | null = null;
  try {
    const res = await fetch(`https://${account}.resova.us?widget=true`, {
      headers: { "user-agent": UA, accept: "text/html" },
      signal: AbortSignal.timeout(12000),
    });
    if (res.ok) {
      const html = await res.text();
      const token = html.match(/aeuToken\s*=\s*"([^"]+)"/)?.[1] ?? null;
      const base = html.match(/baseUrl\s*=\s*"([^"]+)"/)?.[1] ?? `${account}.resova.us`;
      if (token) out = { base, token };
    }
  } catch {
    out = null;
  }
  SESSIONS.set(account, out);
  return out;
}

/** A JSON body, or nothing. Their SPA answers 200 with HTML for any path it does not recognise. */
async function api<T>(s: Session, path: string): Promise<T | null> {
  try {
    const res = await fetch(`https://${s.base}/api/booking/v1${path}`, {
      headers: { "user-agent": UA, accept: "application/json", "content-type": "application/json", "x-api-key": s.token },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const body = await res.text();
    if (!/^\s*[[{]/.test(body)) return null;
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

type PricingCategory = {
  name?: string;
  single_price?: string | number | null;
  min_quantity?: number | null;
  max_quantity?: number | null;
  hide?: boolean;
};

type ResovaItem = {
  id?: number;
  name?: string;
  status?: number;
  /** A from-price for the tile. Not what a slot costs: see the note in `priceOfSlot`. */
  from?: { price?: string | number | null; type?: string | null } | null;
  single_price?: string | number | null;
};

type ResovaSlot = {
  time?: string;
  end_time?: string;
  available?: boolean;
  resource_blocked?: boolean;
  occupancy?: {
    spaces?: { available?: number | null; min_required?: number | null; max_available?: number | null } | null;
    pricing_categories?: PricingCategory[] | null;
  } | null;
  formatted?: { time_short?: string } | null;
};

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.replace(/[^\d.]/g, "")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Local dates, never UTC: `toISOString()` is five hours ahead of Eastern and rolls "tonight" into tomorrow. */
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * What one seat in this slot really costs.
 *
 * Resova publishes two different numbers and they disagree. The item carries `from.price`, which for
 * Escapology Waterloo's "Who Stole Mona" is $18.00 and is the teaser on the room's tile. The slot carries its
 * own `pricing_categories`, and for the very same room that says $37.00 a player. The slot is the one their
 * checkout charges, so quoting the item's figure would under-quote a guest by half, in the same way that
 * quoting FareHarbor's pre-tax total under-quotes by a sixth.
 *
 * Concession rates are skipped for the headline for the reason they always are: a child fare is real and a
 * guest who said "two of us" cannot buy it.
 */

function priceOfSlot(slot: ResovaSlot, item: ResovaItem): { price: number | null; label: string | null; rates: Departure["rates"] } {
  const cats = (slot.occupancy?.pricing_categories || []).filter((c) => !c.hide && num(c.single_price) != null);
  const rates: Departure["rates"] = cats.map((c) => ({
    label: c.name || "Ticket",
    price: num(c.single_price)!,
    minParty: c.min_quantity ?? null,
    maxParty: c.max_quantity ?? null,
  }));
  const open = rates.filter((r) => !isConcessionFare(r.label));
  const pool = open.length ? open : rates;
  const cheapest = pool.length ? pool.reduce((a, b) => (a.price <= b.price ? a : b)) : null;
  // Only when the slot said nothing at all; the item's from-price is a teaser, not a ticket.
  const fallback = num(item.from?.price) ?? num(item.single_price);
  return { price: cheapest?.price ?? fallback, label: cheapest?.label ?? null, rates };
}

export async function resovaLive(
  bookingUrl: string,
  opts: { from?: Date; days?: number; maxItems?: number } = {},
): Promise<LiveRead | null> {
  const account = resovaAccount(bookingUrl);
  if (!account) return null;
  const s = await session(account);
  if (!s) return { business: account, vendor: "resova", departures: [], note: "Resova did not answer for this shop." };

  const init = await api<{ items?: { data?: ResovaItem[] } }>(s, "/misc/init");
  const items = (init?.items?.data || []).filter((i) => i.id != null && i.status !== 0);
  if (!items.length) return { business: account, vendor: "resova", departures: [], note: "Resova listed nothing bookable for this shop." };

  const start = opts.from ?? new Date();
  const horizon = Math.min(opts.days ?? 7, 14);
  const maxItems = opts.maxItems ?? 4;

  /**
   * Availability is one call per room per day, so the calls multiply fast: thirteen rooms over a fortnight is
   * 182 requests to answer "is there a seat tonight". A guest is choosing between rooms, not between every
   * date a room is open, so only the first few rooms are asked and each stops at the first day with something
   * free. The rooms are asked at the same time as each other, because they do not depend on one another.
   */
  const out: Departure[] = [];
  await Promise.all(
    items.slice(0, maxItems).map(async (item) => {
      for (let i = 0; i <= horizon; i += 1) {
        const date = ymd(new Date(start.getTime() + i * 86400_000));
        const day = await api<{ times?: ResovaSlot[] }>(s, `/availability/times/${item.id}?date=${date}`);
        const slots = (day?.times || []).filter((t) => t.available === true && !t.resource_blocked);
        // A day with nothing free is an ordinary answer, not a failure. Try the next one.
        if (!slots.length) continue;
        const before = out.length;

        for (const slot of slots.slice(0, 6)) {
          // "14:50:00" as the shop publishes it, kept as local wall-clock like every other departure.
          const time = (slot.time || "").slice(0, 5);
          if (!/^\d{2}:\d{2}$/.test(time)) continue;
          /**
           * A slot that has already started today is not availability. Their API happily returns the whole
           * day whatever the hour, so a guest asking at eight in the evening was being offered noon. Only
           * today needs the check, and only against the wall clock, because these times are local.
           */
          if (date === ymd(new Date())) {
            const now = new Date();
            if (Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) <= now.getHours() * 60 + now.getMinutes()) continue;
          }
          const { price, label, rates } = priceOfSlot(slot, item);
          out.push({
            item: item.name || "Booking",
            date,
            time,
            fromPrice: price,
            priceLabel: label,
            /**
             * Tax is added at their checkout, as with FareHarbor. Escapology Waterloo's widget showed
             * "2 x $44.00" with a subtotal of exactly $88.00, which is the bare product of the two, so
             * nothing has been added yet at the point we read it.
             */
            taxIncluded: false,
            rates,
            bookUrl: `https://${s.base}`,
            seatsLeft: typeof slot.occupancy?.spaces?.available === "number" ? slot.occupancy.spaces.available : null,
          });
        }
        // Today can be sold out only because it is late; if nothing survived, look at tomorrow.
        if (out.length > before) break;
      }
    }),
  );

  out.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  return {
    business: account,
    vendor: "resova",
    departures: out,
    note: out.length ? null : "Nothing bookable online in the next " + horizon + " days.",
  };
}
