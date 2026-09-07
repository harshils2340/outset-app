import type { Listing, UnclaimedOption } from "../data/types";
import { perPerson } from "./catalog";

export type PriceBreakdown = {
  base: number;
  add: number;
  sub: number;
  fee: number;
  total: number;
};

export function priceFor(l: Listing, qty: number, addonIds: string[]): PriceBreakdown {
  const base =
    l.unit === "hr" ? l.price * l.minHours * qty : l.unit === "person" ? l.price * qty : l.price;
  const add = (l.addons || [])
    .filter((a) => addonIds.includes(a.id))
    .reduce((n, a) => n + a.price, 0);
  const sub = base + add;
  const fee = Math.round(sub * 0.08);
  return { base, add, sub, fee, total: sub + fee };
}

export function priceUnclaimed(o: UnclaimedOption | null, qty: number): PriceBreakdown {
  if (!o || o.price == null) {
    return { base: 0, add: 0, sub: 0, fee: 0, total: 0 };
  }
  const base = perPerson(o) ? o.price * qty : o.price;
  const fee = Math.round(base * 0.08);
  return { base, add: 0, sub: base, fee, total: base + fee };
}
