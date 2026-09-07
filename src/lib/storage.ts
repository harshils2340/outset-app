import type { Booking, ChatMessage } from "../data/types";
import { SEED_CHATS } from "../data/seedChats";

const BOOKINGS_KEY = "outset.bookings";
const CHATS_KEY = "outset.chats";

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
    if (!raw) return structuredClone(SEED_CHATS);
    const parsed = JSON.parse(raw) as Record<string, ChatMessage[]>;
    return parsed && typeof parsed === "object" ? parsed : structuredClone(SEED_CHATS);
  } catch {
    return structuredClone(SEED_CHATS);
  }
}

export function saveChats(chats: Record<string, ChatMessage[]>): void {
  try {
    localStorage.setItem(CHATS_KEY, JSON.stringify(chats));
  } catch {
    /* ignore quota / private mode */
  }
}
