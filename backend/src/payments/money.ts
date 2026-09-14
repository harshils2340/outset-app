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

export function splitBooking(totalDollars: number, currency: string, subtotalDollars?: number): Split {
  const sub = subtotalDollars ?? subtotalFromTotal(totalDollars);
  const total = cents(totalDollars);
  const subtotal = cents(sub);
  const commission = Math.round(subtotal * OPERATOR_FEE_RATE);
  return { currency, total, subtotal, guestFee: total - subtotal, commission, net: subtotal - commission };
}

const CA_REGIONS = new Set(["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"]);

/** A listing is priced in its own country's dollars: "Tobermory, ON" in CAD, "Tampa, FL" in USD. */
export function currencyForArea(area: string | undefined, fallback = "usd"): string {
  const m = (area || "").match(/,\s*([A-Z]{2})\s*$/);
  if (!m) return fallback;
  return CA_REGIONS.has(m[1]) ? "cad" : "usd";
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

export type PricedOption = { name: string; detail?: string; price: number | null; per?: string };

/** Same rule as perPerson in src/lib/catalog.ts: whether a price is per guest or for the whole booking. */
export function perPerson(o: PricedOption): boolean {
  const unit = (o.per || "").toLowerCase();
  const text = ((o.name || "") + " " + (o.detail || "")).toLowerCase();
  if (/person|adult|child|kid|senior|youth|guest|rider|passenger|jumper|seat/.test(unit + " " + text)) return true;
  if (/\/(hr|hour|boat|ski|kart|vehicle|room|lane|group|trip|day|half day|half-day|week|session|game)\b/.test(unit)) return false;
  if (/\b(rental|per hour|hourly|half day|full day|all day|\d+\s*(hr|hour|hours|min|minutes))\b/.test(text) && /rental|boat|ski|pontoon|kayak|paddle|bike|kart/.test(text + " " + unit)) return false;
  return true;
}

/**
 * What a booking costs, from the listing rather than from the browser. The guest's page sends a total, and a
 * card used to be charged exactly that, so anyone could book a $213 tour for $1 by editing the request. Returns
 * null when the option has no published price, which means no card payment.
 */
export function priceBooking(options: PricedOption[], addons: PricedOption[], service: string, variant: string, qty: number, addonNames: string[]): { subtotal: number; fee: number; total: number } | null {
  const key = (s: string | undefined) => (s || "").trim().toLowerCase();
  const o = options.find((x) => key(x.name) === key(service) && key(x.detail) === key(variant)) || options.find((x) => key(x.name) === key(service) && !variant);
  if (!o || o.price == null || !(o.price > 0)) return null;
  const base = perPerson(o) ? o.price * qty : o.price;
  const add = addonNames.map((n) => addons.find((a) => key(a.name) === key(n))?.price ?? 0).reduce((a, b) => a + b, 0);
  const subtotal = Math.round((base + add) * 100) / 100;
  const fee = serviceFee(subtotal);
  return { subtotal, fee, total: subtotal + fee };
}
