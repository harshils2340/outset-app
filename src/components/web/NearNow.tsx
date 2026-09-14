import { useMemo } from "react";
import type { Unclaimed } from "../../data/types";
import { getCatalog, publicRating } from "../../lib/catalog";
import { itemOpenState } from "../../lib/openNow";
import { kmBetween, type Place } from "../../lib/places";

/**
 * "Open right now near you." The thing TripAdvisor does not do: what is good, close, and open at this moment.
 * Only operators whose published hours say they are open right now, within 40 km of the guest's place,
 * with a real photo, and rated well where a rating exists. Nothing is guessed: no hours, no row.
 *
 * The home renders these as one of its ordinary rails, the way Airbnb's rows sit one under another, so this
 * file only decides which places qualify and leaves the card to the home.
 */
export function useNearNow(near: Place | null, catalogVersion: number): Unclaimed[] {
  return useMemo(() => {
    if (!near) return [];
    const now = new Date();
    const out: { u: Unclaimed; km: number }[] = [];
    for (const u of getCatalog()) {
      if (!u.cover || u.lat == null || u.lon == null) continue;
      const km = kmBetween(near, { lat: u.lat, lon: u.lon });
      if (km > 40) continue;
      const score = publicRating(u);
      if (score && (score.rating < 4.5 || score.reviews < 20)) continue;
      const st = itemOpenState(u, now);
      if (!st || !st.open) continue;
      out.push({ u, km });
    }
    return out.sort((a, b) => a.km - b.km).slice(0, 20).map((x) => x.u);
  }, [near?.lat, near?.lon, catalogVersion]);
}
