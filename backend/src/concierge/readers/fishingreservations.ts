import { UNNAMED_RATE, type Departure, type LiveRead } from "../live.ts";
import { lastDayOf, zonedNow, zonedYmd } from "../shopday.ts";

/**
 * Live availability from FishingReservations, the way a guest's browser gets it.
 *
 * FishingReservations (fishingreservations.net and .com) is the reservation system of the California and
 * Oregon sportfishing landings: 22nd Street, Fisherman's Landing, Seaforth, Long Beach, Channel Islands,
 * Emeryville, Morro Bay, Tradewinds in Depoe Bay. Twenty-five booking links in this catalog, and they are
 * the shops where "is there a seat on tomorrow's 3/4 day" is the entire question a guest has.
 *
 * It is the cheapest vendor read so far, because there is no API at all: the schedule page is a server-rendered
 * table, one request for every trip on sale in the next weeks, and nothing behind it fetches anything.
 *
 *   `https://<landing>.fishingreservations.net/sales/`     every trip: boat, trip type, departure date and
 *                                                            time, return, load, price a head, seats left.
 *
 * The path is `/sales/` for most landings, `/resos/` for Fisherman's Landing and `/cruises/` for Morro Bay,
 * and one link filters to a single boat (`/sales?boat_filter[]=230`), so the link is fetched as we hold it
 * rather than rebuilt. The host has no robots.txt (a 404, checked 23 September 2026), nothing is login-walled
 * and the page is what every visitor sees.
 *
 * Three things about the markup that a reader has to know:
 *
 *   - Each trip is a `<td class="scale-data ... trip-cell" data-trip-id="N">` holding six `trip-*` columns.
 *     The date sits in the departure column as `Wed. 9-23-2026 <br>5:00 AM`, so the day headers above the
 *     rows are not needed.
 *   - The seats-left figure is written as HTML character references, `&#52;` for 4 and `&#49;&#55;` for 17,
 *     which is an anti-scraping habit of old PHP templates rather than a secret; a sold-out trip says
 *     `Sold Out` in words. Both are decoded before they are read.
 *   - The price is a head price for an open-party trip and a whole-boat price for a charter row (`Boat
 *     Charter-Chagolla`, `$895`), and nothing in the markup says which. A trip type that names a charter or a
 *     private boat is filed as a group rate, so it is never the headline a guest is quoted.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const VENDOR = "fishingreservations";

export type FishingReservationsRef = {
  /** The landing's subdomain: `longbeach`, `fishermanslanding`. */
  landing: string;
  /** The schedule page as we hold it, with its own path and any boat filter, minus a fragment. */
  page: string;
  /** Where "book" goes for one trip: `.../sales/user.php?trip_id=`. */
  bookBase: string;
};

/**
 * The landing out of any FishingReservations URL we hold.
 *
 * Every shape in the catalog is `https://<landing>.fishingreservations.(net|com)/<sales|resos|cruises|openparty>[/][?filter]`.
 * `www` is the vendor's own site and not a landing.
 */
export function fishingReservationsRef(url: string): FishingReservationsRef | null {
  const m = url.match(/^(https?:\/\/([a-z0-9][a-z0-9-]{0,60})\.fishingreservations\.(?:net|com))(\/[a-z0-9_-]+)?\/?(\?[^#]*)?/i);
  if (!m) return null;
  const landing = m[2].toLowerCase();
  if (landing === "www") return null;
  const origin = m[1].toLowerCase();
  const path = (m[3] || "/sales").toLowerCase();
  const query = m[4] || "";
  return { landing, page: `${origin}${path}/${query}`, bookBase: `${origin}${path}/user.php?trip_id=` };
}

/** `&#52;` and friends, plus the few named entities a price or a boat name can carry. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

/** Tags out, entities decoded, whitespace folded. */
function text(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

export type FrTrip = {
  id: string;
  boat: string;
  /** "3/4 Day", "Full Day Catalina Island Freelance", "Boat Charter-Chagolla". */
  type: string;
  date: string;
  /** 24-hour local wall clock, "05:00". */
  time: string;
  /** Dollars a head, or for a charter row the boat. Null when the column is blank. */
  price: number | null;
  /** Seats left, null when the page does not say a number. */
  spots: number | null;
  soldOut: boolean;
  /** True when the trip type says this is a whole boat rather than a seat. */
  charter: boolean;
};

/** "Wed. 9-23-2026" to "2026-09-23". The page writes the month and day without padding. */
function ymdOf(s: string): string | null {
  const m = s.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/** "5:00 AM" to "05:00". */
function clockOf(s: string): string | null {
  const m = s.match(/(\d{1,2}):(\d{2})\s*([AaPp])\.?[Mm]?/);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toLowerCase() === "p") h += 12;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

const CHARTER = /\b(charter|private)\b/i;

/**
 * Every trip on the schedule page, in the page's own order, which is by date and then by departure.
 *
 * Exported so the fixture test reads the markup the way the reader does, and so a truth case can be written
 * against exactly what a landing's page said.
 */
export function parseTrips(html: string): FrTrip[] {
  const out: FrTrip[] = [];
  const seen = new Set<string>();
  const cell = /<td[^>]*class="[^"]*\btrip-cell\b[^"]*"[^>]*data-trip-id="(\d+)"[^>]*>\s*<div class="row">([\s\S]*?)<\/div>\s*<\/td>/g;
  let m: RegExpExecArray | null;
  while ((m = cell.exec(html))) {
    const id = m[1];
    if (seen.has(id)) continue;
    const row = m[2];
    const col = (name: string): string | null => {
      const c = row.match(new RegExp(`<div[^>]*class="[^"]*\\b${name}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/div>`));
      return c ? c[1] : null;
    };
    const info = col("trip-info");
    const depart = col("trip-depart");
    if (info == null || depart == null) continue;
    const boat = text(info.match(/<strong>([\s\S]*?)<\/strong>/)?.[1] || "");
    const type = text(info.replace(/<strong>[\s\S]*?<\/strong>/, "").replace(/<span[^>]*class='lbl'[^>]*><\/span>/, ""));
    const date = ymdOf(text(depart));
    const time = clockOf(text(depart));
    if (!date || !time) continue;
    const priceText = text(col("trip-price") || "");
    const priceMatch = priceText.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
    const price = priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : null;
    const spotsText = text(col("trip-spots") || "");
    const soldOut = /sold\s*out/i.test(spotsText);
    const spotsMatch = spotsText.match(/^\s*(\d{1,4})\b/);
    seen.add(id);
    out.push({
      id,
      boat,
      type,
      date,
      time,
      price: price != null && price > 0 ? price : null,
      spots: spotsMatch ? Number(spotsMatch[1]) : null,
      soldOut,
      charter: CHARTER.test(type) || CHARTER.test(boat),
    });
  }
  return out;
}

async function getPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*;q=0.8", "accept-language": "en-US,en;q=0.9" },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const body = await res.text();
    // The schedule page and nothing else: a landing whose subdomain has lapsed answers a parked page.
    return /trip-cell/.test(body) ? body : null;
  } catch {
    return null;
  }
}

export async function fishingReservationsLive(
  bookingUrl: string,
  opts: { from?: Date; days?: number; maxItems?: number; tz?: string | null } = {},
): Promise<LiveRead | null> {
  const ref = fishingReservationsRef(bookingUrl);
  if (!ref) return null;

  const html = await getPage(ref.page);
  if (!html) return { business: ref.landing, vendor: VENDOR, departures: [], note: "FishingReservations did not answer for this landing." };

  const start = opts.from ?? new Date();
  const horizon = Math.min(opts.days ?? 7, 14);
  const maxItems = opts.maxItems ?? 4;
  /**
   * The landings are on the Pacific coast and this may run on a UTC host, so the window and the clock are
   * the shop's own, from the catalog through `plan.ts`. Without a zone both fall back to this machine's.
   */
  const startDate = zonedYmd(start, opts.tz);
  const lastDate = lastDayOf(startDate, horizon);
  const today = zonedNow(opts.tz);

  const out: Departure[] = [];
  /** One trip type is one item, whichever boat runs it: a guest is choosing between a half day and a full day. */
  const offered: string[] = [];
  const perItem = new Map<string, number>();

  for (const t of parseTrips(html)) {
    if (t.date < startDate || t.date > lastDate) continue;
    if (t.soldOut || (t.spots != null && t.spots <= 0)) continue;
    // A trip that has already left today is not availability, on the landing's own clock.
    if (t.date === today.date && Number(t.time.slice(0, 2)) * 60 + Number(t.time.slice(3)) <= today.minutes) continue;

    const item = t.type || t.boat || "Trip";
    if (!offered.includes(item)) {
      if (offered.length >= maxItems) continue;
      offered.push(item);
    }
    const n = perItem.get(item) ?? 0;
    if (n >= 6) continue;
    perItem.set(item, n + 1);

    /**
     * The page names no ticket type, so the one rate is unnamed, which keeps it off the card's label and off
     * the headline ahead of anything named. A charter row is the whole boat and is marked as one: the price
     * stays on the rate where a guest can read it and never heads the shortlist as a seat.
     */
    const rates: Departure["rates"] = t.price == null ? [] : [{ label: UNNAMED_RATE, price: t.price, minParty: null, maxParty: null, ...(t.charter ? { group: true } : {}) }];
    out.push({
      item: t.boat && t.type ? `${t.type} (${t.boat})` : item,
      date: t.date,
      time: t.time,
      fromPrice: t.charter ? null : t.price,
      priceLabel: null,
      /**
       * Nothing on the page says whether the figure is what the checkout charges. $150.08 for a Catalina day
       * looks like a fare with a fee folded in, and $82.80 for a 3/4 day looks like a round $80 plus
       * something, but a guess in either direction is the FareHarbor pre-tax bug with the sign unknown. It is
       * quoted as a pre-tax price until somebody compares one against the landing's real checkout.
       */
      taxIncluded: false,
      rates,
      bookUrl: `${ref.bookBase}${t.id}`,
      seatsLeft: t.spots,
    });
  }

  out.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  return {
    business: ref.landing,
    vendor: VENDOR,
    departures: out,
    note: out.length ? null : `Nothing bookable online in the next ${horizon} days.`,
  };
}
