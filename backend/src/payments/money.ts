import { regionOfArea } from "../lib/zone.ts";
import { expandAbbreviations } from "../sync/plainServices.ts";

/**
 * The money split for one booking, in cents. Mirrors src/lib/pricing.ts: the guest pays the operator's price
 * plus a stepped service fee, and Outset keeps that fee plus a flat 5% of the operator's price. Stripe's
 * processing cost comes out of Outset's share, never the operator's, so an operator is always paid exactly
 * what the dashboard told them.
 */

export const OPERATOR_FEE_RATE = 0.05;
export const SERVICE_FEE_CAP = 25;

export function serviceFeeRate(sub: number): number {
  if (sub <= 0) return 0;
  if (sub <= 100) return 0.05;
  if (sub <= 500) return 0.04;
  return 0.03;
}

export function serviceFee(sub: number): number {
  return Math.min(Math.round(sub * serviceFeeRate(sub)), SERVICE_FEE_CAP);
}

/**
 * The client sends the guest's total. The operator's price is the one subtotal whose fee adds up to it; the
 * fee is a whole number of dollars from 0 to 25, so there are only 26 candidates to try.
 */
export function subtotalFromTotal(total: number): number {
  for (let fee = 0; fee <= SERVICE_FEE_CAP; fee++) {
    const sub = Math.round((total - fee) * 100) / 100;
    if (sub > 0 && serviceFee(sub) === fee) return sub;
  }
  // A total no subtotal produces (an old client, a rounding edge): treat it all as the operator's price.
  return total;
}

export type Split = {
  currency: string;
  /** What the guest paid. */
  total: number;
  /** The operator's price before any fee. */
  subtotal: number;
  guestFee: number;
  commission: number;
  /** What the operator receives. */
  net: number;
};

const cents = (dollars: number) => Math.round(dollars * 100);

/**
 * Outset's 5% and what is left for the operator, both in whole cents, from the operator's price in whole
 * cents. Every place that tells an operator what they get calls this, so the Stripe transfer, the booking
 * email and the Payouts page name the same cent.
 *
 * The rounding has to happen once, and on the commission. Working the net out in dollars instead
 * (`subtotal * 0.95`, rounded to the cent) rounds a half cent the other way: over every price from $1.00 to
 * $2,000.00 in cent steps the two disagreed 7,214 times, always by a cent, and always with the promise above
 * the transfer. A $12.50 trip was promised $11.88 and sent $11.87; $37.50 promised $35.63 and sent $35.62.
 */
export function operatorShare(subtotalCents: number): { commissionCents: number; operatorNet: number } {
  const commissionCents = Math.round(subtotalCents * OPERATOR_FEE_RATE);
  return { commissionCents, operatorNet: subtotalCents - commissionCents };
}

export function splitBooking(totalDollars: number, currency: string, subtotalDollars?: number): Split {
  const sub = subtotalDollars ?? subtotalFromTotal(totalDollars);
  const total = cents(totalDollars);
  const subtotal = cents(sub);
  const { commissionCents, operatorNet } = operatorShare(subtotal);
  return { currency, total, subtotal, guestFee: total - subtotal, commission: commissionCents, net: operatorNet };
}

const CA_REGIONS = new Set(["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"]);

/**
 * A listing is priced in its own country's dollars: "Tobermory, ON" in CAD, "Tampa, FL" in USD.
 *
 * The province is read the same way the clock reads it. Asking for a comma in front of the code sent every
 * operator whose town was never scraped to the fallback, which is US dollars: 1,030 Canadian shops, whose
 * bookings were charged, emailed and paid out in USD.
 */
export function currencyForArea(area: string | undefined, fallback = "usd"): string {
  const region = regionOfArea(area);
  if (!region) return fallback;
  return CA_REGIONS.has(region) ? "cad" : "usd";
}

/**
 * Which pay cycle a day falls in. Cycles start on Mondays (1970-01-05 was one), so "weekly" pays every Monday
 * and "biweekly" every other Monday; a run on any later day of the same cycle still pays, which covers a server
 * that was asleep on the Monday.
 */
export type Interval = "weekly" | "biweekly";
const FIRST_MONDAY = Date.UTC(1970, 0, 5);
export function cycleOf(now: Date, interval: Interval): number {
  const days = Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - FIRST_MONDAY) / 86400000);
  return Math.floor(days / (interval === "biweekly" ? 14 : 7));
}

/** The Monday a cycle pays on. */
export function cycleStart(cycle: number, interval: Interval): Date {
  return new Date(FIRST_MONDAY + cycle * (interval === "biweekly" ? 14 : 7) * 86400000);
}

/** A booking's money is released the day after the experience happens, so a no-show or a dispute can surface first. */
export function releaseDate(date: string): Date {
  return new Date(Date.parse(date + "T00:00:00Z") + 86400000);
}

/* ---------- the price, worked out on the server ---------- */

export type PricedOption = { name: string; detail?: string; price: number | null; per?: string; perGuest?: boolean };

/** A unit that names a person, so the price is multiplied by the party: "/person", "/adult", "/rider". */
export const PERSON_UNIT = /^(?:person|people|adult|child|children|kid|senior|youth|student|guest|rider|passenger|jumper|seat|head|pax)s?$/;

/**
 * A unit that names the whole booking, one vehicle, one room or a length of time, so the price is charged once
 * however many go: "/group", "/trip", "/boat", "/night", "/hr", "/30 min".
 */
export const FLAT_UNIT =
  /^(?:\d+\s*)?(?:half[\s-])?(?:hr|hrs|hour|hours|min|mins|minute|minutes|day|days|night|nights|week|weeks|month|months|season|boat|vessel|yacht|pontoon|ski|jet ?ski|kart|kayak|canoe|paddleboard|board|bike|vehicle|car|cart|room|cabin|suite|site|lane|table|court|bay|group|party|trip|charter|tour|rental|booking|slot|session|game|round)s?$/;

/** Same rule as perPerson in src/lib/catalog.ts: whether a price is per guest or for the whole booking. */
export function perPerson(o: PricedOption): boolean {
  // The operator's own answer wins. A unit they typed themselves ("per cabin") must never be read as per person
  // by accident, because that multiplies the card by the party size.
  if (typeof o.perGuest === "boolean") return o.perGuest;
  const unit = (o.per || "").toLowerCase().replace(/^\//, "").trim();
  const text = ((o.name || "") + " " + (o.detail || "")).toLowerCase();
  // A stated unit settles it, and it is read before the words, because the words carry the party a service
  // holds as often as the party it is priced for: "Event space for up to 200 guests" at "$18,500 / group" was
  // read as a price per guest, so a party of four was charged $74,000. Only a unit naming a person multiplies.
  if (PERSON_UNIT.test(unit)) return true;
  if (FLAT_UNIT.test(unit)) return false;
  if (/person|adult|child|kid|senior|youth|guest|rider|passenger|jumper|seat/.test(unit + " " + text)) return true;
  if (/\b(rental|per hour|hourly|half day|full day|all day|\d+\s*(hr|hour|hours|min|minutes))\b/.test(text) && /rental|boat|ski|pontoon|kayak|paddle|bike|kart/.test(text + " " + unit)) return false;
  return true;
}

/**
 * What a booking costs, from the listing rather than from the browser. The guest's page sends a total, and a
 * card used to be charged exactly that, so anyone could book a $213 tour for $1 by editing the request. Returns
 * null when the option has no published price, which means no card payment.
 */
export function priceBooking(options: PricedOption[], addons: PricedOption[], service: string, variant: string, qty: number, addonNames: string[], hintTotal?: number | null): { subtotal: number; fee: number; total: number } | null {
  // Labels are cleaned at every sync ("2hr  Tour" becomes "2 hour tour"), and a guest's page can be older than the
  // sync, so compare on letters and digits, then on the expanded form, before giving up on a match.
  const key = (s: string | undefined) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const loose = (s: string | undefined) => key(expandAbbreviations(s || ""));
  const same = (a: string | undefined, b: string | undefined) => key(a) === key(b) || loose(a) === loose(b);
  const inService = options.filter((x) => same(x.name, service));
  const priced = inService.filter((x) => x.price != null && x.price > 0);
  // Two tiers can share a label ("Sunset sail, 2 hours" at $9 for a child and $19 for an adult), and the first
  // match won regardless, so an adult was charged the child's price. When the page sent a total, prefer the tier
  // whose own price adds up to it; the choice is still only ever among the listing's published prices.
  const labelled = inService.filter((x) => same(x.detail, variant));
  // An extra counts only when it carries a real price, the same rule the experience itself is held to below.
  // The dashboard's price box took whatever was typed, so a stray minus on "Beer package" (-20) came off the
  // guest's bill, and enough of them drove the booking negative: subtotal -400, fee -0, and an operator email
  // reading "you receive -$380". Zero and null already meant "no charge"; a negative means the same now.
  const add = addonNames.map((n) => addons.find((a) => key(a.name) === key(n))?.price ?? 0).filter((n) => n > 0).reduce((a, b) => a + b, 0);
  const fits = (x: PricedOption) => {
    if (hintTotal == null || x.price == null) return false;
    const sub = Math.round(((perPerson(x) ? x.price * qty : x.price) + add) * 100) / 100;
    return Math.abs(sub + serviceFee(sub) - hintTotal) < 0.5;
  };
  const o = (labelled.length > 1 ? labelled.find(fits) : undefined) || labelled[0] || (!variant ? inService[0] : undefined) || (priced.length === 1 ? priced[0] : undefined);
  if (!o || o.price == null || !(o.price > 0)) return null;
  const base = perPerson(o) ? o.price * qty : o.price;
  const subtotal = Math.round((base + add) * 100) / 100;
  const fee = serviceFee(subtotal);
  return { subtotal, fee, total: subtotal + fee };
}
