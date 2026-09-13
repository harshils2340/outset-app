import { metroById } from "../../data/metros";
import { ART_LABEL } from "../../data/art";
import { ICONS } from "../../data/icons";
import type { Unclaimed } from "../../data/types";
import { fromPrice, publicRating } from "../../lib/catalog";
import { dealToday } from "../../lib/companyAgent";
import { fmtReviews, money } from "../../lib/format";
import { useApp } from "../../state/AppProvider";
import { Photo } from "../art/Photo";
import { Markup } from "../Markup";

export function UnclaimedCard({ item, compact }: { item: Unclaimed; compact?: boolean }) {
  const { openRequest } = useApp();
  const metro = metroById(item.metroId);
  const from = fromPrice(item);
  const kind = ART_LABEL[item.art] || item.cat;
  const score = publicRating(item);
  // Same bar the desktop card uses, so a business is a guest favourite on both surfaces or neither.
  const guestFav = !!score && score.rating >= 4.8 && score.reviews >= 100;

  return (
    <button className={(compact ? "mini" : "card") + " unclaimed"} onClick={() => openRequest(item.id)}>
      <div className="art">
        <Photo src={item.cover} video={item.video} kind={item.art} id={item.id + (compact ? "r" : "")} alt={item.title} />
        {item.claimed && item.instant ? (
          <span className="instant">
            <Markup html={ICONS.bolt} />
            Instant
          </span>
        ) : null}
        {score ? (
          <span className="rating">
            <Markup html={ICONS.star} />
            {score.rating.toFixed(1)}
            {compact ? null : (
              <>
                {" "}
                <span className="count">({fmtReviews(score.reviews)})</span>
              </>
            )}
          </span>
        ) : null}
        {/* Same two real signals the desktop card carries, in the same order: a promo running today,
            then the rating badge, and the activity label only when neither applies. Nothing here is
            decorative, both come from the operator's own published facts. */}
        <span className="actpills">
          {dealToday(item) ? <span className="actpill deal">Deal today</span> : null}
          {guestFav ? <span className="actpill fav">Guest favourite</span> : compact ? null : <span className="actpill">{kind}</span>}
        </span>
      </div>
      <div className="body">
        <div className="cardtop">
          <h3>{item.title}</h3>
          {compact || !score ? null : (
            <span className="cardrate">
              <Markup html={ICONS.star} />
              {score.rating.toFixed(1)}
            </span>
          )}
        </div>
        <div className="op">
          {item.area}
          {compact || !metro ? null : " · " + metro.name}
        </div>
        <div className="foot">
          <div className="price">
            {from == null ? (
              <span>{item.claimed && item.instant ? "Instant Book" : "Request to book"}</span>
            ) : (
              <>
                <span>From </span>
                <b>{money(from)}</b>
              </>
            )}
          </div>
          {compact ? null : <span className="link">Book</span>}
        </div>
      </div>
    </button>
  );
}
