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

export function priceUnclaimed(o: UnclaimedOption | null, qty: number, addons: UnclaimedOption[] = []): PriceBreakdown {
  const add = addons.reduce((n, a) => n + (a.price ?? 0), 0);
  if (!o || o.price == null) return breakdown(0, add);
  const base = perPerson(o) ? o.price * qty : o.price;
  return breakdown(base, add);
}
