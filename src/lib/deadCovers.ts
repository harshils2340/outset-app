import { useSyncExternalStore } from "react";

/**
 * Listings whose cover photo will not load, shared by every surface that shows a grid of them.
 *
 * Browse promises a real photograph. `explore/feed.ts` keeps a listing out of the grid unless it has a cover,
 * because a wall of scene illustrations reads as a broken page however good the businesses behind it are. But
 * a cover is a URL on the operator's own web server, and roughly one in twelve no longer answers: measured on
 * 20 September 2026, 3 of a 40 cover sample 404'd through the same wsrv.nl proxy the app draws them with.
 *
 * `Photo` draws its generated illustration when an image fails, which is right on a listing page and exactly
 * wrong in browse: it is the thing the cover filter exists to prevent, and it happened silently, so a rail of
 * five showed a cartoon pontoon beside four photographs and nothing said the catalog was wrong.
 *
 * So a card whose cover fails reports it here and every list drops that listing. The listing itself is not
 * punished: its own page still opens, its gallery still holds whatever the crawl found, and a search by name
 * still finds it. What it loses is the right to stand in a photo grid with no photo.
 *
 * This is deliberately a module-level store rather than component state or a context. The desktop home and
 * the phone feed are separate trees that render the same catalog, and a cover that is dead in one is dead in
 * the other; a set per tree would make each surface learn it separately. It also has to survive a trip into a
 * listing and back out, which component state does not.
 *
 * The durable half of the fix is in the backend, where a sync can repoint a dead cover at a photo that does
 * load. This is the guard for everything that dies between one sync and the next, which is continuous.
 */

const dead = new Set<string>();
const listeners = new Set<() => void>();
/** Bumped on every new dead cover: `useSyncExternalStore` needs a snapshot that changes, and a Set does not. */
let version = 0;

export function reportDeadCover(id: string): void {
  if (!id || dead.has(id)) return;
  dead.add(id);
  version += 1;
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const snapshot = () => version;

/** Re-renders the caller whenever another cover turns out to be dead. */
export function useDeadCovers(): Set<string> {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return dead;
}

/** Drop the listings whose cover will not load. Used by every list that promises photographs. */
export function withPhotos<T extends { id: string }>(items: T[], deadSet: Set<string>): T[] {
  return deadSet.size ? items.filter((u) => !deadSet.has(u.id)) : items;
}

/** For tests: forget everything learned so far. */
export function resetDeadCovers(): void {
  dead.clear();
  version += 1;
  for (const l of listeners) l();
}
