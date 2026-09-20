import type { Departure, LiveRead } from "./live.ts";
import { isConcessionFare } from "../lib/fares.ts";

/**
 * Live availability from Peek, the way Peek's own booking page gets it.
 *
 * Peek is 257 booking links in this catalog, the largest single vendor after FareHarbor, and `AGENTS.md` has
 * named it "the next one worth doing" for a while. It is read here with plain `fetch` and no browser, exactly
 * like FareHarbor and Resova, because the shape turned out to be the same one `resova.ts` found: a JS shell
 * that tells you in plain sight how to ask its own API.
 *
 * Their booking page (`book.peek.com/s/<key>/<code>`) is an Ember app called "spinnaker". The HTML carries a
 * `spinnaker/config/environment` meta tag which names the API root as `/services/api`, and the app then sends
 * every request with one header:
 *
 *     authorization: Key <the uuid already sitting in the booking URL's own path>
 *
 * That uuid is not a secret and not ours. It is the shop's public widget key, printed in the link the shop
 * puts on its own website, identical for every visitor, and it exists so the shop's booking widget can read
 * the shop's calendar. We ask the same questions with the same key. Without it every path answers `401`.
 *
 * Three kinds of call, all GET, all JSON:API (`accept: application/vnd.api+json`):
 *
 *   `/services/api/programs/<code>`     the widget's landing payload: every activity on this link, its name,
 *                                       and the per-activity program-configuration id (`p_xxxxx--<activity>`).
 *   `/services/api/programs/<pcId>`     the same call again for one activity, which is the only place the
 *                                       ticket names and their prices appear.
 *   `/services/api/availability-dates`  which days in a range have anything free, and how many start times.
 *   `/services/api/availability-dates/<YYYY-MM-DD>/availability-times?activity_id=<uuid>`
 *                                       the day itself: every start time, its spots, and its price per ticket.
 *
 * Measured 20 September 2026 on eight real shops from the catalog: no browser needed anywhere, and a cold
 * read of a shop costs about one and a half seconds.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const API = "https://book.peek.com/services/api";

/**
 * `LiveRead["vendor"]` is `"fareharbor" | "resova" | "replay" | "agent" | "none"` and does not yet have
 * `"peek"` in it. Adding it is a one-word change in `live.ts`, which this file deliberately does not make
 * because another session is working in there; until it lands, the name is asserted here rather than a
 * neighbouring vendor's being borrowed, so the value a caller sees is already the right one.
 */
const VENDOR = "peek" as LiveRead["vendor"];

export type PeekRef = {
  /** The shop's public widget key, and the value of the `authorization: Key` header. */
  key: string;
  /** The program the link points at: a short code (`K1D9M`), or `p_xxxxx--<activity uuid>` for a single one. */
  code: string;
};

/**
 * The shop and the program out of any Peek URL we hold.
 *
 * Both hosts appear in the catalog (`book.peek.com` and `www.peek.com`) and both path shapes do (`/s/` for the
 * booking flow, `/w/` for the widget). A trailing segment (`/w/<key>/<code>/t`) and the query junk our crawl
 * collected (`?gaClientId=…`, `?mode=standalone`) are ignored. `book.peek.com/waivers/<uuid>` is a waiver
 * form, not a booking page, and carries no program, so it returns null rather than a key that reads nothing.
 */
export function peekRef(url: string): PeekRef | null {
  const m = url.match(/peek\.com\/(?:s|w)\/([0-9a-f]{8}-[0-9a-f-]{20,})\/([A-Za-z0-9_-]+)/i);
  if (!m) return null;
  return { key: m[1].toLowerCase(), code: m[2] };
}

/**
 * A JSON:API body, or nothing.
 *
 * Peek answers `401` with a JSON error for a missing key and `404` for a path it does not know, so unlike
 * Resova the status code can be trusted here — but the body is still checked for a JSON opening character,
 * because an edge cache in front of a booking system serving an HTML error page is not a hypothetical.
 */
async function api<T>(ref: PeekRef, path: string, timeoutMs = 12000): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, {
      headers: {
        "user-agent": UA,
        accept: "application/vnd.api+json",
        authorization: `Key ${ref.key}`,
      },
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

type Resource = {
  type?: string;
  id?: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: { type?: string; id?: string } | { type?: string; id?: string }[] | null }>;
};

type Doc = { data?: Resource | Resource[]; included?: Resource[] };

const rel = (r: Resource | undefined, name: string): string | null => {
  const d = r?.relationships?.[name]?.data;
  return d && !Array.isArray(d) && typeof d.id === "string" ? d.id : null;
};

const relMany = (r: Resource | undefined, name: string): string[] => {
  const d = r?.relationships?.[name]?.data;
  return Array.isArray(d) ? d.map((x) => x?.id).filter((x): x is string => typeof x === "string") : [];
};

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.replace(/[^\d.]/g, "")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Local dates, never UTC: `toISOString()` is five hours ahead of Eastern and rolls "tonight" into tomorrow. */
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * What time it is where the shop is.
 *
 * Every Peek time is the shop's own wall clock, and Peek tells us which clock that is: the `partner` resource
 * carries an IANA `timezone`. It matters for exactly one decision — whether a slot has already started — and
 * getting it wrong is visible in both directions: a Florida shop read from Ontario would have its 5pm dropped
 * at 5:30 Eastern although it is 4:30 there, and a Californian shop would be offered a slot that sailed two
 * hours ago. `Intl` is used rather than any UTC arithmetic, for the reason above.
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
      if (y && mo && da && h && mi) {
        return { date: `${y}-${mo}-${da}`, minutes: (Number(h) % 24) * 60 + Number(mi) };
      }
    } catch {
      // An unrecognised zone name is not worth failing a read over; fall through to this machine's clock.
    }
  }
  return { date: ymd(d), minutes: d.getHours() * 60 + d.getMinutes() };
}

/**
 * The 24-hour start time of a slot.
 *
 * Preferred from the slot's own id, which is `20260921100000_90_<duration uuid>` — the timestamp the shop's
 * scheduler actually keyed the slot on, so no locale parsing is involved. `"10:00AM"` in `time` is the same
 * moment rendered for a reader and is only parsed when the id is not in that shape.
 */
function slotTime(id: string | null, display: string | null): string | null {
  const fromId = id?.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (fromId) return `${fromId[4]}:${fromId[5]}`;
  const m = display?.match(/^(\d{1,2}):(\d{2})\s*([AaPp])/);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toLowerCase() === "p") h += 12;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

type PeekActivity = {
  id: string;
  /** The per-activity program-configuration, `p_xxxxx--<activity uuid>`. Availability is scoped to it. */
  pcId: string | null;
  name: string;
};

/** The tickets on one activity, by the id the availability payload calls `resource_option_id`. */
type TicketMap = Map<string, { name: string | null; price: number | null }>;

/**
 * Every bookable activity on this booking link.
 *
 * A Peek link is a *program*, which is usually a menu: "Glass Bottom Dolphin Cruise / Sunset Dolphin Cruise /
 * Private Charter / Gift an Experience". Each entry is a `program-configuration-activity` pointing at an
 * `activity` and at the per-activity configuration whose id availability is asked under. A link that points
 * at a single activity (`/s/<key>/p_kwv5p--<uuid>`) lists no entries at all and *is* that activity, so the
 * program's own configuration id is used instead.
 *
 * `mode` is the filter that matters. `activity` and `rental` are things a guest turns up for; `legacy_addon`
 * is insurance sold beside a ticket and a gift card is not a time of day. Quoting either as a departure would
 * put "Cancellation Insurance, $2.60" on the screen as an outing.
 */
function activitiesOf(doc: Doc): { activities: PeekActivity[]; timezone: string | null; business: string | null; giftCardOnly: boolean } {
  const included = doc.included || [];
  const byId = new Map(included.filter((r) => r.id).map((r) => [`${r.type}:${r.id}`, r]));
  const partner = included.find((r) => r.type === "partner");
  const timezone = str(partner?.attributes?.["timezone"]);
  const business = str(partner?.attributes?.["name"]);

  const named = (id: string): PeekActivity | null => {
    const act = byId.get(`activity:${id}`);
    const mode = str(act?.attributes?.["mode"]);
    if (!act || (mode !== "activity" && mode !== "rental")) return null;
    return { id, pcId: null, name: str(act.attributes?.["name"]) || "Booking" };
  };

  const out: PeekActivity[] = [];
  for (const pca of included.filter((r) => r.type === "program-configuration-activity")) {
    const actId = rel(pca, "activity");
    const pcId = rel(pca, "program-configuration");
    if (!actId) continue;
    const a = named(actId);
    if (a) out.push({ ...a, pcId });
  }

  /**
   * A link that sells one thing lists no entries. Its program configuration points straight at the activity,
   * two ways: the id itself is `p_xxxxx--<activity uuid>` on some shops and a bare `p_xxxxx` with an
   * `activity` relationship on others. Both appear in this catalog — Skydive Saratoga is the first,
   * Cruisin' Tikis Nashville and Half Moon Bay Kayak the second — and reading only the first shape was
   * enough to report four real shops as having nothing bookable.
   */
  const data = Array.isArray(doc.data) ? doc.data[0] : doc.data;
  const pcId = rel(data, "program-configuration");
  const pc = pcId ? byId.get(`program-configuration:${pcId}`) : undefined;
  if (!out.length) {
    const actId = (pcId?.includes("--") ? pcId.split("--")[1] : null) ?? rel(pc, "activity");
    const a = actId ? named(actId) : null;
    if (a) out.push({ ...a, pcId });
  }

  /**
   * Some of these links do not sell a time at all. `layout-name: "cash_gift_card"` is a gift-certificate
   * page — 41° North Coastal Adventures and Blind Pass Boat Rental both have one as their `booking_url` —
   * and it carries no activity and never will. That is worth saying out loud rather than reporting as a shop
   * with no availability, because the two call for completely different fixes: one is Peek's calendar being
   * empty, the other is our catalog holding the wrong link for a business that does sell online.
   */
  const giftCardOnly = !out.length && /gift_card/.test(str(pc?.attributes?.["layout-name"]) || "");

  // Keep the order the shop put them in; a menu is ordered on purpose.
  return { activities: out, timezone, business, giftCardOnly };
}

/**
 * The ticket names and prices for one activity.
 *
 * They are not in the landing payload — only the per-activity program carries the `ticket` resources — and
 * they are the whole reason this second call is made: a price with no name cannot be tested for being a
 * child fare, and `isConcessionFare` is the difference between quoting a dolphin cruise at $26 and quoting
 * it at $15 for a ticket an adult cannot buy.
 */
async function ticketsOf(ref: PeekRef, activity: PeekActivity): Promise<TicketMap> {
  const map: TicketMap = new Map();
  if (!activity.pcId) return map;
  const doc = await api<Doc>(ref, `/programs/${encodeURIComponent(activity.pcId)}`);
  if (!doc) return map;
  const included = doc.included || [];
  const act = included.find((r) => r.type === "activity" && r.id === activity.id);
  const own = new Set(relMany(act, "tickets"));
  for (const t of included) {
    if (t.type !== "ticket" || !t.id) continue;
    // Only this activity's own tickets. A program payload also carries the add-on activity's, and
    // "Insured Ticket(s), $2.60" quoted as the price of a boat trip is the same bug as an infant fare.
    if (own.size && !own.has(t.id)) continue;
    map.set(t.id, { name: str(t.attributes?.["name"]), price: num(t.attributes?.["source-price-gross"]) });
  }
  return map;
}

type PeekPrice = { resource_option_id?: string; pricing?: { price?: { amount?: string } | null }[] | null };

/**
 * What one seat at this time really costs.
 *
 * The slot's `prices` is one row per resource option, each with its own `pricing` ladder, and the slot also
 * carries a single `price` field — which is the *sum of every ticket type*, $67.00 where the ticket is $26.
 * Quoting that would be the Resova `from.price` mistake with the sign reversed, so it is not read at all.
 *
 * Rows priced at zero are add-ons and waiver lines, not tickets. Concession rows are excluded from the
 * headline for the reason they always are, and a row Peek gave no ticket record for keeps a null label: it is
 * still a real price, but when the activity does publish named tickets those are preferred for the headline,
 * because an unnamed row cannot be proved not to be a child fare.
 */
function priceOfSlot(prices: PeekPrice[], tickets: TicketMap, minParty: number | null): { price: number | null; label: string | null; rates: Departure["rates"] } {
  const rates: Departure["rates"] = [];
  for (const p of prices) {
    const amount = num(p.pricing?.find((x) => num(x?.price?.amount) != null)?.price?.amount);
    const ticket = p.resource_option_id ? tickets.get(p.resource_option_id) : undefined;
    const price = amount ?? ticket?.price ?? null;
    if (price == null) continue;
    rates.push({ label: ticket?.name || "Ticket", price, minParty, maxParty: null });
  }
  const buyable = rates.filter((r) => !isConcessionFare(r.label));
  const pool = buyable.length ? buyable : rates;
  const named = pool.filter((r) => r.label !== "Ticket");
  const headline = (named.length ? named : pool).reduce<Departure["rates"][number] | null>(
    (a, b) => (a && a.price <= b.price ? a : b),
    null,
  );
  return { price: headline?.price ?? null, label: headline?.label ?? null, rates };
}

type AvailDate = { id?: string; attributes?: { date?: string; "availability-status"?: string; "num-start-times"?: number } };
type AvailTime = {
  id?: string;
  attributes?: {
    time?: string;
    date?: string;
    spots?: number | null;
    "availability-mode"?: string;
    "is-freesale"?: boolean;
    "minimum-tickets-required"?: number | null;
    duration?: { name?: string | null; amount?: number | null; unit?: string | null } | null;
    prices?: PeekPrice[] | null;
  };
};

export async function peekLive(
  bookingUrl: string,
  opts: { from?: Date; days?: number; maxItems?: number } = {},
): Promise<LiveRead | null> {
  const ref = peekRef(bookingUrl);
  if (!ref) return null;

  const program = await api<Doc>(ref, `/programs/${encodeURIComponent(ref.code)}`);
  if (!program) return { business: ref.code, vendor: VENDOR, departures: [], note: "Peek did not answer for this shop." };

  const { activities, timezone, business, giftCardOnly } = activitiesOf(program);
  const name = business || ref.code;
  if (!activities.length) {
    return {
      business: name,
      vendor: VENDOR,
      departures: [],
      note: giftCardOnly
        ? "This Peek link is a gift-certificate page, not a booking page, so it has no times to read."
        : "Peek listed nothing bookable for this shop.",
    };
  }

  const start = opts.from ?? new Date();
  const horizon = Math.min(opts.days ?? 7, 14);
  const maxItems = opts.maxItems ?? 4;
  const today = nowWhereTheyAre(timezone);
  const startDate = ymd(start);
  const endDate = ymd(new Date(start.getTime() + horizon * 86400_000));

  const out: Departure[] = [];
  await Promise.all(
    activities.slice(0, maxItems).map(async (activity) => {
      /**
       * One call for the whole range, not one per day. Peek's calendar endpoint takes a start and an end and
       * answers with only the days that have something, which is the one thing Resova's does not do: thirteen
       * rooms over a fortnight is 182 requests there and one here.
       */
      const pc = activity.pcId ? `&pc-id=${encodeURIComponent(activity.pcId)}` : "";
      const [cal, tickets] = await Promise.all([
        api<{ data?: AvailDate[] }>(
          ref,
          `/availability-dates?activity-id=${activity.id}&start-date=${startDate}&end-date=${endDate}${pc}&use-legacy-api=true`,
        ),
        ticketsOf(ref, activity),
      ]);
      /**
       * `num-start-times` is deliberately not used as a filter. It counts the starts bookable for *one*
       * ticket, and Cruisin' Tikis Nashville reports 0 for a day whose fifteen slots are all sellable to a
       * party of two. A guest asking this agent has a party size; the calendar's single-seat arithmetic is
       * not ours to inherit. Only the day's own status is trusted, and the times themselves settle it.
       */
      const days = (cal?.data || [])
        .map((d) => ({ date: str(d.attributes?.date) || str(d.id), status: d.attributes?.["availability-status"] }))
        .filter((d): d is { date: string; status: string | undefined } => !!d.date && /^\d{4}-\d{2}-\d{2}$/.test(d.date))
        /**
         * `call_to_book` is not availability. It is Peek's way of saying the online calendar is closed for
         * that day and the shop wants the phone — AA Seward Air Tours is sold out for a week and then
         * `call_to_book` for the rest of the season — and every slot under it comes back `sold_out`. Asking
         * for those days is five wasted requests per activity and cannot produce a departure.
         */
        .filter((d) => d.status !== "unavailable" && d.status !== "sold_out" && d.status !== "call_to_book" && d.date >= today.date)
        .sort((a, b) => a.date.localeCompare(b.date));

      // At most five days asked for per activity: the first one with something free ends it, and a shop
      // whose next free day is a week out is not the answer to "tonight" anyway.
      for (const day of days.slice(0, 5)) {
        const doc = await api<{ data?: AvailTime[] }>(
          ref,
          `/availability-dates/${day.date}/availability-times?activity_id=${activity.id}`,
        );
        /**
         * One departure per distinct time. Peek returns one row per bookable *variant*, so a single 11:00 can
         * come back four times — a one-, two-, three- and four-hour rental at $49/$98/$147/$196 — and four
         * identical cards at four prices is not a choice a guest can read. The cheapest variant of each time
         * is kept, which is also the one the widget shows as the "from" price.
         */
        const best = new Map<string, { departure: Departure; duration: string | null; variants: Set<string> }>();
        for (const slot of doc?.data || []) {
          const a = slot.attributes || {};
          /**
           * A whitelist, not a blacklist, because Peek has more ways of saying no than of saying yes and a
           * new one appearing must not turn into a departure we offer. `min_required_not_bookable` is a yes:
           * it means the trip has a minimum party (Cruisin' Tikis will not sail for one person) and the
           * widget greys it out only because its ticket box starts at one. The minimum rides along on every
           * rate below, so a party of two is offered it and a solo guest can be kept away from it.
           */
          const mode = str(a["availability-mode"]);
          if (mode !== "available" && mode !== "min_required_not_bookable") continue;
          // `spots` is null on a freesale slot (no capacity limit), which is available, not sold out.
          const spots = typeof a.spots === "number" ? a.spots : null;
          if (spots != null && spots <= 0 && !a["is-freesale"]) continue;

          const time = slotTime(str(slot.id), str(a.time));
          if (!time) continue;
          const date = str(a.date) || day.date;
          /**
           * A slot that has already started today is not availability. Peek returns the whole day whatever
           * the hour, so a guest asking at eight in the evening was being offered nine in the morning. Against
           * the shop's own clock, because these times are the shop's own clock.
           */
          if (date === today.date && Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) <= today.minutes) continue;

          /**
           * The trip's own minimum, carried onto every rate. `AGENTS.md` notes that Resova already supplies
           * these and nothing filters on them yet; when something does, a party of one will stop being
           * offered a boat that needs two.
           */
          const minTickets = typeof a["minimum-tickets-required"] === "number" && a["minimum-tickets-required"] > 1 ? a["minimum-tickets-required"] : null;
          const { price, label, rates } = priceOfSlot(a.prices || [], tickets, minTickets);
          const departure: Departure = {
            item: activity.name,
            date,
            time,
            fromPrice: price,
            priceLabel: label,
            /**
             * Tax is added at their checkout, as with FareHarbor and Resova. Nothing in the availability
             * payload claims otherwise — the prices are the shop's own `source-price-gross` ticket figures,
             * repeated unchanged — and under-quoting a guest is the failure that matters, so this stays false
             * until somebody can prove a Peek total includes tax.
             */
            taxIncluded: false,
            rates,
            bookUrl: `https://book.peek.com/s/${ref.key}/${activity.pcId || ref.code}`,
            seatsLeft: spots,
          };
          const key = `${date} ${time}`;
          const duration = str((a.duration as { name?: unknown } | undefined)?.name);
          const held = best.get(key);
          const variants = held?.variants ?? new Set<string>();
          if (duration) variants.add(duration);
          if (!held || (departure.fromPrice ?? Infinity) < (held.departure.fromPrice ?? Infinity)) {
            best.set(key, { departure, duration, variants });
          } else {
            held.variants = variants;
          }
        }
        /**
         * When a time really did have several variants, the winner says which one it is. "$110" for a jet
         * ski that is sold by the hour at $110/$220/$330 is true and useless: it is the cheapest thing on
         * that row and a guest reading it has no idea they are being quoted one hour. Peek names the
         * duration on every slot, so the label carries it — but only where there was a choice, because
         * "$26 · Passenger(s) · 1 Hour 30 Minutes" on a cruise that is only ever ninety minutes is noise.
         */
        for (const hit of best.values()) {
          if (hit.variants.size > 1 && hit.duration) {
            hit.departure.priceLabel = hit.departure.priceLabel ? `${hit.departure.priceLabel} · ${hit.duration}` : hit.duration;
          }
        }
        if (best.size) {
          /**
           * Sorted before it is cut, not after. Peek returns the day in its own order — 10:00, 1:00pm,
           * 3:00pm, then 9:00am — so taking the first six of that and sorting afterwards quietly drops the
           * earliest slots of the day and keeps a later one.
           */
          out.push(
            ...[...best.values()]
              .map((h) => h.departure)
              .sort((a, b) => a.time.localeCompare(b.time))
              .slice(0, 6),
          );
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
