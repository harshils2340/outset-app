import type { Booking, ChatMessage } from "../data/types";

const BOOKINGS_KEY = "outset.bookings.v2";
const CHATS_KEY = "outset.chats.v2";

export function loadBookings(): Booking[] {
  try {
    const raw = localStorage.getItem(BOOKINGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Booking[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveBookings(bookings: Booking[]): void {
  try {
    localStorage.setItem(BOOKINGS_KEY, JSON.stringify(bookings));
  } catch {
    /* ignore quota / private mode */
  }
}

export function loadChats(): Record<string, ChatMessage[]> {
  try {
    const raw = localStorage.getItem(CHATS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, ChatMessage[]>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveChats(chats: Record<string, ChatMessage[]>): void {
  try {
    localStorage.setItem(CHATS_KEY, JSON.stringify(chats));
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * A booking's `addons` list holds two different things: the service the guest picked, stored as its index into
 * the listing's own menu, and every extra they added, stored by name. Three screens read it, and the phone
 * confirmation read the whole list as indexes, so a guest who added a $30 dry bag paid for it in the total and
 * saw no dry bag anywhere on the screen that confirmed their booking. One reading, in one place.
 */
export function splitAddons(addons: string[] | undefined): { optionIdx: number | null; extras: string[] } {
  const list = addons || [];
  const idx = list.find((a) => /^\d+$/.test(a));
  return { optionIdx: idx == null ? null : Number(idx), extras: list.filter((a) => !/^\d+$/.test(a)) };
}
