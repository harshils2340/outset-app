import { useRef, useState, type KeyboardEvent } from "react";
import { metroById } from "../../data/metros";
import { ART_LABEL } from "../../data/art";
import type { Unclaimed } from "../../data/types";
import { cardPlace, fromPrice, perPerson, publicRating, topRated } from "../../lib/catalog";
import { dealToday } from "../../lib/companyAgent";
import { money } from "../../lib/format";
import { useApp } from "../../state/AppProvider";
import { Photo } from "../art/Photo";
import { IcHeartOnPhoto, IcStar } from "./AirIcons";
import { toggleSaved, usePrefs } from "./prefs";
import { awayLine } from "./feed";
import { AdminSiteLink, liteDealTitle, tidyDuration } from "../web/WebListing";
import { freeCancelBadge } from "../../lib/cancellation";
import { reportDeadCover } from "../../lib/deadCovers";

/** "5.0", "4.9", "4.87": Airbnb never shows a bare "5" or a trailing zero past the first decimal. */
export function fmtRating(r: number): string {
  return r % 1 === 0 ? r.toFixed(1) : String(Number(r.toFixed(2)));
}

/** Most photos a card carousel pages through. Airbnb stops the dots at five as well. */
const CARD_PHOTOS = 5;

/**
 * Airbnb's explore card: a swipeable photo with dots, a heart and one white badge, then title and rating on one
 * line, where it is, one grey detail line and the price. Every fact is the operator's own; nothing is invented.
 */
export function UnclaimedCard({ item }: { item: Unclaimed; compact?: boolean }) {
  const { state, openRequest } = useApp();
  const { saved } = usePrefs();
  const metro = metroById(item.metroId);
  const from = fromPrice(item);
  const kind = ART_LABEL[item.art] || item.cat;
  const score = publicRating(item);
  // Same bar the desktop card uses, so a business is a guest favourite on both surfaces or neither.
  const guestFav = topRated(item);
  const deal = dealToday(item);
  const instant = !!(item.claimed && item.instant);
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const photos = Array.from(new Set([item.cover, ...(item.photos || [])].filter(Boolean) as string[]))
    .filter((p) => !broken.has(p))
    .slice(0, CARD_PHOTOS);
  const [slide, setSlide] = useState(0);
  const strip = useRef<HTMLDivElement>(null);
  const isSaved = saved.includes(item.id);

  const place = cardPlace(item.area, metro?.name);
  const away = awayLine(item, state.near);
  const detail = [kind, item.dur ? tidyDuration(item.dur) : null, freeCancelBadge(item) ? "Free cancellation" : null].filter(Boolean).join(" · ");
  const unit = item.options.find((o) => o.price === from);
  const per = from != null && (!unit || perPerson(unit)) ? " / person" : "";
  // A deal with its own title reads as a line under the price ("Half-price Tuesdays"); only an untitled one keeps the badge.
  const dealTitle = liteDealTitle(item.deal);
  // An operator who switched their listing off keeps the record, so the wishlist is the one place a card for it
  // still turns up. It used to read "Instant Book" with a price, and opening it said the page was taken down.
  const badge = item.offline ? "Not bookable" : guestFav ? "Guest favourite" : deal && !dealTitle ? "Deal today" : instant ? "Instant Book" : null;

  const open = () => openRequest(item.id);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  };

  return (
    <div className="aircard" role="link" tabIndex={0} aria-label={item.title} onClick={open} onKeyDown={onKey}>
      <div className="aircardphoto">
        {photos.length > 1 ? (
          <div
            className="aircardstrip"
            ref={strip}
            onScroll={(e) => {
              const el = e.currentTarget;
              setSlide(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
            }}
          >
            {photos.map((src, i) => (
              <div className="aircardslide" key={src}>
                {i <= slide + 1 ? (
                  <Photo src={src} video={i === 0 ? item.video : undefined} kind={item.art} id={item.id + "c" + i} alt={item.title} size="wide" fallback={false} onBroken={() => setBroken((b) => new Set(b).add(src))} />
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          /* The lone cover speaks for the listing here, so a dead one takes the card out of the feed rather
             than drawing the generated illustration the cover filter exists to prevent. See lib/deadCovers. */
          <Photo src={item.cover} video={item.video} kind={item.art} id={item.id + "c"} alt={item.title} size="wide" onBroken={() => reportDeadCover(item.id)} />
        )}
        {badge ? <span className="airbadge">{badge}</span> : null}
        <button
          type="button"
          className="airsave"
          aria-label={isSaved ? "Remove from wishlist" : "Save to wishlist"}
          aria-pressed={isSaved}
          onClick={(e) => {
            e.stopPropagation();
            toggleSaved(item.id);
          }}
        >
          <IcHeartOnPhoto on={isSaved} />
        </button>
        <AdminSiteLink item={item} variant="icon" />
        {photos.length > 1 ? (
          <span className="airdots" aria-hidden>
            {photos.map((p, i) => (
              <i key={p} className={i === Math.min(slide, photos.length - 1) ? "on" : ""} />
            ))}
          </span>
        ) : null}
      </div>
      <div className="aircardbody">
        <div className="aircardtop">
          <h3>{item.title}</h3>
          {score ? (
            <span className="aircardrate">
              <IcStar size={11} />
              {fmtRating(score.rating)}
              <span> ({score.reviews.toLocaleString("en-US")})</span>
            </span>
          ) : null}
        </div>
        <p className="aircardline">
          {away || place}
        </p>
        {detail ? <p className="aircardline">{detail}</p> : null}
        {dealTitle ? (
          <p className={"aircarddeal" + (deal ? " today" : "")}>
            {deal ? <span className="aircarddealtag">Today</span> : null}
            <span className="aircarddealtext">{dealTitle}</span>
          </p>
        ) : null}
        <p className="aircardprice">
          {from == null ? (
            <span>{item.offline ? "Not taking bookings" : instant ? "Instant Book" : "Request to book"}</span>
          ) : (
            <>
              <span className="from">From </span>
              <b>{money(from)}</b>
              <span>{per}</span>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
