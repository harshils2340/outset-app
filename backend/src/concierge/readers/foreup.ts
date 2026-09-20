import type { Departure, LiveRead } from "../live.ts";

/**
 * Live tee times from ForeUp, a golf-only vendor the catalog had never read.
 *
 * Golf is the single biggest bookable category in this catalog — 17,571 operators — and the benchmark run on
 * 20 September 2026 showed it at 0% live coverage, the same as most everything that was not one of the nine
 * vendors already read. ForeUp is common enough among them (22 links surfaced in one 200-link sample of
 * "unknown" booking systems) that it was worth reverse engineering rather than adding to the pile.
 *
 * A booking page (`foreupsoftware.com/index.php/booking/<courseId>`) is server-rendered, not a bare SPA shell:
 * it embeds `API_KEY`, `DEFAULT_FILTER` (the course's own `schedule_id`, default holes) and `SCHEDULES` (every
 * tee sheet the course runs, with its own name and timezone) as plain JS globals in the page source. The
 * actual calendar is one authenticated GET from there:
 *
 *     GET /index.php/api/booking/times?date=MM-DD-YYYY&holes=18&players=4&schedule_id=<id>&api_key=<key>
 *
 * **The `api_key` is not the course's own.** It is the same value —
 * `AIzaSyCoSDhaFJ0ABL9pv_rTx0iH79EBeXLxPKk` — on Beekman Golf Course, Concord Crest Golf Course and Two Rivers
 * Golf Course, three unrelated operators with nothing else in common. It is ForeUp's own public front-end
 * key, shipped to every browser that loads any course's booking page, not a secret scoped to one account. It
 * is still read off each page rather than hard-coded, on the chance a course is served an older or newer
 * build with a different one; hard-coding it would save one fetch and risk a silent wrong answer the day it
 * rotates.
 *
 * No browser, no auth beyond that key, plain `fetch` — ForeUp runs no fingerprint gate like Rezdy's Cloudflare
 * does, confirmed against all three courses above from this address.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/**
 * `LiveRead["vendor"]` does not yet carry `"foreup"`. Asserted here rather than borrowing a neighbour's name,
 * the same convention `rezdy.ts` and `bookeo.ts` use, so a caller sees the right value before `live.ts`'s
 * union is widened.
 */
const VENDOR = "foreup" as LiveRead["vendor"];

export type ForeUpRef = {
  courseId: string;
  /** Named in the URL, when the link points at one tee sheet rather than the course's default. */
  scheduleId: string | null;
};

/**
 * The course, and the tee sheet if the link names one, out of any ForeUp URL we hold.
 *
 * Three shapes are in the catalog: `/booking/21688#/teetimes` (course only, its default schedule decides
 * which sheet), `/booking/22404/10696#teetimes` (course and schedule), and the same with no hash at all.
 */
export function foreupRef(url: string): ForeUpRef | null {
  const m = url.match(/foreupsoftware\.com\/index\.php\/booking\/(\d+)(?:\/(\d+))?/i);
  if (!m) return null;
  return { courseId: m[1], scheduleId: m[2] ?? null };
}

async function fetchText(url: string, timeoutMs: number): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

type CourseInfo = {
  apiKey: string;
  scheduleId: string;
  holes: number;
  courseName: string | null;
  timezone: string | null;
};

/**
 * The three globals a booking page embeds, read as plain text rather than executed. `DEFAULT_FILTER` is a
 * small, flat JSON object and parses as one; `SCHEDULES` is an array of objects that can nest further (course
 * add-ons, fee lists) so rather than parse the whole thing, the one entry for the schedule we are about to
 * ask is found by its `teesheet_id` and read out of a window around that match — the same targeted-regex
 * approach `rezdy.ts`'s `shopOf` uses on Rezdy's own bootstrap JSON, for the same reason: a full parse breaks
 * the day the vendor adds a field this file never looked at, and a window around one substring does not.
 */
function courseInfo(html: string, wantedScheduleId: string | null): CourseInfo | null {
  const apiKey = html.match(/API_KEY\s*=\s*"([^"]+)"/)?.[1] ?? null;
  if (!apiKey) return null;

  const filterRaw = html.match(/DEFAULT_FILTER\s*=\s*(\{[^;]*?\});/)?.[1] ?? null;
  let defaultScheduleId: string | null = null;
  let defaultHoles = 18;
  if (filterRaw) {
    try {
      const f = JSON.parse(filterRaw) as { schedule_id?: number | string; holes?: number };
      if (f.schedule_id != null) defaultScheduleId = String(f.schedule_id);
      if (typeof f.holes === "number" && f.holes > 0) defaultHoles = f.holes;
    } catch {
      /* fall through with nulls; the schedule id from the URL, if any, still carries us */
    }
  }
  const scheduleId = wantedScheduleId ?? defaultScheduleId;
  if (!scheduleId) return null;

  const at = html.indexOf(`"teesheet_id":"${scheduleId}"`);
  const nearby = at >= 0 ? html.slice(Math.max(0, at - 500), at + 200) : html;
  const courseName = nearby.match(/"course_name"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1]?.replace(/\\\//g, "/") ?? null;
  const timezone = nearby.match(/"course_timezone"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1]?.replace(/\\\//g, "/") ?? null;
  const holesHere = Number(nearby.match(/"holes"\s*:\s*"?(\d+)"?/)?.[1]) || defaultHoles;

  return { apiKey, scheduleId, holes: holesHere, courseName, timezone };
}

/** Local dates, never UTC: `toISOString()` runs hours ahead of any US or Canadian course's own clock. */
const mdy = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-${d.getFullYear()}`;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function nowWhereTheyAre(timezone: string | null): { date: string; minutes: number } {
  const d = new Date();
  if (timezone) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
      }).formatToParts(d);
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
      const [y, mo, da, h, mi] = [get("year"), get("month"), get("day"), get("hour"), get("minute")];
      if (y && mo && da && h && mi) return { date: `${y}-${mo}-${da}`, minutes: (Number(h) % 24) * 60 + Number(mi) };
    } catch {
      /* an unrecognised zone is not worth failing a read over */
    }
  }
  return { date: ymd(d), minutes: d.getHours() * 60 + d.getMinutes() };
}

type ForeUpSlot = {
  time: string; // "2026-09-21 16:40"
  available_spots?: number | null;
  available_spots_9?: number | null;
  available_spots_18?: number | null;
  maximum_players_per_booking?: number | null;
  holes?: number;
  green_fee?: number | null;
  cart_fee?: number | null;
  rate_type?: string | null;
  message?: string | null;
};

export async function foreupLive(
  bookingUrl: string,
  opts: { from?: Date; days?: number; maxItems?: number } = {},
): Promise<LiveRead | null> {
  const ref = foreupRef(bookingUrl);
  if (!ref) return null;

  const pageUrl = `https://foreupsoftware.com/index.php/booking/${ref.courseId}${ref.scheduleId ? "/" + ref.scheduleId : ""}`;
  const html = await fetchText(pageUrl, 8000);
  if (!html) return { business: "this course", vendor: VENDOR, departures: [], note: "ForeUp did not answer for this course." };

  const info = courseInfo(html, ref.scheduleId);
  if (!info) return { business: "this course", vendor: VENDOR, departures: [], note: "ForeUp served the page but not a tee sheet we recognised." };

  const name = info.courseName || "this course";
  const start = opts.from ?? new Date();
  const horizonDays = Math.min(opts.days ?? 7, 5); // one request per day tried; five is plenty for "the next day or two with something free"
  const maxItems = opts.maxItems ?? horizonDays;
  const today = nowWhereTheyAre(info.timezone);
  const holes = info.holes;
  /**
   * A foursome, the shape a tee time is actually booked in most often, and wide enough that `available_spots`
   * (which ForeUp already narrows to what this exact party size could take) reads true for a solo golfer too:
   * a 4-spot time is bookable by one just as much as by four.
   */
  const players = 4;

  const out: Departure[] = [];
  for (let i = 0; i < maxItems; i++) {
    const day = new Date(start.getTime() + i * 86400_000);
    const dateParam = mdy(day);
    const url =
      `https://foreupsoftware.com/index.php/api/booking/times?time=all&date=${dateParam}&holes=${holes}` +
      `&players=${players}&schedule_id=${info.scheduleId}&schedule_ids%5B%5D=${info.scheduleId}&api_key=${encodeURIComponent(info.apiKey)}`;
    const body = await fetchText(url, 8000);
    if (!body || !/^\s*\[/.test(body)) continue;
    let slots: ForeUpSlot[];
    try {
      slots = JSON.parse(body) as ForeUpSlot[];
    } catch {
      continue;
    }
    if (!Array.isArray(slots) || !slots.length) continue;

    const date = ymd(day);
    for (const s of slots) {
      const time = (s.time || "").slice(11, 16);
      if (!/^\d{2}:\d{2}$/.test(time)) continue;
      if (date === today.date && Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) <= today.minutes) continue;

      const spots = holes >= 18 ? s.available_spots_18 : s.available_spots_9;
      const seats = typeof spots === "number" ? spots : typeof s.available_spots === "number" ? s.available_spots : null;
      if (seats != null && seats <= 0) continue;

      const green = typeof s.green_fee === "number" ? s.green_fee : null;
      if (green == null) continue; // no price published for this slot is not a slot a guest can be told to trust
      /**
       * Cart fee is added to the headline only when the shop's own `rate_type` says riding is not optional.
       * "walking" courses show a cart fee too, for whoever wants one, and adding it to a price nobody is
       * required to pay would over-quote every walker.
       */
      const cart = s.rate_type === "riding" && typeof s.cart_fee === "number" ? s.cart_fee : 0;
      const total = Math.round((green + cart) * 100) / 100;

      out.push({
        item: `${name} · ${holes} holes`,
        date,
        time,
        fromPrice: total,
        priceLabel: cart ? "green fee + cart" : "green fee",
        // ForeUp's own checkout adds applicable tax on top of the green fee, per the tax-rate fields it
        // publishes alongside every slot; nothing here claims this figure already includes it.
        taxIncluded: false,
        rates: [{ label: cart ? "Green fee + cart" : "Green fee", price: total, minParty: 1, maxParty: s.maximum_players_per_booking ?? players }],
        bookUrl: pageUrl,
        seatsLeft: seats,
      });
    }
    // The first day with something bookable is enough — a guest is choosing between courses, not between dates.
    if (out.length) break;
  }

  return {
    business: name,
    vendor: VENDOR,
    departures: out.sort((a, b) => a.time.localeCompare(b.time)).slice(0, 8),
    note: out.length ? null : `Nothing bookable online in the next ${horizonDays} days.`,
  };
}
