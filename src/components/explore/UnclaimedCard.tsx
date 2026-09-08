import { metroById } from "../../data/metros";
import { ART_LABEL } from "../../data/art";
import { ICONS } from "../../data/icons";
import type { Unclaimed } from "../../data/types";
import { fromPrice, publicRating } from "../../lib/catalog";
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

  return (
    <button className={(compact ? "mini" : "card") + " unclaimed"} onClick={() => openRequest(item.id)}>
      <div className="art">
        <Photo src={item.cover} video={item.video} kind={item.art} id={item.id + (compact ? "r" : "")} alt={item.title} />
        <span className="instant">
          <Markup html={ICONS.bolt} />
          Instant
        </span>
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
        {compact ? null : <span className="actpill">{kind}</span>}
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
              <span>Instant Book</span>
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
