import { ICONS } from "../../data/icons";
import type { Listing } from "../../data/types";
import { money } from "../../lib/format";
import { dateKey } from "../../lib/dates";
import { daySlotsOpen } from "../../lib/inventory";
import { useApp } from "../../state/AppProvider";
import { Art } from "../art/Art";
import { Markup } from "../Markup";

export function AvailBadge({ listing, date }: { listing: Listing; date: Date }) {
  const { state } = useApp();
  const n = daySlotsOpen(listing, dateKey(date), state.bookings);
  if (n === 0) {
    return (
      <span className="badge-avail gone">
        <span className="dot" />
        Booked out
      </span>
    );
  }
  if (n <= 2) {
    return (
      <span className="badge-avail few">
        <span className="dot" />
        Only {n} slot{n > 1 ? "s" : ""} left
      </span>
    );
  }
  return (
    <span className="badge-avail open">
      <span className="dot" />
      {n} slots open
    </span>
  );
}

export function ListingCard({ listing, date }: { listing: Listing; date: Date }) {
  const { state, openListing } = useApp();
  const n = daySlotsOpen(listing, dateKey(date), state.bookings);
  const loc = listing.launch.split(" · ")[0];
  return (
    <button className="card" onClick={() => openListing(listing.id)}>
      <div className="art">
        <Art kind={listing.art} id={listing.id} />
        <span className="instant">
          <Markup html={ICONS.bolt} />
          Instant
        </span>
        <span className="rating">
          <Markup html={ICONS.star} />
          {listing.rating.toFixed(1)}{" "}
          <span style={{ color: "var(--ink-faint)", fontWeight: 500 }}>({listing.reviews})</span>
        </span>
        <AvailBadge listing={listing} date={date} />
      </div>
      <div className="body">
        <h3>{listing.title}</h3>
        <div className="op">
          {listing.op} · {loc} · {listing.dist}
        </div>
        <div className="specrow">
          {listing.specs.map((s) => (
            <span className="spec" key={s}>
              {s}
            </span>
          ))}
        </div>
        <div className="foot">
          <div className="price">
            <b>{money(listing.price)}</b>
            <span>/{listing.unit}</span>
            <span className="min">
              {listing.unit === "trip" ? listing.minHours + " hour trip" : listing.minHours + " hr minimum"}
            </span>
          </div>
          <span className="link">
            {n} slots <Markup html={ICONS.arrow} />
          </span>
        </div>
      </div>
    </button>
  );
}

export function MiniCard({ listing, date }: { listing: Listing; date: Date }) {
  const { openListing } = useApp();
  return (
    <button className="mini" onClick={() => openListing(listing.id)}>
      <div className="art">
        <Art kind={listing.art} id={listing.id + "m"} />
        <AvailBadge listing={listing} date={date} />
      </div>
      <div className="body">
        <h3>{listing.title}</h3>
        <div className="sub">{listing.op}</div>
        <div className="foot">
          <span className="price">
            <b style={{ fontSize: 16 }}>{money(listing.price)}</b>
            <span>/{listing.unit}</span>
          </span>
          <span style={{ fontSize: 11.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 3 }}>
            <Markup html={ICONS.star} />
            {listing.rating.toFixed(1)}
          </span>
        </div>
      </div>
    </button>
  );
}
