import type { Booking, ChatMessage, ChatRole } from "../data/types";

const BOOKINGS_KEY = "outset.bookings.v2";
const CHATS_KEY = "outset.chats.v2";
const CHAT_ROLES: ChatRole[] = ["me", "them", "sys"];

// A stale booking from an older build, or a hand-edited value, used to reach the trips list and the
// confirmation screen straight from JSON.parse: a qty or total that was not a number, or an addons list
// that was not an array, crashed the first screen that tried to add or map it. Every booking a guest kept
// still loads; only the row that no longer fits the shape is dropped, not the whole list.
function isBooking(v: unknown): v is Booking {
  if (!v || typeof v !== "object") return false;
  const b = v as Record<string, unknown>;
  return (
    typeof b.listing === "string" &&
    typeof b.date === "string" &&
    typeof b.slot === "string" &&
    typeof b.qty === "number" &&
    Number.isFinite(b.qty) &&
    Array.isArray(b.addons) &&
    b.addons.every((a) => typeof a === "string") &&
    typeof b.total === "number" &&
    Number.isFinite(b.total) &&
    typeof b.code === "string" &&
    typeof b.created === "number" &&
    Number.isFinite(b.created)
  );
}

function isChatMessage(v: unknown): v is ChatMessage {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  return CHAT_ROLES.includes(m.who as ChatRole) && typeof m.t === "string" && typeof m.at === "string";
}

export function loadBookings(): Booking[] {
  try {
    const raw = localStorage.getItem(BOOKINGS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isBooking) : [];
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
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, ChatMessage[]> = {};
    for (const [id, thread] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(thread)) out[id] = thread.filter(isChatMessage);
    }
    return out;
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

/** The name, mobile and email the booking form remembers between trips. Empty when nobody has booked here. */
export function loadGuest(): { name?: string; phone?: string; email?: string } {
  try {
    const raw = localStorage.getItem("outset.guest");
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const g = parsed as Record<string, unknown>;
    const out: { name?: string; phone?: string; email?: string } = {};
    if (typeof g.name === "string") out.name = g.name;
    if (typeof g.phone === "string") out.phone = g.phone;
    if (typeof g.email === "string") out.email = g.email;
    return out;
  } catch {
    return {};
  }
}
