import type { Booking, Listing } from "../data/types";
import { SLOT_TIMES } from "../data/slots";

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** Baseline inventory a slot ships with, before real bookings land on it. */
export function capacity(l: Listing, dateKey: string, time: string): number {
  const r = hash(l.id + dateKey + time);
  const d = new Date(dateKey + "T00:00:00");
  const weekend = d.getDay() === 0 || d.getDay() === 6;
  const base = l.qtyMax;
  let open = Math.round(base * (weekend ? 0.18 + r * 0.55 : 0.42 + r * 0.58));
  if (r < (weekend ? 0.22 : 0.1)) open = 0;
  return Math.max(0, Math.min(base, open));
}

export function bookedQty(bookings: Booking[], listingId: string, dateKey: string, time: string): number {
  return bookings
    .filter((b) => b.listing === listingId && b.date === dateKey && b.slot === time)
    .reduce((n, b) => n + (b.qty || 1), 0);
}

export function openSeats(
  l: Listing,
  dateKey: string,
  time: string,
  bookings: Booking[],
): number {
  return Math.max(0, capacity(l, dateKey, time) - bookedQty(bookings, l.id, dateKey, time));
}

export function daySlotsOpen(l: Listing, dateKey: string, bookings: Booking[]): number {
  return SLOT_TIMES.filter((t) => openSeats(l, dateKey, t, bookings) > 0).length;
}

export function dayOpen(l: Listing, dateKey: string, bookings: Booking[]): number {
  return SLOT_TIMES.reduce((n, t) => n + openSeats(l, dateKey, t, bookings), 0);
}
