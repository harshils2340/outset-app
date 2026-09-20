import type { Departure, LiveRead } from "../live.ts";
import { isConcessionFare } from "../../lib/fares.ts";

/**
 * Live availability from Square Appointments, the way Square's own booking page gets it.
 *
 * 55 Square links in this catalog and the fourth vendor by popularity, but the reason it is worth a day is
 * not the 55. A random sample of the 334,482 shops that have a website and no booking link — the long tail
 * this product has never reached — turns up Square, Acuity and Wix as the systems small local businesses
 * actually run. Spas, salons, escape rooms, jet-ski kiosks, fishing guides, bowling lanes. FareHarbor, Peek,
 * Resova and Checkfront are all tour-and-activity vendors and reach none of them.
 *
 * **Shape: a JSON blob in the page, then one unauthenticated JSON POST per service. No browser, no key.**
 *
 * Every Square booking page — `squareup.com/appointments/book/<widget>/<LOC>/…`, `app.squareup.com/…`,
 * `book.squareup.com/appointments/<widget>/location/<LOC>` — redirects to the last of those, and that page
 * carries the whole shop in one meta tag:
 *
 *     <meta name="widget" content="{&quot;id&quot;:&quot;rivga4vgg85qfq&quot;,&quot;business&quot;:{…}}">
 *
 * HTML-escaped JSON, ~40KB of it: the business with its IANA `timezone` and `merchant_token`, every service
 * with every variation (`service_variation_id`, `price_cents`, `service_time`, which staff perform it), the
 * staff with their `employee_token`s, the location, the fees. The catalogue, free, in one GET.
 *
 * Availability is the same call the page's own React store makes, and it takes no key, no cookie and no CSRF
 * token — the bundle only attaches those when it is running inside Square's own buyer app:
 *
 *     POST https://app.squareup.com/appointments/api/buyer/availability
 *     content-type: application/json
 *     {"search_availability_request":{"query":{"filter":{
 *        "start_at_range":{"start_at":"<ISO>","end_at":"<ISO>"},
 *        "location_id":"<LOC>",
 *        "segment_filters":[{"service_variation_id":"<id>","team_member_id_filter":{"any":["<employee_token>"]}}]
 *     }}}}
 *
 * and answers `{"availability":[{"start":1789923600,"end":…,"available":true,"staff_id":…}]}` — epoch
 * seconds, one row per bookable start. `segment_filters` is a list of the *segments of one appointment*, not
 * a list of services to ask about, so it is one request per service variation and not one for the shop.
 *
 * **The team member id is the token, not the id.** A variation's `staff_ids` are internal ids
 * (`dt9534iuf5694l`); the staff list's `employee_token` (`TM1aWH8Kylv6JXP4`) is what the filter wants, and
 * sending the other one comes back `400 Invalid team member` with an empty availability array — which, if
 * you are not reading the errors, looks exactly like a shop with no free slots.
 *
 * **Does it share infrastructure with Acuity?** No. Square owns Square Appointments; *Squarespace* owns
 * Acuity, which it renamed "Squarespace Scheduling", and the names are the only thing the two have in
 * common. Acuity answers a PHP form post with an HTML fragment. See the note in `acuity.ts`.
 *
 * Measured 20 September 2026 across the catalog's real Square links: see the report. A cold read is one page
 * fetch plus one POST per service, about a second and a half.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const AVAILABILITY = "https://app.squareup.com/appointments/api/buyer/availability";

/**
 * `LiveRead["vendor"]` is `"fareharbor" | "resova" | "peek" | "checkfront" | "replay" | "agent" | "none"` and
 * does not yet have `"square"` in it. Adding it is a one-word change in `live.ts`, which this file
 * deliberately does not make because another session owns that file; until it lands the name is asserted here
 * rather than a neighbouring vendor's being borrowed, exactly as `peek.ts` does, so the value a caller sees is
 * already the right one.
 */
const VENDOR = "square" as LiveRead["vendor"];

export type SquareRef =
  /** A booking widget we can ask directly. */
  | { kind: "widget"; widgetId: string; locationId: string }
  /** A Square-hosted page that names a booking widget somewhere in it; one hop to find which. */
  | { kind: "page"; url: string }
  /**
   * A Square link that is not a booking page at all. Kept as a distinct answer rather than a null, because
   * "this shop's link is a gift-card checkout" and "we have never heard of this vendor" call for completely
   * different fixes and must not read the same.
   */
  | { kind: "notBooking"; what: string };

/**
 * What kind of Square link this is.
 *
 * Square puts five different products on four domains and only one of them sells a time:
 *
 *   - `squareup.com/appointments/book/<widget>/<LOC>/…`, `app.squareup.com/appointments/book/…`,
 *     `book.squareup.com/appointments/<widget>/location/<LOC>`, and the rarer
 *     `square.site/appointments/book/profile/<widget>/<LOC>/reservations` — Appointments. Readable.
 *   - `square.site/book/<LOC>/<slug>` — the Appointments *profile* page. It has no widget id in it but does
 *     link to one, so it is one hop from readable.
 *   - `<shop>.square.site/…` — Square Online, the shop's whole website. See `squareLive` for why this is a
 *     clean negative rather than a bug.
 *   - `square.link/u/<code>` and `checkout.square.site/merchant/…` — a payment link and a checkout. They sell
 *     an item or take money; neither has a calendar. 6 of the 55 links in this catalog are one of these.
 */
export function squareRef(url: string): SquareRef | null {
  const u = url.trim();

  // The canonical booking page, and the two older shapes that redirect to it.
  const canonical = u.match(/squareup\.com\/appointments\/([a-z0-9-]{6,})\/location\/([A-Z0-9]{8,})/i);
  if (canonical) return { kind: "widget", widgetId: canonical[1], locationId: canonical[2] };

  /**
   * Case-sensitive on purpose, and it matters. A widget id is lowercase (`7edam4qdlxi81s`) and a location id
   * is uppercase (`L0MK9A5HH4A0N`), which is the only thing telling `…/book/<widget>/<LOC>` apart from
   * `…/book/profile/<widget>/<LOC>`: with `/i` the word "profile" satisfies the widget group and the real
   * widget id satisfies the location group, so the reader asks Square about a location called
   * "7edam4qdlxi81s" and is told, correctly, that no such shop exists.
   */
  const booked = u.match(/square(?:up\.com|\.site)\/appointments\/book\/(?:profile\/)?([a-z0-9-]{6,})\/([A-Z0-9]{8,})/);
  if (booked) return { kind: "widget", widgetId: booked[1], locationId: booked[2] };

  /**
   * The profile page: the location is in the path, the widget id is not. One hop.
   *
   * It appears under three spellings — `square.site/book/<LOC>/<slug>`,
   * `squareup.com/appointments/book/<LOC>/<slug>` and `square.site/appointments/book/<LOC>/<slug>` — and the
   * middle one is the whole reason the rule above is case-sensitive: `book/0B3MPEAG89AR7/sunstate-…` and
   * `book/rivga4vgg85qfq/LN0J87F6T53R6` are the same shape with the two halves swapped, and only their case
   * tells them apart.
   */
  if (/square\.site\/book\/[A-Z0-9]{8,}/.test(u)) return { kind: "page", url: u };
  if (/square(?:up\.com|\.site)\/appointments\/book\/[A-Z0-9]{8,}\//.test(u)) return { kind: "page", url: u };

  /**
   * An Appointments URL we cannot read an id out of — `…/appointments/book/<widget>` with no location,
   * `square.site/book/<slug>` with no location — is still an Appointments URL, so it is fetched rather than
   * refused. Every one of them in this catalog turns out to be a `404`, which is a dead link in our own
   * catalog and worth saying, not a vendor we failed to recognise.
   */
  if (/squareup\.com\/appointments\//i.test(u) || /square\.site\/book\//i.test(u)) return { kind: "page", url: u };

  if (/square\.link\/u\//i.test(u)) return { kind: "notBooking", what: "a Square payment link" };
  if (/checkout\.square\.site/i.test(u)) return { kind: "notBooking", what: "a Square checkout page" };
  if (/\.square\.site/i.test(u)) return { kind: "notBooking", what: "a Square Online storefront" };

  return null;
}

/** Local dates, never UTC: `toISOString()` is five hours ahead of Eastern and rolls "tonight" into tomorrow. */
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/**
 * What time it is where the shop is, and what a given instant is on their wall clock.
 *
 * Square is the first vendor here that answers in epoch seconds rather than in the shop's own local strings,
 * so this does more work than `peek.ts`'s version: every departure's date and time has to be *rendered* into
 * the shop's zone, not merely compared against it. `Intl` does it; no UTC arithmetic is involved, for the
 * reason `AGENTS.md` gives. A Californian spa read from Ontario would otherwise have every slot three hours
 * out and half of them on the wrong day.
 */
function clock(timezone: string | null) {
  let fmt: Intl.DateTimeFormat | null = null;
  try {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || undefined,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
  } catch {
    // An unrecognised zone name is not worth failing a read over; fall through to this machine's clock.
    fmt = null;
  }
  const at = (d: Date): { date: string; time: string } => {
    if (fmt) {
      const parts = fmt.formatToParts(d);
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
      const [y, mo, da, h, mi] = [get("year"), get("month"), get("day"), get("hour"), get("minute")];
      // `hourCycle: h23` still renders midnight as "24" in some ICU builds; normalise it.
      if (y && mo && da && h && mi) return { date: `${y}-${mo}-${da}`, time: `${String(Number(h) % 24).padStart(2, "0")}:${mi}` };
    }
    return { date: ymd(d), time: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` };
  };
  const now = at(new Date());
  return { at, today: now.date, minutes: Number(now.time.slice(0, 2)) * 60 + Number(now.time.slice(3)) };
}

type Variation = {
  id: string;
  name: string | null;
  priceCents: number | null;
  /** Seconds. The price driver for a spa exactly as duration is for a jet ski. */
  serviceTime: number | null;
  staffTokens: string[];
};

type Service = {
  id: string;
  name: string;
  taxable: boolean;
  variations: Variation[];
};

type SquareShop = {
  name: string;
  timezone: string | null;
  currency: string | null;
  locationId: string;
  widgetId: string;
  bookUrl: string;
  services: Service[];
};

/**
 * The shop, out of the `<meta name="widget" content="…">` the booking page declares.
 *
 * The attribute is HTML-escaped JSON, so it is unescaped before it is parsed — and only the five entities
 * Square's own escaper emits are reversed, in the order that leaves an escaped `&amp;quot;` inside a service
 * description alone. A shop called "Bill & Ted's" appears in this catalog and a naive `&amp;`-first unescape
 * turns its description into invalid JSON.
 */
function shopOf(html: string): SquareShop | null {
  const m = html.match(/<meta\s+name="widget"\s+content="([\s\S]*?)"\s*\/?>/);
  if (!m) return null;
  const json = m[1]
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  let w: Record<string, unknown>;
  try {
    w = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }

  const business = (w["business"] as Record<string, unknown> | undefined) ?? {};
  /**
   * `unit_token`, not `business_location_id`. The widget carries both and only the first is the location id
   * the availability API knows: `business_location_id` is `"fk5ahpkmacyiso"`, an internal row id, while
   * `unit_token` is `"LN0J87F6T53R6"` — the same value that appears in the shop's own booking URL. Sending
   * the wrong one earns `400 Location not found` with `"availability": []` beside it, so a run that does not
   * read the error body reports every Square shop in the catalog as having an empty diary. It did.
   */
  const locationId = str(w["unit_token"]) || str(w["business_location_id"]);
  const widgetId = str(w["id"]);
  if (!locationId || !widgetId) return null;

  /** `staff_ids` on a variation are internal ids; the availability filter wants the token. */
  const tokenOf = new Map<string, string>();
  for (const s of (w["staff"] as Record<string, unknown>[] | undefined) ?? []) {
    const id = str(s["id"]);
    const token = str(s["employee_token"]);
    if (id && token) tokenOf.set(id, token);
  }

  const services: Service[] = [];
  for (const s of (w["services"] as Record<string, unknown>[] | undefined) ?? []) {
    const id = str(s["item_token"]) || str(s["id"]);
    const name = str(s["name"]);
    if (!id || !name) continue;
    const variations: Variation[] = [];
    for (const v of (s["variations"] as Record<string, unknown>[] | undefined) ?? []) {
      // A variation the shop has hidden from its own booking flow is not one a guest can pick.
      if (v["is_visible_in_default_booking"] === false) continue;
      const vid = str(v["item_variation_token"]) || str(v["id"]);
      if (!vid) continue;
      /**
       * The same test the service name gets, because either half can be the add-on. Cruise South Texas sells
       * "SHORT TRIP" with variations "1-6 Passengers, $450" and "Add't Person, $75", and the cheapest-wins
       * rule reads the $75 as the price of the trip.
       */
      if (!bookableByAGuest(`${name} ${str(v["name"]) ?? ""}`)) continue;
      const tokens = ((v["staff_ids"] as unknown[] | undefined) ?? [])
        .map((x) => (typeof x === "string" ? tokenOf.get(x) : null))
        .filter((x): x is string => !!x);
      if (!tokens.length) continue;
      const cents = Number(v["price_cents"] ?? s["price_cents"]);
      const secs = Number(v["service_time"]);
      variations.push({
        id: vid,
        name: str(v["name"]),
        /**
         * `price_type` is `"fixed"` or `"variable"`. A variable price is the shop saying "it depends" — a
         * quote given in the chair — and there is no number to publish, so none is.
         */
        priceCents: str(v["price_type"]) === "variable" || !Number.isFinite(cents) || cents <= 0 ? null : cents,
        serviceTime: Number.isFinite(secs) && secs > 0 ? secs : null,
        staffTokens: tokens,
      });
    }
    if (variations.length) services.push({ id, name, taxable: s["is_taxable"] !== false, variations });
  }

  return {
    name: str(business["name"]) || widgetId,
    timezone: str(business["timezone"]),
    currency: str(business["currency_code"]),
    locationId,
    widgetId,
    bookUrl: str(business["booking_site_url"]) || `https://book.squareup.com/appointments/${widgetId}/location/${locationId}`,
    services,
  };
}

/**
 * Not a night out.
 *
 * The same rule the menu reader applies. Square Appointments is used for consultations, patch tests and
 * "come and collect your gift card", all of which are real bookable services and none of which is the answer
 * to "what can I do in Abilene on Saturday". Deliberately narrow: "private charter" and "group booking" are
 * things a guest buys and they stay.
 */
function bookableByAGuest(name: string): boolean {
  if (/\b(gift\s*(card|certificate|voucher)|patch\s*test|consultation call|waitlist|no[- ]show|cancellation fee|account balance)\b/i.test(name)) return false;
  /**
   * An add-on is not an outing. "Add-on to your massage, $10" is sold beside a treatment, never instead of
   * one, and it is both the cheapest thing on the shop's list and bookable at every slot — so cheapest-wins
   * puts it on the screen as the answer to "massage in Newburgh". This is the same bug as Peek quoting
   * "Cancellation Insurance, $2.60" as a boat trip, and it is caught the same way.
   */
  return !/(\badd[- ]?on\b|\badd'?[ln]?t\b|\badditional\s+(person|guest|passenger|angler|rider|player|hour)|\bextra\s+(person|guest|passenger|angler|rider|player)|\bupgrade\b|\benhancement\b)/i.test(name);
}

/**
 * Whether the number beside this service is the price of the outing or a down payment on it.
 *
 * Warrior Wave Charters sells every trip as "Reservation Deposit, $200.00". The $200 is real and the slot is
 * real; the charter is not $200. Quoting it is the pre-tax mistake made much worse, so the time is offered
 * with no price rather than with one that is a fraction of the bill. Dropping the shop instead would be
 * worse: it sells online, today, and `AGENTS.md` is explicit that saying "we would call them" about a shop
 * with a live calendar is a false statement about a real business.
 */
function isDownPayment(name: string): boolean {
  return /\b(deposit|down\s*payment|reservation fee|booking fee|retainer)\b/i.test(name);
}

/** How a variation is named when several of them start at the same minute. */
function lengthLabel(seconds: number | null): string | null {
  if (!seconds) return null;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h} hr ${rem} min` : `${h} hr`;
}

type Slot = { start?: number; available?: boolean };

/** One variation's free starts over a window, as epoch seconds. */
async function availability(
  locationId: string,
  variation: Variation,
  startAt: Date,
  endAt: Date,
  timeoutMs: number,
): Promise<number[]> {
  const body = {
    search_availability_request: {
      query: {
        filter: {
          // An instant, not a date: `toISOString()` is exactly right here and wrong for a calendar day.
          start_at_range: { start_at: startAt.toISOString(), end_at: endAt.toISOString() },
          location_id: locationId,
          segment_filters: [
            { service_variation_id: variation.id, team_member_id_filter: { any: variation.staffTokens } },
          ],
        },
      },
    },
  };
  try {
    const res = await fetch(AVAILABILITY, {
      method: "POST",
      headers: {
        "user-agent": UA,
        accept: "application/json",
        "content-type": "application/json",
        origin: "https://book.squareup.com",
        referer: "https://book.squareup.com/",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    // Square answers `400` with a JSON error and an empty `availability`, which must not read as "no slots".
    if (!res.ok) return [];
    if (!/^\s*[[{]/.test(text)) return [];
    const doc = JSON.parse(text) as { availability?: Slot[] };
    return (doc.availability ?? [])
      .filter((s) => s.available !== false && typeof s.start === "number")
      .map((s) => s.start as number);
  } catch {
    return [];
  }
}

export async function squareLive(
  bookingUrl: string,
  opts: { from?: Date; days?: number; maxItems?: number } = {},
): Promise<LiveRead | null> {
  const ref = squareRef(bookingUrl);
  if (!ref) return null;

  if (ref.kind === "notBooking") {
    /**
     * A clean negative, said out loud. 26 of this catalog's 55 Square links are one of these: a Square Online
     * storefront (`<shop>.square.site`), a payment link, or a checkout. The storefront case is the one worth
     * stating precisely, because it looks readable and is not: Square Online serves the whole site as a
     * JavaScript shell whose HTML names the site and the merchant but never the Appointments widget id, so
     * there is nothing to ask availability *of* without a browser. That is a catalog problem — we hold the
     * shop's website where its booking page belongs — not a reader that fell over, and it must not be
     * reported as a shop with an empty diary.
     */
    return {
      business: bookingUrl,
      vendor: VENDOR,
      departures: [],
      note: `This Square link is ${ref.what}, not a booking page, so it has no times to read.`,
    };
  }

  const get = async (url: string): Promise<string | null> => {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, accept: "text/html" },
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      });
      return res.ok ? await res.text() : null;
    } catch {
      return null;
    }
  };

  let widget = ref.kind === "widget" ? ref : null;
  if (!widget) {
    /**
     * The profile page hop. `square.site/book/<LOC>/<slug>` is the shop's public Appointments profile and its
     * HTML links every service through to `squareup.com/appointments/book/<widget>/<LOC>/start`, so the
     * widget id is one regular expression away — no browser, one extra GET, and only for the 10 links in this
     * catalog that take this shape.
     */
    const html = await get((ref as { url: string }).url);
    const found = html?.match(/squareup\.com\/appointments\/book\/(?:profile\/)?([a-z0-9-]{6,})\/([A-Z0-9]{8,})/);
    if (!found) {
      /**
       * Three of this catalog's profile links now redirect to the shop's Square Online site instead: the
       * shop closed its Appointments profile and kept its store. The page that comes back is a storefront,
       * and saying so is the difference between "the catalog holds the wrong link" and "this reader broke".
       */
      const storefront = !!html && /\.square\.site\b/.test(html);
      return {
        business: bookingUrl,
        vendor: VENDOR,
        departures: [],
        note: html === null
          // Four links in this catalog are 404s: the shop moved or closed its Square profile.
          ? "This Square booking link no longer exists."
          : storefront
            ? "This Square booking profile now redirects to the shop's Square Online store, which has no times to read."
            : "Square did not name a booking widget on this page.",
      };
    }
    widget = { kind: "widget", widgetId: found[1], locationId: found[2] };
  }

  const page = await get(`https://book.squareup.com/appointments/${widget.widgetId}/location/${widget.locationId}`);
  const shop = page ? shopOf(page) : null;
  if (!shop) {
    return { business: bookingUrl, vendor: VENDOR, departures: [], note: "Square did not answer for this shop." };
  }

  const services = shop.services.filter((s) => bookableByAGuest(s.name));
  if (!services.length) {
    return {
      business: shop.name,
      vendor: VENDOR,
      departures: [],
      note: shop.services.length
        ? "This Square link points at nothing a guest can book."
        : "Square listed no services for this shop.",
    };
  }

  const start = opts.from ?? new Date();
  const horizon = Math.min(opts.days ?? 7, 14);
  const maxItems = opts.maxItems ?? 6;
  const { at, today, minutes } = clock(shop.timezone);
  /**
   * From now, not from midnight. Square rejects a `start_at` in the past outright, so asking for "today"
   * after breakfast is an error rather than a short day — and a window that begins at this instant is also
   * exactly the filter a guest wants.
   */
  const windowStart = new Date(Math.max(start.getTime(), Date.now()));
  const windowEnd = new Date(windowStart.getTime() + horizon * 86400_000);

  /**
   * One row per distinct start, cheapest variation on it.
   *
   * Appointment systems return a row per service *and* per length, and Square's escape rooms are the clearest
   * case: the same 19:00 comes back as "2 people / 4 people / 6 people" at $70, $120 and $160, and three
   * identical 19:00 cards at three prices is not a choice anybody can read. The cheapest is kept, and because
   * the *variation* was what the others were selling, the winner says which one it is.
   */
  const best = new Map<string, { departure: Departure; variants: Set<string> }>();

  const asked: { service: Service; variation: Variation }[] = [];
  for (const service of services) {
    // The shop's own order, one variation deep first, so a six-service shop is not spent on one service's
    // six lengths. Variations are then filled in until the cap.
    asked.push({ service, variation: service.variations[0] });
  }
  for (const service of services) {
    for (const variation of service.variations.slice(1)) asked.push({ service, variation });
  }

  await Promise.all(
    asked.slice(0, maxItems).map(async ({ service, variation }) => {
      const starts = await availability(shop.locationId, variation, windowStart, windowEnd, 12000);
      for (const epoch of starts) {
        const { date, time } = at(new Date(epoch * 1000));
        /**
         * A slot that has already started today is not availability. Square's window begins at this instant
         * so this should never fire, but it is the same guard every other reader carries and it costs
         * nothing: a vendor that rounds a window down to the day would otherwise offer a guest nine in the
         * morning at eight in the evening.
         */
        if (date < today || (date === today && Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) <= minutes)) continue;

        const deposit = isDownPayment(`${service.name} ${variation.name ?? ""}`);
        const price = variation.priceCents != null && !deposit ? variation.priceCents / 100 : null;
        const length = lengthLabel(variation.serviceTime);
        /**
         * A variation name a person would read. Shops type whole sentences into these — "4 Hour Rental =
         * $375 + $250 Security Deposit" is one real variation name in this catalog — and a label longer than
         * a phrase is not a label, so the length the shop scheduled is used instead when the name runs long.
         */
        const own = variation.name && variation.name !== service.name ? variation.name.trim() : null;
        const variantName = own && own.length <= 28 ? own : length;
        /**
         * Concessions never lead. Square Appointments carries "Child's Cut" and "Senior Massage" beside the
         * ordinary one at the same hour, and the cheapest-wins rule above would pick the ticket an adult
         * cannot buy. `isConcessionFare` is the same test every other reader uses, applied to the service and
         * its variation together because either half can carry the word.
         */
        const concession = isConcessionFare(`${service.name} ${variation.name ?? ""}`);

        const departure: Departure = {
          item: service.name,
          date,
          time,
          fromPrice: price,
          priceLabel: null,
          /**
           * Square's service prices are pre-tax and the payload says so: every service carries
           * `is_taxable`, the shop's tax rates live in `fees`, and the checkout applies them on top. Under-
           * quoting a guest is the failure that matters, so this stays false — as it does for every other
           * reader here — rather than being flipped for the handful of shops that charge no tax at all.
           */
          taxIncluded: false,
          rates: price != null
            ? [{ label: variantName ? `${service.name} · ${variantName}` : service.name, price, minParty: null, maxParty: null }]
            : [],
          bookUrl: shop.bookUrl,
          // Square's buyer availability says a start is free; it does not say how many places are left.
          seatsLeft: null,
        };

        const key = `${date} ${time}`;
        const held = best.get(key);
        const variants = held?.variants ?? new Set<string>();
        if (variantName) variants.add(variantName);
        const heldConcession = held ? isConcessionFare(held.departure.item) : false;
        const better =
          !held ||
          // A buyable fare always beats a concession, whatever the two cost.
          (heldConcession && !concession) ||
          (heldConcession === concession && (departure.fromPrice ?? Infinity) < (held.departure.fromPrice ?? Infinity));
        if (better) best.set(key, { departure, variants });
        else held!.variants = variants;
      }
    }),
  );

  /**
   * Where there really was a choice at that minute, the winner says which one it is. "$70" for an escape room
   * sold as 2, 4 and 6 players is true and useless. Where the shop only ever sells one thing at a time the
   * label stays empty, because the same words on every card are noise.
   */
  for (const hit of best.values()) {
    if (hit.variants.size > 1) {
      const own = hit.departure.rates[0]?.label.split(" · ").pop() ?? null;
      if (own && own !== hit.departure.item) hit.departure.priceLabel = own;
    }
  }

  const all = [...best.values()]
    .map((h) => h.departure)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

  /**
   * The first day with something free is enough; a guest is choosing between shops, not between dates, and a
   * spa that sells a start every fifteen minutes returns forty rows a day. Six of the earliest, as Peek does,
   * and sorted before it is cut so the morning is not quietly dropped.
   */
  const firstDay = all.length ? all[0].date : null;
  const shown = firstDay ? all.filter((d) => d.date === firstDay).slice(0, 6) : [];

  return {
    business: shop.name,
    vendor: VENDOR,
    departures: shown,
    note: shown.length ? null : `Nothing bookable online in the next ${horizon} days.`,
  };
}
