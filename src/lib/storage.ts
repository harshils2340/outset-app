import type { Booking, ChatMessage, ChatRole, UnclaimedOption } from "../data/types";

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
      if (!Array.isArray(thread)) continue;
      const msgs = thread.filter(isChatMessage);
      // A thread with nothing readable left in it is not a thread. The shape guard above drops a message an
      // older build or a hand-edited value wrote differently, exactly as isBooking drops a row, and keeping
      // the id behind it left a conversation with no messages: the Inbox tab reads the last one to draw its
      // preview line and its time, so the Messages tab threw on render, and with no error boundary in this
      // app that is the whole screen gone white, on every visit until the key is cleared. The tab bar's badge
      // counted it too, so the tab offered a conversation that could not be opened.
      if (msgs.length) out[id] = msgs;
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

/* ---------- a second tab of the same browser ---------- */

/*
 * Both stores above are written whole: the app holds the list in React state, reads it once on the first
 * paint, and writes all of it back on every change. That is fine for one tab and loses a booking with two.
 * A guest comparing two listings in two tabs, which is what "open in new tab" is for, books in the second
 * and then books in the first: the first tab writes the list it hydrated with, which has no row for the
 * booking the second tab just took, so that trip leaves the device. Its Trips card, its Inbox thread and the
 * operator feed, which reads the guest bookings in this same browser, all go with it. The money is in
 * Postgres and the confirmation email was sent, so the guest is holding a code for a trip the app says they
 * never booked.
 *
 * The operator dashboard already answers this (see `OperatorView`): the `storage` event says another tab
 * wrote the key, and the tab that hears it takes that copy. The guest side has the easier job of the two,
 * because nothing here ever removes a booking: `state.bookings` is prepended to and updated in place, never
 * shortened. So the merge is a union and cannot lose a row either way.
 */

/*
 * A merge that changed nothing hands back the list it was given, identity and all.
 *
 * This is what stops two tabs bouncing. A `storage` event reaches every tab but the one that wrote, so a tab
 * that merges and then saves sends the event straight back; with a fresh array every time, each tab would
 * answer the other's write with one of its own, for ever. The lists here are a guest's own trips and threads,
 * so a stringify is cheaper than the render it prevents.
 */
function same<T>(merged: T, mine: T): T {
  return JSON.stringify(merged) === JSON.stringify(mine) ? mine : merged;
}

/**
 * Our bookings and the ones another tab just wrote, as one list, newest first.
 *
 * A code only one side holds is kept. A code both hold is taken from `theirs`, which is the newer write: the
 * other tab may have been the one that came back from Stripe and marked it paid.
 */
export function mergeBookings(mine: Booking[], theirs: Booking[]): Booking[] {
  const by = new Map<string, Booking>();
  for (const b of mine) by.set(b.code, b);
  for (const b of theirs) by.set(b.code, b);
  return same([...by.values()].sort((a, b) => b.created - a.created), mine);
}

/**
 * Our threads and another tab's, as one set.
 *
 * A shop only one side has talked to keeps its thread. A shop both sides hold keeps the longer thread, since
 * a thread is appended to and the longer one is the one with the later messages in it. Two tabs chatting to
 * the same shop at the same moment is the one case this does not resolve, and the alternative, splicing two
 * divergent message lists, cannot tell an appended message from the one `chatSettled` replaced in place.
 */
export function mergeChats(
  mine: Record<string, ChatMessage[]>,
  theirs: Record<string, ChatMessage[]>,
): Record<string, ChatMessage[]> {
  const out: Record<string, ChatMessage[]> = { ...mine };
  for (const [id, thread] of Object.entries(theirs)) {
    const here = out[id];
    if (!here || thread.length > here.length) out[id] = thread;
  }
  return same(out, mine);
}

/** The keys the two stores above live under, for a tab deciding whether a `storage` event is one of theirs. */
export const DEVICE_KEYS = { bookings: BOOKINGS_KEY, chats: CHATS_KEY } as const;

/**
 * A booking's `addons` list holds two different things: the service the guest picked, stored as its index into
 * the listing's own menu, and every extra they added, stored by name. Three screens read it, and the phone
 * confirmation read the whole list as indexes, so a guest who added a $30 dry bag paid for it in the total and
 * saw no dry bag anywhere on the screen that confirmed their booking. One reading, in one place.
 */
export function splitAddons(addons: string[] | undefined, addonNames: readonly string[] = []): { optionIdx: number | null; extras: string[] } {
  const list = addons || [];
  // Telling the two apart was "all digits is the index", and the two halves of that were both wrong for an
  // add-on an operator names in digits alone. Their own Services editor takes whatever they type, and no
  // shipped listing writes such a name (measured over all 52,815 detail files), so this is theirs to trigger:
  // name an extra "2" and it was read as a menu index and dropped from the list of extras, which is the same
  // $30-dry-bag bug as above, one row along. A name the listing publishes as an add-on is that add-on, and
  // only the one entry actually read as the index leaves `extras`, not every entry that looks like one.
  const known = new Set(addonNames.map((n) => n.trim()).filter(Boolean));
  const at = list.findIndex((a) => /^\d+$/.test(a) && !known.has(a.trim()));
  return { optionIdx: at < 0 ? null : Number(list[at]), extras: list.filter((_, i) => i !== at) };
}

/**
 * The menu row a booking is actually for.
 *
 * The index in `addons` points into the listing's live menu, and that menu moves. `toCatalog` in
 * `operator.ts` rebuilds `options` from the operator's services every time they save, so reordering a
 * service, hiding one, deleting one or adding a price tier shifts the index of every row after it. The
 * dashboard was fixed for exactly this and then wrote what was booked into the booking itself: `service`,
 * `variant`, `price` and `per`, as they read at confirm time.
 *
 * Both confirmation screens kept reading the index first, so the guest's own copy was the one that went
 * wrong. An operator who dragged their second service to the top relabelled a booking already made: the
 * desktop confirmation's "Booking" row and the phone ticket's "Service" row named the other service, and the
 * price lines were recomputed from it. Deleting a service was worse, because the index then pointed past the
 * end and the row vanished, so a guest reopening their trip was shown a confirmation that no longer said what
 * they had booked.
 *
 * What the booking wrote down wins, which is what `guestBookingsFor` already does for the operator's feed.
 * The index stays as the fallback for bookings made before those fields existed.
 */
export function bookedRow(
  b: Pick<Booking, "service" | "variant" | "price" | "per" | "addons">,
  options: UnclaimedOption[] | undefined,
): UnclaimedOption | null {
  if (b.service != null) return { name: b.service, detail: b.variant || "", price: b.price ?? null, ...(b.per ? { per: b.per } : {}) };
  const { optionIdx } = splitAddons(b.addons);
  return (optionIdx == null ? null : (options || [])[optionIdx]) || null;
}

/**
 * Whether this booking was confirmed on the spot.
 *
 * The same fault `bookedRow` closes, on the other half of the ticket. Both confirmation screens asked the live
 * catalog record whether the shop was on Instant Book, and the operator's dashboard can turn that switch off,
 * pause new bookings or hide the listing at any time afterwards. So a guest reopening a trip was told "Request
 * sent" for a booking the shop had confirmed on the spot, and, where they had paid by card, that their money
 * was only "Held on your card" and would be "Charged only when they confirm" for a card already charged.
 *
 * What the booking wrote down wins. The live switch stays as the fallback for bookings older than the field
 * and for the ones read back from the API, which is what both screens did for all of them before.
 */
export function bookedInstant(b: Pick<Booking, "instant">, item: { claimed?: boolean; instant?: boolean } | null | undefined): boolean {
  return b.instant ?? !!(item?.claimed && item?.instant);
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
