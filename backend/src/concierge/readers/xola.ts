import type { Departure, LiveRead } from "../live.ts";
import { isConcessionFare } from "../../lib/fares.ts";

/**
 * Live availability from Xola, the way Xola's own checkout gets it.
 *
 * Xola is 55 booking links in this catalog, the third vendor by popularity after FareHarbor and Peek. It is
 * read here with plain `fetch` and no browser, like FareHarbor, Resova and Peek, and it turned out to be the
 * easiest of the four: their API is wide open.
 *
 * Every Xola booking link we hold is a checkout shell — `x2-checkout.xola.app/flows/mvp?button=<id>`,
 * `checkout.xola.com/index.html#buttons/<id>`, `gift-ui.xola.com/#?button=<id>` — whose only content is a
 * 24-character hex id. The shell preconnects to `https://xola.com`, and that is the API. Three kinds of call,
 * all GET, all JSON, and **none of them takes a key, a token or a cookie**:
 *
 *   `/api/buttons/<buttonId>`          which seller this link belongs to, and which experiences it sells.
 *   `/api/experiences?seller=<id>`     every experience that seller publishes, with its catalog of tickets
 *                                      and their prices. One call for the whole shop.
 *   `/api/sellers/<id>`                the business's own name and its IANA timezone.
 *   `/api/experiences/<id>/availability?start=YYYY-MM-DD&end=YYYY-MM-DD`
 *                                      the calendar: `{ "2026-09-21": { "1400": 44 } }` — date, start time
 *                                      as HHMM, seats left. One call covers the whole horizon.
 *
 * `X-API-VERSION: 2015-07-01` is sent because their own checkout sends it; the calls above answer without it
 * too. What does *not* work is guessing: `/api/experiences?button=<id>` is `403` and `/api/v2/...` is `404`,
 * so the button has to be resolved to a seller first.
 *
 * Measured 20 September 2026 across the real Xola links in this catalog: no browser anywhere, no auth, and a
 * cold read of a shop costs about a second and a half.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const API = "https://xola.com/api";

/**
 * `LiveRead["vendor"]` is `"fareharbor" | "resova" | "peek" | "checkfront" | "replay" | "agent" | "none"` and
 * does not yet have `"xola"` in it. Adding it is a one-word change in `live.ts`, which this file deliberately
 * does not make because another session owns that file; until it lands the name is asserted here rather than
 * a neighbouring vendor's being borrowed, so the value a caller sees is already the right one.
 */
const VENDOR = "xola" as LiveRead["vendor"];

export type XolaRef = {
  /** The button in the link, when it has one. A button names both a seller and the subset of its experiences. */
  button: string | null;
  /** The seller, when the link names one directly (`#seller/<id>`). Otherwise resolved from the button. */
  seller: string | null;
};

/**
 * The button or the seller out of any Xola URL we hold.
 *
 * Six shapes appear in this catalog and they all carry the same 24-hex Mongo id in one of three places:
 * `?button=` (the `x2-checkout.xola.app/flows/...` pages), `#buttons/<id>` (the older `checkout.xola.com`
 * and `checkout.xola.app` shells), and `#seller/<id>` (a shop's whole storefront rather than one button).
 * The query junk our crawl collected — `?cache=…`, `&openExternal=true`, the base64 `xwm=` blob naming the
 * page that embedded it — is ignored. `gift-ui.xola.com` and `gift.xola.app` are gift-certificate shells and
 * carry a button like any other; see `xolaLive` for what happens when that button turns out to sell gifts.
 */
export function xolaRef(url: string): XolaRef | null {
  const seller = url.match(/#seller\/([0-9a-f]{24})/i);
  if (seller) return { button: null, seller: seller[1].toLowerCase() };
  const button = url.match(/(?:[?&#]button=|#buttons\/)([0-9a-f]{24})/i);
  if (button) return { button: button[1].toLowerCase(), seller: null };
  return null;
}

/**
 * A JSON body, or nothing.
 *
 * Xola answers `403` with an HTML error page for a query it will not serve and `404` for a path it does not
 * know, so the status can be trusted — but the body is still checked for a JSON opening character, because
 * those error pages are HTML with a `200`-shaped Content-Type in front of a CDN, and a reader that trusts the
 * status gets markup where it expected a list. That is exactly the Resova bug, one vendor over.
 */
async function api<T>(path: string, timeoutMs = 12000): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, {
      headers: { "user-agent": UA, accept: "application/json", "x-api-version": "2015-07-01" },
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

type XolaPrices = { price?: { min?: number | null } | null };

type CatalogItem = {
  name?: string | null;
  type?: string | null;
  /** `demographic` is a ticket; `merchandise` is an add-on sold beside one. */
  unitType?: string | null;
  visibility?: string | null;
  prices?: XolaPrices | null;
};

type XolaExperience = {
  id?: string;
  name?: string;
  status?: string;
  visible?: boolean;
  /** `person` is a per-head ticket; `outing` is a whole-boat charter. They must not be quoted the same way. */
  priceType?: string;
  price?: number | null;
  catalog?: { items?: CatalogItem[] } | null;
};

type XolaButton = {
  type?: string;
  seller?: { id?: string } | null;
  items?: { type?: string; experience?: { id?: string } | null }[] | null;
};

type XolaSeller = { name?: string; timezoneName?: string | null };

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.replace(/[^\d.]/g, "")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Local dates, never UTC: `toISOString()` is five hours ahead of Eastern and rolls "tonight" into tomorrow. */
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * What time it is where the shop is.
 *
 * Every Xola start time is the shop's own wall clock, and the seller record names that clock
 * (`timezoneName: "America/Toronto"`). It matters for exactly one decision — whether a slot has already
 * started — and getting it wrong is visible in both directions: a Florida shop read from Ontario loses its
 * 5pm at 4:30 local, and a Californian one is offered a slot that sailed two hours ago. `Intl` is used
 * rather than any UTC arithmetic, for the reason above.
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
 * Xola keys a start time as HHMM with no leading zero on the hour: `"700"` is seven in the morning and
 * `"1430"` is half past two. Anything that is not three or four digits is not a time and is dropped rather
 * than guessed at.
 */
function slotTime(key: string): string | null {
  if (!/^\d{3,4}$/.test(key)) return null;
  const p = key.padStart(4, "0");
  const h = Number(p.slice(0, 2));
  const m = Number(p.slice(2));
  if (h > 23 || m > 59) return null;
  return `${p.slice(0, 2)}:${p.slice(2)}`;
}


/**
 * A fare an ordinary adult cannot buy, including the ones spelled as an age rather than a word.
 *
 * `isConcessionFare` knows age *words* — child, youth, senior — and deliberately nothing else. Two vendors in
 * this catalog price by age *number* instead, and the first run of this reader shipped the exact bug the
 * shared rule exists to prevent: Channel Islands Outfitters sells "Adults 18+ $285", "Wise Ones 65+ $275" and
 * "Little Ones 5-17 $255", and the cheapest of those three became the headline on a sea-cave trip for two
 * adults. So two numeric shapes are added on top of the shared rule, both narrow on purpose:
 *
 *   - a hyphenated range that ends at seventeen or below ("5-17", "8-16"), which is a child or youth fare.
 *     Only a hyphen, never the word "to", because "Group from 1 to 2" is a party size and not an age.
 *   - a plus-form of fifty-five or over ("65+"), which is a senior fare. "18+" is an adult fare and must not
 *     be caught, which is the whole reason for the threshold.
 *
 * This belongs in `src/lib/fares.ts` beside the words, so every reader gets it; it is here because that file
 * belongs to another session this hour.
 */
const AGE_RANGE = /\b(\d{1,2})\s*[-\u2013]\s*(\d{1,2})\b/;
const AGE_PLUS = /\b(\d{2})\s*\+/;

function isAgeGatedFare(label: string | null | undefined): boolean {
  if (isConcessionFare(label)) return true;
  if (!label) return false;
  /**
   * And the plural. `CONCESSION` is anchored on word boundaries, so it matches "Senior" and misses
   * "Seniors" — which is how Georgian Spirit Cruises came back headlined "$51.95 · Seniors" against a $54.95
   * adult fare on the first run of this reader. The label is retried with English's plural ending removed,
   * the same trick `inferCategory` uses on a guest's sentence.
   */
  if (isConcessionFare(label.replace(/\b(\w+?)s\b/g, "$1"))) return true;
  const range = AGE_RANGE.exec(label);
  if (range && Number(range[2]) <= 17) return true;
  const plus = AGE_PLUS.exec(label);
  if (plus && Number(plus[1]) >= 55) return true;
  return false;
}

/**
 * The tickets on one experience, and the cheapest one an ordinary adult could buy.
 *
 * `catalog.items` is the ticket sheet. Three filters, each of which we have shipped the bug for once already:
 *
 *   - `unitType: "merchandise"` is an add-on — a towel, a photo package, cancellation insurance — not a way
 *     in. Quoting one as the price of a boat trip is the Peek "Insured Ticket(s), $2.60" bug.
 *   - `visibility` other than `public` is a rate the shop sells through an agent, not on this page.
 *   - concession fares stay out of the headline, because "Infant, $1.00" is the cheapest row on the Georgian
 *     Spirit sheet every single time and nobody arranging an outing can buy it. See `isAgeGatedFare` above
 *     for why the shared word list is not quite enough on its own.
 *
 * `prices.price.min` is the pre-tax figure. Xola also publishes `priceWithTaxes` and `priceWithTaxesAndFees`
 * beside it — $54.95, $62.09 and $63.74 for the same adult ticket — which is a rare case of a vendor saying
 * outright what tax does. We quote the bare price and say it excludes tax, exactly as FareHarbor, Resova and
 * Peek are quoted, so the three surfaces agree on what a number means.
 */
function ticketsOf(exp: XolaExperience): { price: number | null; label: string | null; rates: Departure["rates"] } {
  const rates: Departure["rates"] = [];
  for (const item of exp.catalog?.items || []) {
    if (item.unitType !== "demographic") continue;
    if (item.visibility && item.visibility !== "public") continue;
    const price = num(item.prices?.price?.min);
    if (price == null) continue;
    rates.push({ label: item.name || "Ticket", price, minParty: null, maxParty: null });
  }

  /**
   * A charter is not a head price.
   *
   * `priceType: "outing"` means the number is what the whole boat costs — Queen City Cycle Boat's "Private
   * Cycle Boat Charter" is $599 for the boat, not $599 a person — and the concierge compares head prices and
   * filters on a per-head budget. Quoting it would be the "Escape Rooms, $250" bug that put "$32 to $250 a
   * head" on a Kitchener screen. So the times are still offered, the rates still carry the real figure and
   * its real label, and the headline stays empty rather than wrong.
   */
  if (exp.priceType !== "person") {
    const group = num(exp.price);
    if (group != null && !rates.length) rates.push({ label: `${exp.name || "Charter"} (whole booking)`, price: group, minParty: null, maxParty: null });
    return { price: null, label: null, rates };
  }

  const buyable = rates.filter((r) => !isAgeGatedFare(r.label));
  const pool = buyable.length ? buyable : rates;
  const cheapest = pool.length ? pool.reduce((a, b) => (a.price <= b.price ? a : b)) : null;
  // Only when the catalog said nothing at all; `experience.price` is the tile's from-price.
  return { price: cheapest?.price ?? num(exp.price), label: cheapest?.label ?? null, rates };
}

export async function xolaLive(
  bookingUrl: string,
  opts: { from?: Date; days?: number; maxItems?: number } = {},
): Promise<LiveRead | null> {
  const ref = xolaRef(bookingUrl);
  if (!ref) return null;

  /**
   * A button names a seller *and* a shortlist of that seller's experiences, and the shortlist is the point:
   * Sky Pirate Parasail publishes fourteen experiences and the button on their own site sells four of them.
   *
   * A gift button is the exception. `gift-ui.xola.com` links carry `type: "gift"` and their items are gift
   * certificates with no experience behind them, so a reader that stopped there would report conTRAPtions
   * Escape Rooms and River Queen Voyages — real businesses selling real times right now — as having nothing
   * bookable. The button still names the seller, so the fall-back is the seller's own published catalog.
   * Peek has the same shape and can only say so in a note; here it is recoverable, so it is recovered.
   */
  let sellerId = ref.seller;
  let only: string[] = [];
  if (ref.button) {
    const button = await api<XolaButton>(`/buttons/${ref.button}`);
    if (!button?.seller?.id) {
      return { business: ref.button, vendor: VENDOR, departures: [], note: "Xola did not answer for this shop." };
    }
    sellerId = button.seller.id;
    only = (button.items || []).map((i) => i.experience?.id).filter((id): id is string => !!id);
  }
  if (!sellerId) return null;

  const [seller, list] = await Promise.all([
    api<XolaSeller>(`/sellers/${sellerId}`),
    api<{ data?: XolaExperience[] }>(`/experiences?seller=${sellerId}`),
  ]);
  const name = seller?.name || sellerId;
  const timezone = seller?.timezoneName || null;

  const published = (list?.data || []).filter((e) => e.id && e.status === "published" && e.visible !== false);
  const chosen = only.length ? published.filter((e) => only.includes(e.id!)) : published;
  if (!chosen.length) {
    return { business: name, vendor: VENDOR, departures: [], note: "Xola listed nothing bookable for this shop." };
  }

  const start = opts.from ?? new Date();
  const horizon = Math.min(opts.days ?? 7, 14);
  const maxItems = opts.maxItems ?? 4;
  const today = nowWhereTheyAre(timezone);
  const startDate = ymd(start);
  const endDate = ymd(new Date(start.getTime() + horizon * 86400_000));

  const out: Departure[] = [];
  await Promise.all(
    chosen.slice(0, maxItems).map(async (exp) => {
      /**
       * One call for the whole range, not one per day: Xola's calendar takes a start and an end and answers
       * with only the days it has anything on. Four experiences over a fortnight is four requests here and
       * fifty-six on Resova's shape.
       */
      const cal = await api<Record<string, Record<string, number>>>(
        `/experiences/${exp.id}/availability?start=${startDate}&end=${endDate}`,
      );
      if (!cal || typeof cal !== "object") return;
      const { price, label, rates } = ticketsOf(exp);

      const days = Object.keys(cal)
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today.date)
        .sort();

      for (const date of days) {
        /**
         * One departure per distinct time, and the seats decide what is real. Xola returns every start on
         * the day whether or not it has a seat left — Hamptiki's whole Sunday comes back as thirty starts at
         * zero — so a reader that trusts the key list offers a guest a fully booked cruise.
         */
        const slots: Departure[] = [];
        for (const [key, spots] of Object.entries(cal[date] || {})) {
          if (typeof spots !== "number" || spots <= 0) continue;
          const time = slotTime(key);
          if (!time) continue;
          /**
           * A slot that has already started today is not availability. Xola returns the whole day whatever
           * the hour, so a guest asking at eight in the evening was being offered seven in the morning.
           * Against the shop's own clock, because these times are the shop's own clock.
           */
          if (date === today.date && Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) <= today.minutes) continue;
          slots.push({
            item: exp.name || "Booking",
            date,
            time,
            fromPrice: price,
            priceLabel: label,
            /**
             * Tax is added at their checkout, and Xola says so itself: the same catalog item carries `price`
             * $54.95, `priceWithTaxes` $62.09 and `priceWithTaxesAndFees` $63.74. We quote the first and
             * flag it as pre-tax, the way FareHarbor, Resova and Peek are quoted, because under-quoting a
             * guest is the failure that matters and two surfaces disagreeing about what a number means is
             * how they get under-quoted.
             */
            taxIncluded: false,
            rates,
            bookUrl: ref.button
              ? `https://checkout.xola.com/index.html#buttons/${ref.button}`
              : `https://checkout.xola.com/index.html#seller/${sellerId}`,
            seatsLeft: spots,
          });
        }
        if (slots.length) {
          // Sorted before it is cut: an object's key order is not a clock, and taking six unsorted starts
          // quietly drops the morning of a day that begins at seven.
          out.push(...slots.sort((a, b) => a.time.localeCompare(b.time)).slice(0, 6));
          // The first day with something free is enough; a guest is choosing between shops, not between dates.
          break;
        }
      }
    }),
  );

  out.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  return {
    business: name,
    vendor: VENDOR,
    departures: out,
    note: out.length ? null : `Nothing bookable online in the next ${horizon} days.`,
  };
}
