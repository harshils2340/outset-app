import { db } from "../db/client.ts";
import type { Departure, LiveRead } from "./live.ts";
import { isConcessionFare } from "../lib/fares.ts";

/**
 * Reading a shop's own booking system from an endpoint we discovered once.
 *
 * `sniff.ts` opens a booking page in a browser, watches what the widget asks for, and writes the winning
 * request down. That is the expensive half and it happens once per shop, on the worker. This is the cheap
 * half: take the stored request, point it at the day a guest is asking about, and read the answer. No
 * browser, no vendor-specific code, nothing that had to be written for this particular shop.
 *
 * It exists because the funnel says so. Of 423,161 operators, 8,370 have a booking link and 1,453 of those
 * run a vendor we have a reader for. Writing a reader per vendor moves that number a few hundred at a time
 * and never reaches the 82% who run something of their own. A generic replay reaches all of them or none.
 *
 * ## What it will and will not claim
 *
 * Every one of these payloads has a different shape, so a parser that insists on understanding them would
 * work for almost none. This one reads what is unambiguous and refuses the rest:
 *
 * - **Times** are read confidently. A list of clock values inside trading hours, on neat minutes, in a
 *   response fetched for a particular date, is a calendar. Very little else looks like that.
 * - **Prices** are only attached to a time when the payload puts them in the same object. A price found
 *   loose in the document is reported as a range for the shop, never as the price of a slot, because
 *   "7:00 PM, $24" when the $24 belonged to a different room is the exact failure that makes a guest stop
 *   believing the screen.
 *
 * A departure with no price is honest. A departure with someone else's price is not.
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

export type StoredEndpoint = {
  operatorId: string;
  pageUrl: string;
  endpoint: string;
  method: string;
  postBody: string | null;
  contentType: string | null;
  score: number;
};

/** The endpoint we discovered for this shop, if we ever did. */
export function endpointFor(domain: string): StoredEndpoint | null {
  const row = db
    .prepare(
      `SELECT b.operator_id AS operatorId, b.page_url AS pageUrl, b.endpoint, b.method,
              b.post_body AS postBody, b.content_type AS contentType, b.score
         FROM booking_endpoints b JOIN operators o ON o.id = b.operator_id
        WHERE o.domain = ? ORDER BY b.score DESC LIMIT 1`,
    )
    .get(domain) as StoredEndpoint | undefined;
  return row ?? null;
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Point a recorded request at a different day.
 *
 * The sniff captured whatever date the widget happened to open on, which is the day it was discovered and is
 * now in the past. Any query parameter that looked like a date is rewritten; so is an ISO date sitting in a
 * POST body. A request with no date in it at all is sent unchanged, because plenty of these endpoints return
 * a whole month and do their own filtering.
 */
export function forDate(ep: StoredEndpoint, day: Date): { url: string; body: string | null } {
  const iso = ymd(day);
  let url = ep.endpoint;
  try {
    const u = new URL(ep.endpoint);
    for (const [k, v] of [...u.searchParams]) {
      if (/^\d{4}-\d{2}-\d{2}/.test(v)) u.searchParams.set(k, iso);
      else if (/^\d{4}\/\d{2}\/\d{2}/.test(v)) u.searchParams.set(k, iso.replace(/-/g, "/"));
      else if (/^(date|day|start|from|on|selected)/i.test(k) && /^\d{2}\/\d{2}\/\d{4}$/.test(v)) {
        u.searchParams.set(k, `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`);
      }
    }
    url = u.toString();
  } catch {
    /* an endpoint that will not parse is sent as it was recorded */
  }
  const body = ep.postBody ? ep.postBody.replace(/\d{4}-\d{2}-\d{2}/g, iso) : null;
  return { url, body };
}

/** A clock value that looks like a slot a shop would sell, rather than a timestamp in a payload. */
function slotTime(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m24 = raw.match(/^(?:.*?T)?([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?/);
  const ap = raw.match(/^\s*(1[0-2]|0?[1-9]):([0-5]\d)\s*([ap])\.?m\.?\s*$/i);
  let h: number, mi: number;
  if (ap) {
    h = Number(ap[1]);
    mi = Number(ap[2]);
    if (/p/i.test(ap[3]) && h < 12) h += 12;
    if (/a/i.test(ap[3]) && h === 12) h = 0;
  } else if (m24) {
    h = Number(m24[1]);
    mi = Number(m24[2]);
  } else return null;
  // Trading hours, on a neat five minutes. A "created_at" almost never satisfies both.
  if (h < 7 || h > 23 || mi % 5 !== 0) return null;
  return String(h).padStart(2, "0") + ":" + String(mi).padStart(2, "0");
}

const money = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.replace(/[^\d.]/g, "")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n >= 5 && n <= 2000 ? n : null;
};

const TIME_KEY = /^(time|start|start_time|starttime|startsAt|start_at|slot|when|hour|departure)/i;
const PRICE_KEY = /(price|cost|rate|amount|fare|total)/i;
const LABEL_KEY = /^(name|title|label|item|room|product|description|type)$/i;
const SOLD_OUT = /(sold_?out|unavailable|is_?full|no_?availability)/i;

type Found = { time: string; price: number | null; label: string | null };

/**
 * Walk the answer looking for objects that carry a time.
 *
 * The unit of truth is an object with a clock value in it. Whatever price and name sit in that same object
 * belong to that slot; anything further away does not, and is not borrowed. Availability flags are honoured
 * when the payload states them, because a sold-out slot offered as free is worse than no answer.
 */
function harvest(node: unknown, out: Found[], depth = 0): void {
  if (out.length >= 60 || depth > 8 || node == null) return;
  if (Array.isArray(node)) {
    for (const v of node) harvest(v, out, depth + 1);
    return;
  }
  if (typeof node !== "object") return;
  const obj = node as Record<string, unknown>;

  let time: string | null = null;
  for (const [k, v] of Object.entries(obj)) {
    if (TIME_KEY.test(k)) {
      const t = slotTime(v);
      if (t) { time = t; break; }
    }
  }

  if (time) {
    // Explicitly unavailable is an answer; do not offer it.
    let free = true;
    for (const [k, v] of Object.entries(obj)) {
      if (SOLD_OUT.test(k) && (v === true || v === 1)) free = false;
      if (/^(available|is_available|bookable)$/i.test(k) && (v === false || v === 0)) free = false;
    }
    if (free) {
      let price: number | null = null;
      let label: string | null = null;
      for (const [k, v] of Object.entries(obj)) {
        if (price == null && PRICE_KEY.test(k) && !isConcessionFare(k)) price = money(v);
        if (label == null && LABEL_KEY.test(k) && typeof v === "string" && v.length > 1 && v.length < 70) label = v;
      }
      out.push({ time, price, label });
    }
  }

  for (const v of Object.values(obj)) harvest(v, out, depth + 1);
}

async function read(url: string, method: string, body: string | null, contentType: string | null): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      method,
      headers: {
        "user-agent": UA,
        accept: "application/json, text/plain, */*",
        ...(body ? { "content-type": contentType?.includes("json") ? "application/json" : "application/x-www-form-urlencoded" } : {}),
      },
      body: body ?? undefined,
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!/^\s*[[{]/.test(text)) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Live availability for a shop whose booking system nobody wrote a reader for.
 *
 * Returns null when there is no stored endpoint, so the caller falls through to whatever it did before. A
 * shop with an endpoint that answers nothing useful gets an empty read with a note, which is a real answer:
 * "they publish nothing for that day" is information, and inventing a time is not.
 */
export async function replayLive(
  domain: string,
  opts: { from?: Date; days?: number } = {},
): Promise<LiveRead | null> {
  const ep = endpointFor(domain);
  if (!ep) return null;

  const start = opts.from ?? new Date();
  // Two days, not a fortnight: each is a request, and a guest asking about tonight does not need next week.
  const horizon = Math.min(opts.days ?? 2, 4);
  const out: Departure[] = [];

  for (let i = 0; i <= horizon && out.length < 8; i += 1) {
    const day = new Date(start.getTime() + i * 86400_000);
    const { url, body } = forDate(ep, day);
    const payload = await read(url, ep.method, body, ep.contentType);
    if (!payload) continue;

    const found: Found[] = [];
    harvest(payload, found);
    if (!found.length) continue;

    /**
     * One departure per distinct time. These payloads repeat a slot once per bookable variant — Peek returns
     * a row per duration, so one 11:00 came back four times at $49, $98, $147 and $196 — and four identical
     * cards with different prices is not a choice a guest can make. The cheapest variant of a time is the one
     * to show, which is the same rule the rest of the reader follows.
     */
    const byTime = new Map<string, Found>();
    for (const f of found) {
      const seen = byTime.get(f.time);
      if (!seen || (f.price != null && (seen.price == null || f.price < seen.price))) byTime.set(f.time, f);
    }

    const date = ymd(day);
    // Today's slots that have already started are not availability.
    const nowMin = date === ymd(new Date()) ? new Date().getHours() * 60 + new Date().getMinutes() : -1;
    for (const f of [...byTime.values()].sort((a, b) => a.time.localeCompare(b.time))) {
      const mins = Number(f.time.slice(0, 2)) * 60 + Number(f.time.slice(3));
      if (mins <= nowMin) continue;
      out.push({
        item: f.label || "Booking",
        date,
        time: f.time,
        fromPrice: f.price,
        priceLabel: f.price != null ? "from their booking page" : null,
        /** Unknown, so assumed excluded: under-quoting a guest is the failure that matters. */
        taxIncluded: false,
        rates: f.price != null ? [{ label: f.label || "Ticket", price: f.price, minParty: null, maxParty: null }] : [],
        bookUrl: ep.pageUrl,
        seatsLeft: null,
      });
      if (out.length >= 8) break;
    }
  }

  return {
    business: domain,
    vendor: "replay",
    departures: out,
    note: out.length ? null : "Their booking page answered, but published no times for those days.",
  };
}
