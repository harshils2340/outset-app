import type { Listing, UnclaimedOption } from "../data/types";
import { perPerson } from "./catalog";

export type PriceBreakdown = {
  base: number;
  add: number;
  sub: number;
  fee: number;
  rate: number;
  capped: boolean;
  total: number;
};

export const SERVICE_FEE_CAP = 25;

/** Flat take from the operator payout. Guest checkout is a separate stepped fee. */
export const OPERATOR_FEE_RATE = 0.05;

/**
 * What the operator receives for a booking priced at `subtotal` dollars. Mirrors operatorShare in
 * backend/src/payments/money.ts, which is the money Stripe actually moves: the 5% is rounded once, in whole
 * cents, and the operator keeps whatever that leaves.
 *
 * Taking the 5% off in dollars instead rounds the half cent the other way, so the Payouts page promised a cent
 * the transfer never sent on 7,214 of the prices between $1.00 and $2,000.00, $12.50 and $37.50 among them.
 */
export function operatorNet(subtotal: number): number {
  const sub = Math.round(subtotal * 100);
  return (sub - Math.round(sub * OPERATOR_FEE_RATE)) / 100;
}

/** Guest service fee on the operator subtotal. 5% through $100, 4% through $500, 3% above that. Never more than $25. */
export function serviceFeeRate(sub: number): number {
  if (sub <= 0) return 0;
  if (sub <= 100) return 0.05;
  if (sub <= 500) return 0.04;
  return 0.03;
}

export function serviceFee(sub: number): number {
  const raw = Math.round(sub * serviceFeeRate(sub));
  return Math.min(raw, SERVICE_FEE_CAP);
}

/**
 * The operator's own price behind a guest total, which is the inverse of `serviceFee`. The fee is a whole
 * number of dollars and never more than $25, so there are only 26 candidates to try. Mirrors
 * subtotalFromTotal in backend/src/payments/money.ts, which is the number the booking email prints.
 */
export function subtotalFromTotal(total: number): number {
  for (let fee = 0; fee <= SERVICE_FEE_CAP; fee++) {
    const sub = Math.round((total - fee) * 100) / 100;
    if (sub > 0 && serviceFee(sub) === fee) return sub;
  }
  // A total no subtotal produces (an old row, a rounding edge): treat it all as the operator's price.
  return total;
}

export function serviceFeeLabel(p: Pick<PriceBreakdown, "rate" | "capped">): string {
  if (p.capped) return "Service fee";
  if (!p.rate) return "Service fee";
  return "Service fee (" + Math.round(p.rate * 100) + "%)";
}

function breakdown(base: number, add: number): PriceBreakdown {
  const sub = base + add;
  const rate = serviceFeeRate(sub);
  const raw = Math.round(sub * rate);
  const fee = Math.min(raw, SERVICE_FEE_CAP);
  return { base, add, sub, fee, rate, capped: raw > fee, total: sub + fee };
}

export function priceFor(l: Listing, qty: number, addonIds: string[]): PriceBreakdown {
  const base =
    l.unit === "hr" ? l.price * l.minHours * qty : l.unit === "person" ? l.price * qty : l.price;
  const add = (l.addons || [])
    .filter((a) => addonIds.includes(a.id))
    .reduce((n, a) => n + a.price, 0);
  return breakdown(base, add);
}

/**
 * The experience carries no published price on plenty of listings, and that is the honest gap, not a zero.
 * Adding the extras up and calling the sum a total told a guest "Confirm and pay $32" for a trip priced "on
 * request": the server prices from the listing, finds no price for the experience, and stores the booking with
 * none, so nobody was charged the $32 and the operator got a booking that said nothing about money. The extras
 * keep their own lines, because those prices are real; the total does not exist until the trip has one.
 */
/**
 * What one extra adds to the bill. Only a positive price is a price, on the extras as much as on the
 * experience. Mirrors priceBooking in backend/src/payments/money.ts, which is what the guest is actually
 * charged: a zero there means "pay on site", and a negative one, which the dashboard's price box used to
 * accept, came off the bill and could drive a booking's total below zero.
 */
export const addonPrice = (a: { price: number | null }): number => (a.price != null && a.price > 0 ? a.price : 0);

/**
 * Whether there is a price worth showing. A scraped record can carry 0 where the crawler found a currency sign
 * and no number, and "$0" or "From $0" reads as free rather than as unknown, which is a promise we cannot keep.
 * Claimed listings already store null for this; scraped ones still need the guard at the point of display.
 */
export const hasPrice = (p: number | null | undefined): p is number => p != null && p > 0;

export function priceUnclaimed(o: UnclaimedOption | null, qty: number, addons: UnclaimedOption[] = []): PriceBreakdown {
  const add = addons.reduce((n, a) => n + addonPrice(a), 0);
  if (!o || o.price == null || !(o.price > 0)) return { base: 0, add, sub: 0, fee: 0, rate: 0, capped: false, total: 0 };
  const base = perPerson(o) ? o.price * qty : o.price;
  return breakdown(base, add);
}
