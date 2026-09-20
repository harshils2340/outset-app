import type { Departure, LiveRead } from "../live.ts";
import { isConcessionFare } from "../../lib/fares.ts";

/**
 * Live availability from Acuity Scheduling — which Squarespace bought, renamed "Squarespace Scheduling", and
 * then Square did not buy, whatever the two names suggest. See the note on infrastructure at the bottom of
 * this comment, because it is the first thing anyone reading `square.ts` beside this file will want to know.
 *
 * 52 booking links in this catalog, and they are a different kind of business from every reader we had before
 * it: massage therapists, wineries, riding schools, golf academies, bowling lanes, jet-ski kiosks and fishing
 * guides. FareHarbor, Peek, Resova and Checkfront are tour-and-activity vendors and reach none of them.
 *
 * **Shape: a JSON blob in the page, then one form POST per service. No browser, no key.**
 *
 * Every Acuity booking page — `app.acuityscheduling.com/schedule.php?owner=N`, `/schedule/<hash>`,
 * `<shop>.as.me/...`, `<shop>.acuityscheduling.com/...`, and the Squarespace-branded
 * `app.squarespacescheduling.com/...` — is the same PHP page, and it declares the whole shop in plain sight:
 *
 *     var OWNER_KEY = '909b1f48';
 *     var BUSINESS = { "id":15399189, "timezone":"America\/Chicago", "appointmentTypes":{…}, "calendars":{…} }
 *
 * `BUSINESS` carries every service with its id, duration, price and category, every calendar (staff member,
 * room, boat) with its own IANA timezone, and the shop's own name. That is the entire catalogue for free, in
 * the first 20KB of one GET.
 *
 * Availability is the old endpoint the page's own jQuery still calls, and it takes no key at all:
 *
 *     POST https://app.acuityscheduling.com/schedule.php?action=showCalendar&fulldate=1&owner=<id>&template=weekly
 *     content-type: application/x-www-form-urlencoded
 *     type=<appointmentTypeId>&calendar=<calendarId|blank>&skip=true&options[numDays]=5&month=<YYYY-MM>
 *
 * It answers `200` with an HTML *fragment*, not JSON, and that is the one place this reader differs from
 * `peek.ts` and `resova.ts`. It was worth checking properly before settling for markup: the modern JSON API
 * at `/api/v1/availability/*` and `/api/scheduling/v1/*` exists and answers `401 unauthorized` to a public
 * caller, because it is the developer API and wants the shop's own key. The fragment endpoint is what the
 * public widget actually uses, and it is stable, cheap and unauthenticated.
 *
 * The fragment is not scraped loosely. Every bookable start is one radio input whose `value` is already the
 * machine-readable local date and 24-hour time:
 *
 *     <input type='radio' class='time-selection' value="2026-09-20 09:30" id="appt1789914600">
 *
 * so the parse is one regular expression over an attribute the widget's own JavaScript submits, not over
 * rendered prose. A shop with nothing free returns the same fragment with no such inputs, which is how "no
 * availability" is told apart from "did not answer".
 *
 * **Does it share infrastructure with Square?** No, and this was checked rather than assumed, because the
 * brief reasonably suspected it. Square Appointments answers
 * `POST app.squareup.com/appointments/api/buyer/availability` with JSON and epoch-second slots; Acuity answers
 * a PHP form post with HTML. Different hosts, different auth (none, both, but differently shaped), different
 * payloads, no shared token. Acuity belongs to Squarespace, not to Square; the names collide and the systems
 * do not. The two readers share nothing but this file's shape.
 *
 * Measured 20 September 2026 across the catalog's real Acuity links: see the report. A cold read of a shop is
 * one page fetch plus one POST per service.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/**
 * `LiveRead["vendor"]` is `"fareharbor" | "resova" | "peek" | "checkfront" | "replay" | "agent" | "none"` and
 * does not yet have `"acuity"` in it. Adding it is a one-word change in `live.ts`, which this file
 * deliberately does not make because another session owns that file; until it lands the name is asserted here
 * rather than a neighbouring vendor's being borrowed, exactly as `peek.ts` does, so the value a caller sees is
 * already the right one.
 */
const VENDOR = "acuity" as LiveRead["vendor"];

export type AcuityRef = {
  /** The page to read the shop out of, already absolute. */
  page: string;
  /** Services named in the link itself, when the shop linked to one rather than to its whole menu. */
  onlyTypes: number[];
  /** Calendars named in the link itself (one boat, one instructor). */
  onlyCalendars: number[];
  /** Categories named in the link itself, e.g. `?categories[]=Clinic Series`. */
  onlyCategories: string[];
};

/**
 * The booking page, and any filter the shop put in its own link, out of any Acuity URL we hold.
 *
 * Five host shapes appear in this catalog and all five are the same application: `app.acuityscheduling.com`,
 * `app.squarespacescheduling.com`, `<shop>.acuityscheduling.com`, `<shop>.as.me` (29 of the 52 links, the
 * single commonest shape, and easy to miss because the string "acuity" does not appear in it), and the bare
 * `<shop>.as.me` with no path at all, which redirects to that shop's own `/schedule/<hash>`.
 *
 * Two kinds of damage in the stored links are repaired rather than dropped, because both point at a real
 * shop that really does sell online:
 *
 *   - a Google redirect wrapper (`google.com/url?q=<encoded acuity url>`), which is what a crawl collects
 *     when the operator's site was found through a Google cache;
 *   - a link whose punctuation the crawl ate — `beaumontwinery.com/https/appacuityschedulingcom/
 *     schedulephpowner19227159` is Beaumont Family Estate Winery, owner 19227159, and it is either that or
 *     telling a guest to phone a winery that takes bookings online.
 */
export function acuityRef(url: string): AcuityRef | null {
  let u = url.trim();

  // A Google redirect wrapper: the real link is the `q` parameter, percent-encoded.
  const wrapped = u.match(/[?&]q=(https?%3A%2F%2F[^&]+)/i);
  if (wrapped) {
    try {
      u = decodeURIComponent(wrapped[1]);
    } catch {
      // A wrapper we cannot decode is no worse than the wrapper itself; carry on with the original.
    }
  }

  const filters = (name: string): string[] => {
    const out: string[] = [];
    for (const m of u.matchAll(new RegExp(`[?&]${name}(?:%5B%5D|\\[\\])?=([^&#]+)`, "gi"))) {
      try {
        out.push(decodeURIComponent(m[1].replace(/\+/g, " ")));
      } catch {
        out.push(m[1]);
      }
    }
    return out;
  };

  const ids = (name: string): number[] =>
    filters(name)
      .flatMap((v) => v.split(","))
      // `?appointmentType=category:Bass Trips` names a category through the type parameter; it is not an id.
      .map((v) => Number(v.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);

  const onlyCategories = [
    ...filters("categories"),
    ...filters("category"),
    ...filters("appointmentType").filter((v) => /^category:/i.test(v)).map((v) => v.replace(/^category:/i, "")),
  ].map((s) => s.trim()).filter(Boolean);

  const ref = (page: string): AcuityRef => ({
    page,
    onlyTypes: [...ids("appointmentType"), ...ids("appointmentTypeIds"), ...ids("appointmentTypeID")],
    onlyCalendars: [...ids("calendarIds"), ...ids("calendarID"), ...ids("calendar")],
    onlyCategories,
  });

  // The ordinary shapes: any host running the scheduler, with or without a path.
  const host = u.match(/^https?:\/\/([a-z0-9-]+\.)?(acuityscheduling\.com|squarespacescheduling\.com|as\.me)(\/[^\s]*)?/i);
  if (host) {
    const path = host[3] && host[3] !== "/" ? host[3] : "";
    return ref(`https://${host[1] ?? ""}${host[2]}${path}`.replace(/#.*$/, ""));
  }

  /**
   * A link whose punctuation the crawl ate. Only the owner id is trusted out of it — the rest of the string
   * is a different domain and must not be fetched — and it is rebuilt into the canonical page.
   */
  const mangled = u.match(/(?:acuityscheduling|squarespacescheduling)[^0-9]{0,40}owner[^0-9]{0,3}(\d{5,12})/i);
  if (mangled) return ref(`https://app.acuityscheduling.com/schedule.php?owner=${mangled[1]}`);

  return null;
}

/** Local dates, never UTC: `toISOString()` is five hours ahead of Eastern and rolls "tonight" into tomorrow. */
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const num = (v: unknown): number | null => {
  // "1,695.00" and "$225.00" both appear; "0.00" is a service the shop prices off-page, not a free one.
  const n = typeof v === "string" ? Number(v.replace(/[^\d.]/g, "")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/**
 * What time it is where the shop is.
 *
 * Copied from `peek.ts` for the reason given there: it decides one thing, whether a slot has already started,
 * and getting it wrong is visible in both directions. Acuity puts an IANA zone on `BUSINESS.timezone` and
 * another on every calendar, so this is never a guess — a Hawaii fishing charter read from Ontario would
 * otherwise have its whole day dropped before the guest woke up.
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

type AcuityType = {
  id: number;
  name: string;
  /** Minutes. The price driver for a spa exactly as it is for a jet ski. */
  duration: number | null;
  price: number | null;
  category: string | null;
  active?: boolean;
  private?: boolean;
  /** `"service"` or `"class"`. Both have start times; a class has a fixed one and a roster. */
  type?: string | null;
  calendarIDs?: number[];
};

type AcuityBusiness = {
  id: number;
  name: string | null;
  timezone: string | null;
  /** The shop has chosen not to publish prices on its own widget. Honoured; see `shopHidesPrices`. */
  hidePrice: boolean;
  types: AcuityType[];
};

/**
 * The shop, out of the `var BUSINESS = {…};` the page declares.
 *
 * Read with a brace-matching scan rather than a lazy regex, because the blob is one line containing every
 * service description the shop has ever written, semicolons and `};` included, and `/var BUSINESS = (\{.*?\});/`
 * truncates it at the first service whose description contains a brace.
 */
function businessOf(html: string): AcuityBusiness | null {
  const at = html.indexOf("var BUSINESS = ");
  if (at < 0) return null;
  const open = html.indexOf("{", at);
  if (open < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = open; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) { end = i + 1; break; }
  }
  if (end < 0) return null;

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(html.slice(open, end)) as Record<string, unknown>;
  } catch {
    return null;
  }

  const types: AcuityType[] = [];
  const grouped = raw["appointmentTypes"];
  if (grouped && typeof grouped === "object") {
    for (const list of Object.values(grouped as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      for (const t of list as Record<string, unknown>[]) {
        const id = Number(t["id"]);
        if (!Number.isFinite(id)) continue;
        types.push({
          id,
          name: str(t["name"]) || "Booking",
          duration: Number.isFinite(Number(t["duration"])) && Number(t["duration"]) > 0 ? Number(t["duration"]) : null,
          price: num(t["price"]),
          category: str(t["category"]),
          active: t["active"] !== false,
          private: t["private"] === true,
          type: str(t["type"]),
          calendarIDs: Array.isArray(t["calendarIDs"]) ? (t["calendarIDs"] as unknown[]).map(Number).filter(Number.isFinite) : [],
        });
      }
    }
  }

  const id = Number(raw["id"]);
  if (!Number.isFinite(id)) return null;
  return {
    id,
    name: str(raw["name"]),
    timezone: str(raw["timezone"]),
    hidePrice: raw["hidePrice"] === true,
    types,
  };
}

/**
 * How a service is named when several of them start at the same minute.
 *
 * "90 minutes" is the whole difference between two massages that both start at 14:00 and cost $95 and $140,
 * and `Departure.item` carries the service name already. This is the second line: the length, when the shop
 * published one, in the words a person would say.
 */
function durationLabel(minutes: number | null): string | null {
  if (!minutes) return null;
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

/**
 * Whether this URL's own filters, or the shop's own flags, rule a service out.
 *
 * A shop that links to one service wants that service read. `?appointmentType=96692308` is Rockmeadow
 * Equestrian's lesson booking and the rest of its menu is not what the operator put on its website; reading
 * the whole menu there would answer a riding lesson with a stable tour.
 */
function wanted(t: AcuityType, ref: AcuityRef | null): boolean {
  if (t.active === false || t.private === true) return false;
  if (ref) {
    if (ref.onlyTypes.length && !ref.onlyTypes.includes(t.id)) return false;
    if (ref.onlyCategories.length) {
      const cat = (t.category || "").trim().toLowerCase();
      if (!ref.onlyCategories.some((c) => c.trim().toLowerCase() === cat)) return false;
    }
    if (ref.onlyCalendars.length && t.calendarIDs?.length && !t.calendarIDs.some((c) => ref.onlyCalendars.includes(c))) return false;
  }
  /**
   * Not a night out. The same rule the menu reader applies, for the same reason: "Gift Certificate" and
   * "Consultation (free)" are real bookable appointment types and neither is the answer to "what can I do in
   * Galveston on Saturday". Deliberately narrow — "private charter" is a real thing a guest buys and stays.
   */
  if (/\b(gift\s*(card|certificate|voucher)|waitlist|account balance)\b/i.test(t.name)) return false;
  /**
   * An add-on is not an outing. It is sold beside a booking, never instead of one, and it is both the
   * cheapest line on the menu and free at every slot — so the cheapest-wins rule below reads "Add-on: hot
   * towels, $10" as the price of a massage. Same bug as Peek quoting "Cancellation Insurance, $2.60" as a
   * boat trip.
   */
  if (/(\badd[- ]?on\b|\badd'?[ln]?t\b|\badditional\s+(person|guest|passenger|angler|rider|player|hour)|\bextra\s+(person|guest|passenger|angler|rider|player)|\bupgrade\b|\benhancement\b)/i.test(t.name)) return false;
  return true;
}

/**
 * Whether the number beside this service is the price of the outing or a down payment on it.
 *
 * Flight Providers sells every jump as "Tandem Skydive Deposit, $25.00". The $25 is real and the slot is
 * real; the skydive is not $25. Quoting it is the FareHarbor pre-tax mistake made much worse, so the time is
 * offered with no price at all rather than with a price that is off by a factor of ten. Dropping the shop
 * instead would be worse again: it sells online, today, and `AGENTS.md` is explicit that saying "we would
 * call them" about a shop with a live calendar is a false statement about a real business.
 */
function isDownPayment(name: string): boolean {
  return /\b(deposit|down\s*payment|hold your|reservation fee|booking fee)\b/i.test(name);
}

/**
 * One service's free starts over the next few days.
 *
 * `template=weekly` with `options[numDays]` is the widget's own "show me more times" call and returns a run of
 * consecutive days in one request, which is the difference between one POST per service and one per service
 * per day. `month` has to be sent and has to be the month the run starts in; Acuity uses it to decide which
 * page of its calendar to build, and sending next month's returns an empty fragment rather than an error.
 */
async function timesOf(ownerId: number, type: AcuityType, calendar: string, from: string, days: number, timeoutMs: number): Promise<string[]> {
  const body = new URLSearchParams({
    type: String(type.id),
    /**
     * `"any"`, not blank. This is the one parameter that decides whether the call works at all: Acuity reads
     * an empty `calendar` as "no calendar selected" and answers `200` with a 529-byte fragment containing a
     * "More Times" link and no times, which looks exactly like a shop with an empty diary. It cost a whole
     * run of 51 shops reporting nothing bookable before the difference was spotted. `"any"` is what the
     * widget sends when the guest has not picked a staff member, boat or room.
     */
    calendar,
    skip: "true",
    "options[qty]": "1",
    "options[numDays]": String(days),
    ignoreAppointment: "",
    appointmentType: String(type.id),
    calendarID: calendar,
    month: from.slice(0, 7),
  });
  try {
    const res = await fetch(
      `https://app.acuityscheduling.com/schedule.php?action=showCalendar&fulldate=1&owner=${ownerId}&template=weekly`,
      {
        method: "POST",
        headers: {
          "user-agent": UA,
          accept: "text/html, */*; q=0.01",
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
          "x-requested-with": "XMLHttpRequest",
          referer: `https://app.acuityscheduling.com/schedule.php?owner=${ownerId}`,
        },
        body: body.toString(),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    if (!res.ok) return [];
    const html = await res.text();
    /**
     * The machine-readable attribute the widget submits, not the rendered "9:30am" beside it. `value` is
     * already local date and local 24-hour time, in the shop's own zone, which is the only form this reader
     * wants and removes every locale question from the parse.
     */
    return [...html.matchAll(/class=['"]time-selection['"][^>]*\bvalue=['"](\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})['"]/g)]
      .map((m) => `${m[1]} ${m[2]}`);
  } catch {
    return [];
  }
}

export async function acuityLive(
  bookingUrl: string,
  opts: { from?: Date; days?: number; maxItems?: number } = {},
): Promise<LiveRead | null> {
  const ref = acuityRef(bookingUrl);
  if (!ref) return null;

  const page = async (url: string): Promise<AcuityBusiness | null> => {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, accept: "text/html" },
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return null;
      return businessOf(await res.text());
    } catch {
      return null;
    }
  };

  let shop = await page(ref.page);
  /**
   * The branded page sometimes declares an empty menu. `<shop>.as.me/schedule/<hash>` and the newer
   * `/schedule/<hash>?categories[]=…` pages ship `"appointmentTypes":[]` and load the list afterwards, while
   * the canonical `app.acuityscheduling.com/schedule.php?owner=<id>` for the same shop carries every service
   * inline. Morningside Stables, She's My Golf Pro and Anacortes Community Boating all read as "nothing
   * bookable" on the first page and have full diaries on the second. One extra GET, only when the first came
   * back empty, and only ever to Acuity's own canonical host.
   */
  if (shop && !shop.types.length) shop = (await page(`https://app.acuityscheduling.com/schedule.php?owner=${shop.id}`)) ?? shop;
  if (!shop) {
    return { business: bookingUrl, vendor: VENDOR, departures: [], note: "Acuity did not answer for this shop." };
  }
  const name = shop.name || bookingUrl;

  const bookable = shop.types.filter((t) => wanted(t, null));
  /**
   * The link's own filter, and the whole menu when the filter matches nothing.
   *
   * A shop that links to one service wants that service read, so the filter leads. But the filters in this
   * catalog have been rotting for a while: She's My Golf Pro links to `?categories[]=Clinic Series` and its
   * category is now called " Weekly Clinic Sign-Up", Morningside Stables links to an appointment type it has
   * since retired, and Body Balance's category carries a `®` that no longer survives the round trip. Honouring
   * a stale filter to the letter turns three shops with full diaries into three phone calls, so a filter that
   * selects nothing is treated as out of date rather than as an answer.
   */
  const filtered = bookable.filter((t) => wanted(t, ref));
  const types = filtered.length ? filtered : bookable;
  if (!types.length) {
    return {
      business: name,
      vendor: VENDOR,
      departures: [],
      note: shop.types.length
        ? "This Acuity link points at nothing a guest can book."
        : "Acuity listed no services for this shop.",
    };
  }

  const start = opts.from ?? new Date();
  const horizon = Math.min(opts.days ?? 7, 14);
  const maxItems = opts.maxItems ?? 6;
  const today = nowWhereTheyAre(shop.timezone);
  const from = ymd(start);

  /**
   * One row per distinct start, cheapest service on it.
   *
   * This is the rule an appointment system needs more than a tour vendor does. Fishin Addiction sells four
   * lengths of the same charter and every one of them starts at 09:30, so reading the menu straight gives a
   * guest four 09:30 cards at $625, $695, $795 and $975 and no way to tell them apart. The cheapest is kept,
   * and because the *length* is what the other three were selling, the winner says how long it is.
   */
  const best = new Map<string, { departure: Departure; lengths: Set<string> }>();

  await Promise.all(
    types.slice(0, maxItems).map(async (type) => {
      /**
       * One calendar when the link named one, otherwise any. `?calendarIds=8368294` is Baylands Golf Links
       * pointing at one specific bay, and reading every bay there would quote a time on a resource the
       * operator did not link to.
       */
      const calendar = ref.onlyCalendars.length && type.calendarIDs?.some((c) => ref.onlyCalendars.includes(c))
        ? String(ref.onlyCalendars.find((c) => type.calendarIDs!.includes(c)))
        : "any";
      const slots = await timesOf(shop.id, type, calendar, from, horizon, 12000);
      for (const slot of slots) {
        const [date, time] = slot.split(" ");
        if (date < today.date) continue;
        /**
         * A slot that has already started today is not availability. Acuity returns the whole day whatever
         * the hour, and against the shop's own clock, because these times are the shop's own clock.
         */
        if (date === today.date && Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) <= today.minutes) continue;
        if (date > ymd(new Date(start.getTime() + horizon * 86400_000))) continue;

        /**
         * A shop that hides prices on its own widget is not quoted one. `hidePrice` is the operator's own
         * setting and it usually means the number in the catalogue is stale or is a deposit — Fishin
         * Addiction hides it and has the real figures typed into the service names instead. Quoting a price
         * the operator deliberately took off their own page is the same class of error as quoting a
         * pre-tax total: a number the guest will not be charged.
         */
        const price = shop.hidePrice || isDownPayment(type.name) ? null : type.price;
        const length = durationLabel(type.duration);
        /**
         * Concessions never lead. An Acuity menu really does carry "Junior Lesson" and "Senior Rate" beside
         * the ordinary one at the same hour, and the cheapest-wins rule above would pick the one an adult
         * cannot buy. `isConcessionFare` is the same test every other reader uses.
         */
        const concession = isConcessionFare(type.name);

        const departure: Departure = {
          item: type.name,
          date,
          time,
          fromPrice: price,
          priceLabel: null,
          /**
           * Acuity's `price` is what the shop typed into its service, and its checkout adds whatever tax the
           * shop configured on top. Nothing in the payload claims a tax-inclusive figure, and under-quoting a
           * guest is the failure that matters, so this stays false until somebody can prove otherwise.
           */
          taxIncluded: false,
          rates: price != null ? [{ label: length ? `${type.name} · ${length}` : type.name, price, minParty: null, maxParty: null }] : [],
          bookUrl: ref.page,
          // Acuity's public fragment says a time is free; it does not say how many places are left.
          seatsLeft: null,
        };

        const key = `${date} ${time}`;
        const held = best.get(key);
        const lengths = held?.lengths ?? new Set<string>();
        if (length) lengths.add(length);
        const heldConcession = held ? isConcessionFare(held.departure.item) : false;
        const better =
          !held ||
          // A buyable fare always beats a concession, whatever the two cost.
          (heldConcession && !concession) ||
          (heldConcession === concession && (departure.fromPrice ?? Infinity) < (held.departure.fromPrice ?? Infinity));
        if (better) best.set(key, { departure, lengths });
        else held!.lengths = lengths;
      }
    }),
  );

  /**
   * Where there really was a choice at that minute, the winner says which one it is. "$95" for a spa that
   * sells 60, 90 and 120 minutes at that hour is true and useless. Where the shop only ever sells one length
   * at a time, the label stays empty, because "· 1 hr" on every card is noise.
   */
  for (const hit of best.values()) {
    if (hit.lengths.size > 1) {
      const own = hit.departure.rates[0]?.label.split(" · ").pop() ?? null;
      if (own) hit.departure.priceLabel = own;
    }
  }

  const out = [...best.values()]
    .map((h) => h.departure)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

  /**
   * The first day with something free is enough; a guest is choosing between shops, not between dates, and a
   * charter that sells a start every half hour returns fifty rows a day. Six of the earliest, as Peek does.
   */
  const firstDay = out.length ? out[0].date : null;
  const shown = firstDay ? out.filter((d) => d.date === firstDay).slice(0, 6) : [];

  return {
    business: name,
    vendor: VENDOR,
    departures: shown,
    note: shown.length ? null : `Nothing bookable online in the next ${horizon} days.`,
  };
}
