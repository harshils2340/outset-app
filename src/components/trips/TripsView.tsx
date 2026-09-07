import { LISTINGS } from "../../data/listings";
import { ICONS } from "../../data/icons";
import { startOfToday, dateKey } from "../../lib/dates";
import { fmtDate, fmtTime } from "../../lib/format";
import { useApp } from "../../state/AppProvider";
import { Art } from "../art/Art";
import { Markup } from "../Markup";

export function TripsView() {
  const { state, openListing } = useApp();
  const today = startOfToday();
  const mine = state.bookings.slice().sort((a, b) => (a.date + a.slot).localeCompare(b.date + b.slot));
  const up = mine.filter((b) => b.date >= dateKey(today));

  return (
    <>
      <div className="apphead">
        <p className="eyebrow">Your bookings</p>
        <h2 className="sec" style={{ fontSize: 24 }}>
          Trips
        </h2>
      </div>
      {up.length ? (
        <div className="cards">
          {up.map((b) => {
            const l = LISTINGS.find((x) => x.id === b.listing) || LISTINGS[0];
            const d = new Date(b.date + "T00:00:00");
            return (
              <button className="trip" key={b.code} onClick={() => openListing(l.id)}>
                <span className="thumb">
                  <Art kind={l.art} id={l.id + "t" + b.code} />
                </span>
                <span className="info">
                  <b>{l.title}</b>
                  <small>
                    {l.op} · {l.launch}
                  </small>
                  <span className="when">
                    {fmtDate(d)} · {fmtTime(b.slot)} · {b.qty} {l.qtyUnit}
                    {b.qty > 1 ? "s" : ""}
                  </span>
                </span>
                <span className="mono" style={{ fontSize: 11, color: "var(--ink-faint)", alignSelf: "center" }}>
                  {b.code}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="empty">
          <div className="glyph">
            <Markup html={ICONS.ticket} />
          </div>
          <b>No trips booked yet</b>
          <p>Grab a slot from Explore and it shows up here with your check-in code.</p>
        </div>
      )}
      <div className="spacer" />
    </>
  );
}
