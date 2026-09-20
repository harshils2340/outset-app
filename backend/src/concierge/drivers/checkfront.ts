import type { Browser } from "playwright";
import type { Departure, LiveRead } from "../live.ts";
import { isConcessionFare, openFarePrice } from "../../lib/fares.ts";
import { checkfrontRef } from "../../enrich/vendors/checkfront.ts";

/**
 * Checkfront, read from the endpoint its own booking form reads.
 *
 * The first of the per-vendor drivers, and the one that settled the argument about whether they are worth
 * writing. A generic agent guessing selectors found nothing on four shops in fifty seconds each. This finds
 * real times in well under a second a shop, with no browser at all, because the flow was worked out by
 * watching what the hosted page actually asks for rather than by guessing at its markup.
 *
 * The flow, in the order a visitor performs it and in the order this replays it:
 *
 * 1. **The hosted page, never the embed.** `adventurerooms.ca/booknow/` is an iframe that stays
 *    `about:blank` and whose calendar request lives in its own session. `adventureroomscanada.checkfront.com`
 *    is the same booking engine with nothing in the way. `vendors.ts` rebuilds that URL from the account id
 *    sitting in the embed.
 * 2. **`GET /reserve/inventory/?category_id=0&start_date=…`** is what the page fetches once a category card
 *    is clicked, and `category_id=0` means *every* category, so the category step a visitor has to perform is
 *    not a step here at all. It answers with JSON wrapping the listings markup, and each listing carries its
 *    item id as `cf-item-data-<id>`.
 * 3. **`POST /reserve/api/?call=rate`** with `item_id` and `start_date` is what fires when "Book Now" is
 *    clicked, and it is the whole answer: per-date status, the times, the per-date price for every fare, and
 *    how many of each slot are left. It needs no session, no cookie and no token.
 *
 * Driving the visible page was tried first and is the wrong tool. Everything on it — the calendar cells, the
 * item panel, the time dropdown — is drawn from this one call, so reading the DOM is reading a rendering of
 * a JSON document we can simply ask for. Scraping it back out of the markup could only ever lose fidelity:
 * the DOM cannot tell us that a 22:30 slot exists but is unavailable, and this can.
 *
 * The shape here is the template for the others. A driver knows its vendor's three or four steps and nothing
 * about any particular shop, so one of these serves every business on that vendor.
 *
 * It reads. It does not book, fill in a name, or submit anything. `call=rate` is a price quote; nothing in
 * here posts to a cart or a checkout.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** Checkfront keys its own date maps as `20260922`, with no separators. */
const compact = (iso: string) => iso.replace(/-/g, "");
const fromCompact = (k: string) => `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`;
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return ymd(d);
};

/**
 * The newer storefront is `<account>.checkfront.site`, but the booking engine, and every endpoint below, is
 * on `.com` for the same account, so both hosts resolve to the same shop.
 */
export function checkfrontAccount(url: string): string | null {
  return url.match(/https?:\/\/([a-z0-9-]+)\.checkfront\.(?:com|site)/i)?.[1]?.toLowerCase() ?? null;
}

/** A Checkfront status letter. `A` is the only one a guest can buy: `B` is booked, `U`/`C` unavailable or closed. */
const AVAILABLE = /^(?:A|AVAILABLE)$/i;

type Slot = { time: string; seatsLeft: number | null };
/**
 * `label` is what the shop calls this fare and what a guest may be shown; `fareKey` is Checkfront's machine
 * name for it, kept because an account that never labelled its fares still keys them "child6to12", and that
 * is the only thing standing between a guest and a child's price on the card.
 */
type Fare = { label: string; fareKey: string; price: number; minParty: number | null; maxParty: number | null };
type DayRead = { date: string; slots: Slot[]; fares: Fare[]; priceUnit: string | null };

async function post(account: string, body: string, ms: number): Promise<any | null> {
  try {
    const res = await fetch(`https://${account}.checkfront.com/reserve/api/?call=rate`, {
      method: "POST",
      headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body,
      signal: AbortSignal.timeout(ms),
    });
    const text = await res.text();
    // Checkfront answers 200 with an HTML shell for anything it does not recognise, so the body decides, not the status.
    if (!text.trimStart().startsWith("{")) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * The listings for a day, and the item ids behind them.
 *
 * On a day the shop is shut Checkfront still renders a tile per item, but as an "Upcoming" card with no item
 * id on it at all and a `data-date` holding the next day that item runs. That is not a failure to parse: it
 * is the page telling us when to come back, so the next date is returned and the caller asks again for it.
 */
async function inventory(account: string, date: string, ms: number): Promise<{ ids: string[]; nextDate: string | null; live: boolean }> {
  const url =
    `https://${account}.checkfront.com/reserve/inventory/` +
    `?cacheable=1&view=H&category_id=0&start_date=${date}&end_date=${date}`;
  let html = "";
  let live = true;
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(ms) });
    // A closed account is not an empty one: Checkfront serves "No Service" and a 404 for a subdomain it no
    // longer hosts, and a shop that has left the vendor should read as a phone call, not as a quiet day.
    live = res.status !== 404;
    const text = await res.text();
    html = text.trimStart().startsWith("{") ? (JSON.parse(text).inventory ?? "") : text;
  } catch {
    return { ids: [], nextDate: null, live: true };
  }
  const ids = [...new Set([...html.matchAll(/cf-item-data-(\d+)/g)].map((m) => m[1]))];
  const upcoming = [...html.matchAll(/data-date=['"](\d{8})['"]/g)].map((m) => fromCompact(m[1])).filter((d) => d > date).sort();
  return { ids, nextDate: upcoming[0] ?? null, live };
}

/**
 * Everything bookable on one date for one item.
 *
 * Checkfront publishes two shapes and a reader that knows only one loses half the catalog. A timed session
 * (`unit: "TS"`, an escape room or a cruise) gives `timeslots: [{start_time, status}]`; an hourly rental
 * (`unit: "H"`, a boat or a jet ski) gives `times: {"11:00": {A, B}}`, where `A` is how many are still free.
 * Both are the start times a guest may choose, so both are read.
 */
function dayRead(item: any, key: string): DayRead | null {
  const d = item?.rate?.dates?.[key];
  if (!d || !AVAILABLE.test(String(d.status ?? ""))) return null;

  /**
   * A group's children arrive with `param` as a JSON string rather than an object, so it is parsed before
   * anything reads a fare's label or its hidden flag off it. Left unparsed it silently answers undefined for
   * every fare, which loses both the shop's own names for them and the flags that say which are not for sale.
   */
  let params: Record<string, any> = {};
  if (item?.param && typeof item.param === "object") params = item.param;
  else if (typeof item?.param === "string") {
    try {
      const parsed = JSON.parse(item.param);
      if (parsed && typeof parsed === "object") params = parsed;
    } catch {
      /* Checkfront's own encoding; if it is not JSON there is nothing to learn from it. */
    }
  }

  const slots: Slot[] = [];
  for (const t of Array.isArray(d.timeslots) ? d.timeslots : []) {
    if (!t?.start_time || !AVAILABLE.test(String(t.status ?? ""))) continue;
    // `A` is how many are left. A slot marked available with none left is not one, whatever the letter says.
    if (typeof t.A === "number" && t.A <= 0) continue;
    slots.push({ time: String(t.start_time).slice(0, 5), seatsLeft: typeof t.A === "number" ? t.A : null });
  }
  for (const [time, v] of Object.entries<any>(d.times && typeof d.times === "object" ? d.times : {})) {
    const free = typeof v?.A === "number" ? v.A : 1;
    if (free > 0 && /^\d{1,2}:\d{2}$/.test(time)) slots.push({ time: time.padStart(5, "0"), seatsLeft: free });
  }
  if (!slots.length) return null;

  /**
   * The fares that apply on this date, taken from this date's own price map. They belong to the same rate
   * record as the times above — the one the booking form quotes from for this item on this day — so they are
   * that slot's price and not a number found elsewhere on the page.
   *
   * The labels come from the item's own parameter definitions, because the map is keyed by machine names
   * ("child6to12", "privatebookings") and a guest must never be shown one of those, nor may a child fare slip
   * past the concession filter for want of a readable name.
   *
   * Those same definitions say which fares a customer is allowed to see. Dine and Cruise prices its dinner
   * cruise at $26.95 an adult, but its date map also carries `adult` at $21.95 marked `hide`, and `spinnaker`
   * at $20.86 and `12hour` at $211.86 marked `customer_hide` — a legacy rate and two internal charter rates
   * that nobody can buy on that page. Taking the cheapest number in the map quoted the $20.86 one. A price
   * the shop hides from its own customers is not a price we may put in front of ours.
   */
  const fares: Fare[] = [];
  for (const [param, amount] of Object.entries<any>(d.price && typeof d.price === "object" ? d.price : {})) {
    const price = Math.round(Number(amount) * 100) / 100;
    if (!Number.isFinite(price) || price <= 0 || price > 20000) continue;
    const def = params[param];
    if (def && typeof def === "object" && (Number(def.hide) === 1 || Number(def.customer_hide) === 1)) continue;
    const named = String((def && typeof def === "object" && def.lbl) || "").replace(/[_-]+/g, " ").trim();
    const range = String(item?.rate?.event?.[0]?.[param]?.range ?? "").match(/^(\d+)\s*-\s*(\d+)$/);
    fares.push({
      // "Ticket" rather than "privatebookings": an unlabelled fare has no name fit to show anyone.
      label: named ? named.slice(0, 60) : "Ticket",
      fareKey: param.replace(/([a-z])(\d)/gi, "$1 $2").replace(/(\d)([a-z])/gi, "$1 $2"),
      price,
      minParty: range ? Number(range[1]) : null,
      maxParty: range ? Number(range[2]) : null,
    });
  }
  return { date: fromCompact(key), slots, fares, priceUnit: item?.rate?.summary?.price?.unit || null };
}

/** What a fare is called for the purpose of deciding whether a guest could buy it at all. */
const fareText = (f: Fare) => `${f.label} ${f.fareKey}`;

/** The shop's own name for a fare, when it has one worth showing. "Qty" is Checkfront's default and says nothing. */
function fareLabel(fares: Fare[]): string | null {
  const open = fares.filter((f) => !isConcessionFare(fareText(f)));
  const cheapest = (open.length ? open : fares).slice().sort((a, b) => a.price - b.price)[0];
  if (!cheapest) return null;
  // Some accounts name the only fare after an office procedure — Long Beach Watersports prices a jet ski
  // rental under "Reschedule". The figure is the shop's own and is kept; the word is not shown to a guest.
  return /^(qty|quantity|price|rate|ticket)$/i.test(cheapest.label) || /\b(reschedul\w*|deposit|balance|fee|surcharge|admin\w*)\b/i.test(cheapest.label)
    ? null
    : cheapest.label;
}

export async function checkfrontLive(
  hostedUrl: string,
  opts: {
    /** Accepted so a caller holding a shared browser can pass one, and deliberately unused: this needs no browser. */
    browser?: Browser;
    date?: Date;
    budgetMs?: number;
  } = {},
): Promise<LiveRead | null> {
  const account = checkfrontAccount(hostedUrl);
  if (!account) return null;
  const until = Date.now() + (opts.budgetMs ?? 20000);
  const left = () => Math.min(15000, Math.max(0, until - Date.now()));
  const wanted = ymd(opts.date ?? new Date());
  /**
   * Keyed by date and time, keeping the cheapest, because a shop with eight pontoons free at eleven has one
   * eleven o'clock to offer a guest, not eight. The answer a guest wants is which times this business can
   * take them and from what price.
   */
  const found = new Map<string, Departure>();
  let note: string | null = null;
  /** One item that answers per date settles the shop; `fixed` remembers that an item was dropped for not doing so. */
  let proven = false;
  let fixed = false;

  try {
    /**
     * The items. A booking link often names them itself — the catalog is full of URLs like
     * `?item_id=428,430&category_id=59` — and those are the ones that shop wanted a guest to see, so they are
     * tried first. They also go stale: VIP Ontario Tours' link names 39 items and the first of them no longer
     * exists, so the listing is read as well rather than instead. The listing for the day is what the hosted
     * page itself fetches, and on a day the shop is shut it answers with the next day each item runs, which is
     * then read once more.
     */
    let day = wanted;
    const listed = await inventory(account, day, left());
    let ids = listed.ids;
    if (!ids.length && listed.nextDate && listed.nextDate <= addDays(wanted, 14) && Date.now() < until) {
      day = listed.nextDate;
      ids = (await inventory(account, day, left())).ids;
    }
    const named = (checkfrontRef(hostedUrl)?.itemIds ?? []).map(String);
    ids = [...new Set([...named.filter((id) => !ids.length || ids.includes(id)), ...ids])];
    if (!ids.length) {
      return {
        business: account,
        vendor: "replay",
        departures: [],
        note: listed.live
          ? "Their booking page lists nothing bookable in the next fortnight."
          : "That Checkfront account is closed, so they no longer sell through it.",
      };
    }

    /**
     * Three items at a time. A shop's first listings are often gift certificates, add-ons or whole-day tours
     * that carry no times at all — Adventure Rooms lists eleven before its first escape room, and VIP Ontario
     * Tours twenty day tours before its first timed one — so enough of the catalogue has to be asked to get
     * past them, and asking one at a time would spend ten seconds of a guest's wait doing it. The deadline,
     * not the count, is what really stops this: whoever is late is left out of the answer anyway.
     *
     * A fortnight in one call is the cheap question, and it answers two: which day this item next runs, and
     * whether this account's answers move with the date at all.
     */
    const queue = ids.slice(0, 24);
    for (let i = 0; i < queue.length && found.size < 8 && Date.now() < until; i += 3) {
      const batch = await Promise.all(
        queue.slice(i, i + 3).map((id) => post(account, `item_id=${id}&start_date=${day}&end_date=${addDays(day, 14)}&qty=1`, left())),
      );

      for (const range of batch) {
        if (found.size >= 8 || Date.now() >= until) break;
        const items: any[] = [];
        for (const node of [range?.item, ...(range?.item?.product_group_children ?? [])]) {
          // A product group ("The Mayor's Office" in standard, duel and tournament formats) prices its children,
          // not itself, and the children arrive in the same answer, so no second request is needed for them.
          // A group's parent carries an empty date map of its own, so "has dates" means dates with something in them.
          if (Object.keys(node?.rate?.dates ?? {}).length) items.push(node);
        }
        if (!items.length) continue;

        const fortnight = items[0].rate.dates as Record<string, any>;
        /**
         * Evidence that this account answers per date, gathered from every item asked about and not only
         * from the ones with times in them. A day that is shut while another is open, or that holds a
         * different number of slots, cannot be a published opening-hours grid. VIP Ontario Tours is the case
         * that needs it: its city tour is unavailable today and available later, which settles the account,
         * while the timed tour that follows it leaves at the same hour every day of the fortnight.
         */
        const shape = (k: string) => `${fortnight[k]?.status}:${(fortnight[k]?.timeslots ?? []).length}:${Object.keys(fortnight[k]?.times ?? {}).length}`;
        if (new Set(Object.keys(fortnight).map(shape)).size >= 2) proven = true;

        const open = Object.keys(fortnight)
          .filter((k) => AVAILABLE.test(String(fortnight[k]?.status ?? "")) && fromCompact(k) >= wanted)
          .sort();
        if (!open.length) continue;
        const on = open[0];

        /**
         * The day itself, asked for on its own, which is exactly what the booking form does when a guest
         * picks a date: `start_date` and nothing else. A range answers a different question and its first
         * date is not the same answer — Mango Studio's hourly room comes back with four free hours today in
         * a fortnight query and one in a query for today, and it is today's guest we are quoting. One call
         * covers a product group's children too, since they come back priced inside their parent's answer.
         */
        const detailed = await post(account, `item_id=${items[0].pg_parent_id || items[0].item_id}&start_date=${fromCompact(on)}&qty=1`, left());
        for (const node of [detailed?.item, ...(detailed?.item?.product_group_children ?? [])]) {
          if (found.size >= 8 || Date.now() >= until) break;
          const detail = dayRead(node, on);
          if (!detail) continue;

          /**
           * Prove it is a calendar before believing it.
           *
           * A source that says the same thing whatever date is asked about is publishing opening hours or a
           * fixed schedule, and reporting that as availability is the failure this whole layer exists to
           * avoid. The fortnight above answers it for free wherever the days differ from one another; where
           * they do not, the day a fortnight later is fetched and compared slot for slot, which is the same
           * question a person would ask of a page they did not trust.
           *
           * A failure drops that item and moves to the next rather than condemning the shop, because the two
           * are genuinely different things: Shaod's water tube offers the same six hours every day with all
           * 200 places free, which proves nothing either way, while the jet skis at the same shop have
           * bookings in them and pass immediately.
           */
          if (!proven) {
            const ctrlDate = addDays(fromCompact(on), 14);
            const ctrl = dayRead((await post(account, `item_id=${node.item_id}&start_date=${ctrlDate}&qty=1`, left()))?.item, compact(ctrlDate));
            const key = (slots: Slot[]) => [...new Set(slots.map((x) => x.time))].sort().join(",");
            if (ctrl && key(ctrl.slots) === key(detail.slots)) {
              fixed = true;
              continue;
            }
            proven = true;
          }

          const name = String(node.name ?? "Booking").replace(/\s+/g, " ").trim().slice(0, 80) || "Booking";
          const fromPrice = openFarePrice(detail.fares, (f) => f.price, fareText);
          const unit = detail.priceUnit ? ` ${detail.priceUnit}` : "";
          // A slot that already started today is not availability: Checkfront returns the whole day whatever the hour.
          const nowMin = detail.date === ymd(new Date()) ? new Date().getHours() * 60 + new Date().getMinutes() : -1;
          for (const s of detail.slots) {
            if (Number(s.time.slice(0, 2)) * 60 + Number(s.time.slice(3)) <= nowMin) continue;
            const at = `${detail.date} ${s.time}`;
            const held = found.get(at);
            if (held && (held.fromPrice ?? Infinity) <= (fromPrice ?? Infinity)) continue;
            found.set(at, {
              item: name,
              date: detail.date,
              time: s.time,
              fromPrice,
              priceLabel: fromPrice != null ? `${fareLabel(detail.fares) ?? "on their booking page"}${unit}`.trim() : null,
              /** Checkfront quotes the sub-total; its own checkout adds tax after it, so this is a pre-tax figure. */
              taxIncluded: false,
              rates: detail.fares.map((f) => ({ label: f.label, price: f.price, minParty: f.minParty, maxParty: f.maxParty })),
              bookUrl: `https://${account}.checkfront.com/reserve/`,
              seatsLeft: s.seatsLeft,
            });
          }
        }
      }
    }
  } catch (e) {
    note = (e as Error).message.slice(0, 120);
  }

  // Nothing was believable rather than nothing was there, and those read differently to a guest.
  if (!found.size && fixed && !note) note = "Their page shows the same times whatever date is chosen, so it is not a live calendar.";
  const out = [...found.values()].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 8);
  return {
    business: account,
    vendor: "replay",
    departures: out,
    note: out.length ? null : (note ?? "Nothing bookable on their page for that day."),
  };
}
