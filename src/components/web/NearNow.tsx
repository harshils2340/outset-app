import { useMemo } from "react";
import { ICONS } from "../../data/icons";
import type { Unclaimed } from "../../data/types";
import { fromPrice, getCatalog, publicRating } from "../../lib/catalog";
import { fmtReviews, money } from "../../lib/format";
import { itemOpenState } from "../../lib/openNow";
import { fmtDistance, kmBetween, type Place } from "../../lib/places";
import { Photo } from "../art/Photo";
import { Markup } from "../Markup";

/**
 * "Near you, open now." The thing TripAdvisor does not do: what is good, close, and open at this moment.
 * Only operators whose published hours say they are open right now, within 40 km of the guest's place,
 * with a real photo, and rated well where a rating exists. Nothing is guessed: no hours, no row.
 */
export function NearNow({ near, onOpen }: { near: Place | null; onOpen: (id: string) => void }) {
  const items = useMemo(() => {
    if (!near) return [];
    const now = new Date();
    const out: { u: Unclaimed; km: number; closes?: string }[] = [];
    for (const u of getCatalog()) {
      if (!u.cover || u.lat == null || u.lon == null) continue;
      const km = kmBetween(near, { lat: u.lat, lon: u.lon });
      if (km > 40) continue;
      const score = publicRating(u);
      if (score && (score.rating < 4.5 || score.reviews < 20)) continue;
      const st = itemOpenState(u, now);
      if (!st || !st.open) continue;
      out.push({ u, km, closes: st.closesAt });
    }
    return out.sort((a, b) => a.km - b.km).slice(0, 12);
  }, [near?.lat, near?.lon]);

  if (!near || !items.length) return null;
  return (
    <section className="wrail wnearnow">
      <div className="wrailhead">
        <h2>Open right now near {near.label}</h2>
        <span className="wsortnear"><Markup html={ICONS.clock} /> From their published hours</span>
      </div>
      <div className="wrailrow">
        {items.map(({ u, km, closes }) => {
          const from = fromPrice(u);
          const score = publicRating(u);
          return (
            <button type="button" className="wcard" key={u.id} onClick={() => onOpen(u.id)}>
              <div className="wart">
                <Photo src={u.cover} video={u.video} kind={u.art} id={"nn" + u.id} alt={u.title} />
                <span className="wbadge open">Open{closes ? " until " + closes : " now"}</span>
              </div>
              <div className="wbody">
                <b>{u.title}</b>
                <small>{fmtDistance(km)} away · {u.area}</small>
                <span className="wmeta">
                  {from != null ? <span>From <b>{money(from)}</b></span> : <span>Request to book</span>}
                  {score ? (
                    <span className="wrate">
                      <Markup html={ICONS.star} /> {score.rating.toFixed(1)} <em>({fmtReviews(score.reviews)})</em>
                    </span>
                  ) : null}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
