import http2 from "node:http2";
import type { Departure, LiveRead } from "../live.ts";
import { isConcessionFare } from "../../lib/fares.ts";

/**
 * Live availability from Rezdy, the way Rezdy's own booking page gets it.
 *
 * Rezdy is 36 booking links in this catalog and it is the vendor `sniff.ts` found sitting behind
 * iflytoto.com, which had been filed as a hand-built form. Every shop is a subdomain — `<account>.rezdy.com`
 * — and the booking page is a jQuery page, not a single-page app, so the availability call is written out in
 * the HTML in plain sight:
 *
 *     POST /availabilityAjax   showdate=YYYY-MM-DD&productId=<id>&quantity=<n>
 *
 * No key, no token, no cookie. It answers `{ availability: { "2026-09-21": { "12:00": { "<productId>":
 * { seatsAvailable, price: [...] } } } }, firstDate }` — one call covers roughly a fortnight, every start
 * time on every day, with the seats left and the full price sheet on each.
 *
 * ## Why this file speaks HTTP/2 by hand
 *
 * **Cloudflare blocks `fetch` outright on every `*.rezdy.com` booking subdomain.** Not a challenge page, not
 * a rate limit: a flat `403 Sorry, you have been blocked` on every path including `/robots.txt`, from Node's
 * `fetch`, from `curl`, and under every combination of user-agent and client-hint headers we tried — Chrome,
 * Firefox, Googlebot, none. The block is on the TLS and protocol fingerprint, and the giveaway is that
 * `rezdy.com` itself serves us fine while `aog.rezdy.com` does not.
 *
 * `node:http2` gets through, first try, because it negotiates ALPN `h2` the way a browser does and undici's
 * `fetch` speaks HTTP/1.1. So this reader is a small hand-rolled HTTP/2 client rather than a `fetch`, and
 * that is the entire difference between a vendor we can read and one that needs a browser. It is still a
 * plain request-and-reply: nothing is rendered, no JavaScript runs, and no browser is launched.
 *
 * The second trap is the opposite of what you would expect: sending `origin:` and `referer:` headers on the
 * POST — the headers a real page would send — trips the same WAF rule and turns a working `200` into a
 * `403`. They are deliberately not sent.
 *
 * Measured 20 September 2026 across the real Rezdy links in this catalog: no browser, no auth, about a
 * second and a half for a shop.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/**
 * `LiveRead["vendor"]` is `"fareharbor" | "resova" | "peek" | "checkfront" | "replay" | "agent" | "none"` and
 * does not yet have `"rezdy"` in it. Adding it is a one-word change in `live.ts`, which this file
 * deliberately does not make because another session owns that file; until it lands the name is asserted
 * here rather than a neighbouring vendor's being borrowed, so the value a caller sees is already the right one.
 */
const VENDOR = "rezdy" as LiveRead["vendor"];

type Reply = { status: number; body: string };

/**
 * One HTTP/2 request, and nothing clever.
 *
 * A session is opened per request rather than pooled: a read touches a shop three or four times over a couple
 * of seconds and a pooled session that outlives the read is a socket leaking into whatever process imported
 * this. Every failure — DNS, TLS, timeout, a WAF page — comes back as a status of zero, because a reader
 * whose job is to say "no times" has nothing useful to do with the distinction.
 */
function h2(origin: string, path: string, opts: { method?: string; body?: string; accept?: string; timeoutMs?: number } = {}): Promise<Reply> {
  const { method = "GET", body = null, accept = "*/*", timeoutMs = 12000 } = opts;
  return new Promise<Reply>((resolve) => {
    let settled = false;
    const done = (r: Reply) => { if (!settled) { settled = true; resolve(r); } };
    let client: http2.ClientHttp2Session;
    try {
      client = http2.connect(origin, { ALPNProtocols: ["h2", "http/1.1"] });
    } catch {
      return done({ status: 0, body: "" });
    }
    const timer = setTimeout(() => { try { client.destroy(); } catch { /* already gone */ } done({ status: 0, body: "" }); }, timeoutMs);
    const fail = () => { clearTimeout(timer); try { client.destroy(); } catch { /* already gone */ } done({ status: 0, body: "" }); };
    client.on("error", fail);
    try {
      const req = client.request({
        ":method": method,
        ":path": path,
        "user-agent": UA,
        accept,
        "accept-language": "en-US,en;q=0.9",
        // No `origin` and no `referer`: sending either turns this exact request into a Cloudflare 403.
        ...(body ? { "content-type": "application/x-www-form-urlencoded", "content-length": String(Buffer.byteLength(body)) } : {}),
      });
      let status = 0;
      let text = "";
      req.setEncoding("utf8");
      req.on("response", (h) => { status = Number(h[":status"]) || 0; });
      req.on("error", fail);
      req.on("data", (chunk: string) => { text += chunk; });
      req.on("end", () => { clearTimeout(timer); try { client.close(); } catch { /* already gone */ } done({ status, body: text }); });
      if (body) req.write(body);
      req.end();
    } catch {
      fail();
    }
  });
}

export type RezdyRef = {
  /** The shop's subdomain: `flytoto` out of `https://flytoto.rezdy.com/165194/aerial-tour-of-toronto`. */
  account: string;
  /** The single product the link points at, when it points at one. */
  productId: string | null;
  /** The page to read for the shop's name, clock and product list. */
  path: string;
};

/**
 * The account and the product out of any Rezdy URL we hold.
 *
 * Four shapes appear in this catalog: a product page (`/165194/aerial-tour-of-toronto`), a catalog page
 * (`/catalog/632778/channel-islands-day-trips`), the storefront (`/` or `/index`), and — for Panama City
 * Parasail — a Facebook share link with the whole Rezdy URL percent-encoded inside it, which is why the
 * string is decoded before anything is matched. `bongossportfishing.com/reservations.html#rezdygen` is a
 * shop's own page mentioning Rezdy, not a Rezdy page, and returns null rather than an account that reads
 * nothing.
 */
export function rezdyRef(url: string): RezdyRef | null {
  let decoded = url;
  try { decoded = decodeURIComponent(url); } catch { /* a stray % is not a reason to give up on the rest */ }
  const host = decoded.match(/https?:\/\/([a-z0-9-]+)\.rezdy\.com/i);
  if (!host) return null;
  const account = host[1].toLowerCase();
  if (account === "www" || account === "api") return null;
  const after = decoded.slice(decoded.indexOf(host[0]) + host[0].length);
  const product = after.match(/^\/(\d{4,9})\/([a-z0-9-]+)/i);
  if (product) return { account, productId: product[1], path: `/${product[1]}/${product[2]}` };
  const catalog = after.match(/^\/catalog\/(\d{4,9})\/([a-z0-9-]+)/i);
  if (catalog) return { account, productId: null, path: `/catalog/${catalog[1]}/${catalog[2]}` };
  return { account, productId: null, path: "/" };
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.replace(/[^\d.]/g, "")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Local dates, never UTC: `toISOString()` is five hours ahead of Eastern and rolls "tonight" into tomorrow. */
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * What time it is where the shop is.
 *
 * Every Rezdy start time is the shop's own wall clock, and every Rezdy page declares that clock in its
 * bootstrap JSON (`"timezone":"America\/Chicago"`). It matters for exactly one decision — whether a slot has
 * already started — and getting it wrong is visible in both directions: a Panama City shop read from Ontario
 * loses its 5pm at 4:30 local. `Intl` is used rather than any UTC arithmetic, for the reason above.
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

const decodeEntities = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").trim();

type Shop = {
  business: string | null;
  timezone: string | null;
  /** The products linked from whichever page we read, in the order the shop put them in. */
  products: { id: string; name: string }[];
};

/**
 * The shop, from one page of its own storefront.
 *
 * Rezdy prints everything we need in the HTML: `"companyName"` and `"timezone"` in the bootstrap JSON at the
 * top, and every product as an ordinary `<a href="/<id>/<slug>">`. A product page also names itself in
 * `<h1>` and in `data-product-id`, so a link that points at one tour costs exactly one page read and a
 * storefront costs the same one.
 */
function shopOf(html: string, wantedId: string | null): Shop {
  const business = html.match(/"companyName"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1]?.replace(/\\\//g, "/") ?? null;
  const timezone = html.match(/"timezone"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1]?.replace(/\\\//g, "/") ?? null;

  const products: { id: string; name: string }[] = [];
  if (wantedId) {
    const h1 = html.match(/<h1[^>]*>\s*([^<]{2,120}?)\s*<\/h1>/);
    const title = html.match(/<title>\s*([^<]{2,160}?)\s*<\/title>/)?.[1]?.replace(/\s+Reservations\s*$/i, "");
    products.push({ id: wantedId, name: decodeEntities(h1?.[1] || title || "Booking") });
  } else {
    const seen = new Set<string>();
    // `<h2><a href="/484669/shell-island-dolphin-boat-tour">Shell Island Dolphin Boat Tour</a></h2>` is the
    // row on a storefront; the same link also appears on the thumbnail above it, hence the de-duplication.
    for (const m of html.matchAll(/<a[^>]+href="(?:https:\/\/[a-z0-9-]+\.rezdy\.com)?\/(\d{4,9})\/[a-z0-9-]+"[^>]*>([^<]{0,160})<\/a>/gi)) {
      const id = m[1];
      const name = decodeEntities(m[2]);
      if (seen.has(id)) continue;
      if (!name) continue;
      seen.add(id);
      products.push({ id, name });
    }
  }
  return { business, timezone, products };
}

type RezdyPrice = {
  price?: string | number | null;
  priceLabel?: string | null;
  priceOptionType?: string | null;
  priceGroupType?: string | null;
  minQuantity?: number | null;
  maxQuantity?: number | null;
};

type RezdySlot = {
  id?: string;
  allDay?: boolean;
  seatsAvailable?: number | null;
  price?: RezdyPrice[] | null;
};

type RezdyAvailability = { availability?: Record<string, Record<string, Record<string, RezdySlot>>> | null; firstDate?: string | null };


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
 * The name of a price option, without the money glued to the end of it.
 *
 * Rezdy's `priceLabel` is the label and the price in one string: `"Adult (Per Person) ($149.00)"`,
 * `"Youth (8-16 Years) ($114.00)"`, and for a product with a single rate just `" ($131.00)"` with no name at
 * all. The parenthetical has to come off before `isConcessionFare` is asked, or "Youth (8-16 Years)" and
 * "Adult" both read as unlabelled and a teenager's fare becomes the headline on a mountaineering course.
 */
function rateLabel(raw: string | null | undefined): string {
  const name = (raw || "").replace(/\s*\([^()]*\$[^()]*\)\s*$/, "").trim();
  return name || "Ticket";
}

/**
 * What one seat at this time really costs.
 *
 * Two things are kept out of the headline, both of which we have shipped once:
 *
 *   - concession fares, because "Youth (8-16 Years), $114" is the cheapest row on Mountain Skills Academy's
 *     sheet and an adult cannot buy it.
 *   - every `priceOptionType: "GROUP"` option, because a group rate is conditional on the party size and this
 *     reader does not know the party. Two ways it goes wrong, and both are in the catalog: Black Hills Tour
 *     Company's "Group from 1 to 2 ($790.00 total)" is the price of the whole booking, which quoted as a
 *     ticket is the "$32 to $250 a head" bug; and Channel Islands Outfitters' "Group from 10 to 28 ($240)"
 *     is a real head price that a party of two cannot buy, which quoted as the headline under-quotes them by
 *     $45 against the $285 adult fare. The times are still offered and the rates still carry every real
 *     figure with its real label and its own `minParty`; the headline just is not one of them.
 */
function priceOfSlot(slot: RezdySlot): { price: number | null; label: string | null; rates: Departure["rates"] } {
  const rows: { rate: Departure["rates"][number]; group: boolean }[] = [];
  for (const p of slot.price || []) {
    const price = num(p.price);
    if (price == null) continue;
    rows.push({
      rate: {
        label: rateLabel(p.priceLabel),
        price,
        minParty: typeof p.minQuantity === "number" && p.minQuantity > 0 ? p.minQuantity : null,
        maxParty: typeof p.maxQuantity === "number" && p.maxQuantity > 0 ? p.maxQuantity : null,
      },
      group: p.priceOptionType === "GROUP",
    });
  }
  const rates = rows.map((r) => r.rate);
  const perHead = rows.filter((r) => !r.group);
  const open = perHead.filter((r) => !isAgeGatedFare(r.rate.label));
  // A child fare is the headline only when nothing else is sold, as everywhere else in the concierge. A shop
  // that sells only by the group has no head price at all, and saying so is better than inventing one.
  const pool = open.length ? open : perHead;
  if (!pool.length) return { price: null, label: null, rates };
  const cheapest = pool.reduce((a, b) => (a.rate.price <= b.rate.price ? a : b)).rate;
  // "Ticket" is this file's own word for a rate Rezdy gave no name to; it is not worth printing on a card.
  return { price: cheapest.price, label: cheapest.label === "Ticket" ? null : cheapest.label, rates };
}

export async function rezdyLive(
  bookingUrl: string,
  opts: { from?: Date; days?: number; maxItems?: number } = {},
): Promise<LiveRead | null> {
  const ref = rezdyRef(bookingUrl);
  if (!ref) return null;
  const origin = `https://${ref.account}.rezdy.com`;

  const page = await h2(origin, ref.path, { accept: "text/html,application/xhtml+xml,*/*;q=0.8" });
  if (page.status !== 200 || !page.body) {
    return { business: ref.account, vendor: VENDOR, departures: [], note: "Rezdy did not answer for this shop." };
  }
  /**
   * Two kinds of empty, and they are not the same answer. `toursxllc` answers 200 with "This account has
   * been canceled", and United Street Tours answers 200 with "No products available" — one shop has left
   * Rezdy and our booking link is now dead, the other is still a customer with an empty catalog. Reporting
   * both as "nothing bookable" hides a link that wants fixing.
   */
  if (/account has been canceled/i.test(page.body)) {
    return { business: ref.account, vendor: VENDOR, departures: [], note: "This shop's Rezdy account has been closed, so the booking link is dead." };
  }
  const shop = shopOf(page.body, ref.productId);
  const name = shop.business || ref.account;
  if (!shop.products.length) {
    return { business: name, vendor: VENDOR, departures: [], note: "Rezdy listed nothing bookable for this shop." };
  }

  const start = opts.from ?? new Date();
  const horizon = Math.min(opts.days ?? 7, 14);
  const maxItems = opts.maxItems ?? 4;
  const today = nowWhereTheyAre(shop.timezone);
  const startDate = ymd(start);
  const lastDate = ymd(new Date(start.getTime() + horizon * 86400_000));

  const out: Departure[] = [];
  /**
   * Rezdy keys a day-rate rental under the literal time `"All day"` — Alaska Outdoor Gear Rental's whole
   * catalog is shaped like that. There is no start time in it to quote and inventing one would be a lie
   * about when a guest is expected, so those slots are dropped; but "nothing bookable" is a lie of a
   * different kind about a shop with fifty rentals free tomorrow, so the note says which it was.
   */
  let allDayOnly = false;
  await Promise.all(
    shop.products.slice(0, maxItems).map(async (product) => {
      /**
       * One call for the whole range, not one per day: `showdate` is the date the calendar opens on and the
       * answer carries every day it knows about from there — eleven days for iflyTOTO — so four products
       * over a fortnight is four requests rather than fifty-six.
       *
       * `quantity=1` asks the question a guest with a party of one would ask, which is the widest question:
       * the party size the concierge actually holds is applied later, against each rate's own `minParty` and
       * `maxParty`, and asking for a party here would hide slots that are still real for somebody else.
       */
      const reply = await h2(origin, "/availabilityAjax", {
        method: "POST",
        body: `showdate=${startDate}&productId=${product.id}&quantity=1`,
        accept: "application/json, text/javascript, */*; q=0.01",
      });
      if (reply.status !== 200 || !/^\s*[[{]/.test(reply.body)) return;
      let doc: RezdyAvailability;
      try {
        doc = JSON.parse(reply.body) as RezdyAvailability;
      } catch {
        return;
      }
      const calendar = doc.availability || {};
      const days = Object.keys(calendar)
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today.date && d <= lastDate)
        .sort();

      for (const date of days) {
        /**
         * One departure per distinct time, cheapest variant. Rezdy keys the day by time already, but a
         * product that is sold by the hour lists the same start under several price options and a shop with
         * a return leg can key two products into one time; the cheapest per-head row of each distinct time
         * is what a guest can actually read.
         */
        const best = new Map<string, Departure>();
        for (const [rawTime, byProduct] of Object.entries(calendar[date] || {})) {
          const time = rawTime.slice(0, 5);
          if (!/^\d{2}:\d{2}$/.test(time)) {
            if (/all\s*day/i.test(rawTime)) allDayOnly = true;
            continue;
          }
          /**
           * A slot that has already started today is not availability. Rezdy returns the whole day whatever
           * the hour, so a guest asking at eight in the evening was being offered noon. Against the shop's
           * own clock, because these times are the shop's own clock.
           */
          if (date === today.date && Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) <= today.minutes) continue;

          const slot = byProduct?.[product.id] ?? Object.values(byProduct || {})[0];
          if (!slot) continue;
          // `seatsAvailable: 0` is a start time the shop publishes and has sold out. Sunshine Watersports'
          // eight o'clock comes back every day and is never bookable.
          const seats = typeof slot.seatsAvailable === "number" ? slot.seatsAvailable : null;
          if (seats != null && seats <= 0) continue;

          const { price, label, rates } = priceOfSlot(slot);
          const departure: Departure = {
            item: product.name,
            date,
            time,
            fromPrice: price,
            priceLabel: label,
            /**
             * Tax is added at their checkout, as with FareHarbor, Resova, Peek and Xola. Nothing in the
             * availability payload claims otherwise — `price` is the bare price-option figure and
             * `priceAndCurrency` is the same number formatted — and under-quoting a guest is the failure
             * that matters, so this stays false until somebody can prove a Rezdy total includes tax.
             */
            taxIncluded: false,
            rates,
            bookUrl: `${origin}/${product.id}/`,
            seatsLeft: seats,
          };
          const held = best.get(time);
          if (!held || (departure.fromPrice ?? Infinity) < (held.fromPrice ?? Infinity)) best.set(time, departure);
        }
        if (best.size) {
          // Sorted before it is cut: the payload's key order is not a clock.
          out.push(...[...best.values()].sort((a, b) => a.time.localeCompare(b.time)).slice(0, 6));
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
    note: out.length
      ? null
      : allDayOnly
        ? "This shop rents by the day on Rezdy, so there is no start time to quote."
        : `Nothing bookable online in the next ${horizon} days.`,
  };
}
