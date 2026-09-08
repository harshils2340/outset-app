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

export function priceUnclaimed(o: UnclaimedOption | null, qty: number, addons: UnclaimedOption[] = []): PriceBreakdown {
  const add = addons.reduce((n, a) => n + (a.price ?? 0), 0);
  if (!o || o.price == null) {
    return { base: 0, add, sub: add, fee: Math.round(add * 0.08), total: add + Math.round(add * 0.08) };
  }
  const base = perPerson(o) ? o.price * qty : o.price;
  const sub = base + add;
  const fee = Math.round(sub * 0.08);
  return { base, add, sub, fee, total: sub + fee };
}
