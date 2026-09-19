import { useSyncExternalStore } from "react";

import { freeCancelBadge } from "../../lib/cancellation";

/**
 * Phone-only guest preferences that the app state does not carry: the wishlist, which page the Explore tab shows,
 * the day and party size picked in the search sheet, and the feed filters. Kept here rather than in AppProvider so
 * the phone can offer Airbnb's search and wishlist shape without changing the shared reducer. The wishlist and the
 * search picks survive a reload; filters are per visit.
 */
export type FeedFilters = { fav: boolean; cancel: boolean; deal: boolean; priced: boolean };

export type Prefs = {
  saved: string[];
  view: "feed" | "wishlists";
  /** Day picked in When, as a date key ("2026-09-18"), or null for "Any week". */
  when: string | null;
  /** People in the party, or null for "Add guests". */
  who: number | null;
  filters: FeedFilters;
  /** Which body the search sheet opens with: the stacked Where / When / Who cards, or the filters. */
  sheetMode: "search" | "filters";
};

const NO_FILTERS: FeedFilters = { fav: false, cancel: false, deal: false, priced: false };
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

// A stale or hand-edited value here used to reach `.includes`/`.filter` on `saved` straight from
// `JSON.parse`, so a value that was not an array of ids took the whole Explore tab down.
function readSaved(): string[] {
  try {
    const raw = localStorage.getItem("outset.saved");
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function readWhen(): string | null {
  try {
    const raw = localStorage.getItem("outset.when");
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return typeof parsed === "string" && DATE_KEY.test(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readWho(): number | null {
  try {
    const raw = localStorage.getItem("outset.who");
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
  } catch {
    return null;
  }
}

let prefs: Prefs = {
  saved: readSaved(),
  view: "feed",
  when: readWhen(),
  who: readWho(),
  filters: NO_FILTERS,
  sheetMode: "search",
};

const subs = new Set<() => void>();

export function setPrefs(patch: Partial<Prefs>): void {
  prefs = { ...prefs, ...patch };
  try {
    if ("saved" in patch) localStorage.setItem("outset.saved", JSON.stringify(prefs.saved));
    if ("when" in patch) localStorage.setItem("outset.when", JSON.stringify(prefs.when));
    if ("who" in patch) localStorage.setItem("outset.who", JSON.stringify(prefs.who));
  } catch {
    /* private mode */
  }
  subs.forEach((f) => f());
}

export function getPrefs(): Prefs {
  return prefs;
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => prefs,
    () => prefs,
  );
}

export function toggleSaved(id: string): void {
  setPrefs({ saved: prefs.saved.includes(id) ? prefs.saved.filter((x) => x !== id) : [id, ...prefs.saved] });
}

export function clearFilters(): void {
  setPrefs({ filters: NO_FILTERS });
}

/**
 * The party a booking box opens on: the one the guest picked in Who, never above the ceiling the service
 * states, and two when they picked nobody. Both booking boxes read it, because the phone sheet carried the
 * pick and the desktop page did not, so a guest who said six on the home page was asked for two again.
 */
export function startingParty(cap: number): number {
  return Math.max(1, Math.min(cap, prefs.who || 2));
}

export function activeFilterCount(f: FeedFilters): number {
  return Object.values(f).filter(Boolean).length;
}

/** The feed filters, all read from facts the operator published. Cheap enough to run over the whole catalog. */
export function passesFilters(
  u: { rating?: number; reviews?: number; fc?: string; cancellation?: string },
  f: FeedFilters,
  extra: { priced: () => boolean; deal: () => boolean },
): boolean {
  if (f.fav && !((u.rating ?? 0) >= 4.8 && (u.reviews ?? 0) >= 100)) return false;
  // The badge the cards and the listing page draw, so the filter cannot let in a shop whose policy only
  // refunds a trip the shop itself calls off.
  if (f.cancel && !freeCancelBadge(u)) return false;
  if (f.priced && !extra.priced()) return false;
  if (f.deal && !extra.deal()) return false;
  return true;
}
