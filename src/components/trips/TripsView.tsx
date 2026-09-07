import { LISTINGS } from "../../data/listings";
import { ICONS } from "../../data/icons";
import { startOfToday, dateKey } from "../../lib/dates";
import { experienceById } from "../../lib/catalog";
import { fmtDate, fmtTime } from "../../lib/format";
import { useApp } from "../../state/AppProvider";
import { Art } from "../art/Art";
import { Markup } from "../Markup";

export function TripsView() {
  const { state, openListing, openRequest } = useApp();
  const today = startOfToday();
  const mine = state.bookings.slice().sort((a, b) => (a.date + a.slot).localeCompare(b.date + b.slot));
  const up = mine.filter((b) => b.date >= dateKey(today));

  return (
    <>
      <div className="apphead">
        <h2 className="sec">Trips</h2>
      </div>
      {up.length ? (
        <div className="cards">
          {up.map((b) => {
            const l = LISTINGS.find((x) => x.id === b.listing);
            const u = experienceById(b.listing);
            if (!l && !u) return null;
            const d = new Date(b.date + "T00:00:00");
            const title = l ? l.title : u!.title;
            const art = l ? l.art : u!.art;
            const sub = l ? l.op + " · " + l.launch : u!.area;
            return (
              <button
                className="trip"
                key={b.code}
                onClick={() => (l ? openListing(l.id) : openRequest(u!.id))}
              >
                <span className="thumb">
                  <Art kind={art} id={(l ? l.id : u!.id) + "t" + b.code} />
                </span>
                <span className="info">
                  <b>{title}</b>
                  <small>{sub}</small>
                  <span className="when">
                    {fmtDate(d)} · {fmtTime(b.slot)} · {b.qty} {b.qty === 1 ? "person" : "people"}
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
          <p>When you book, the confirmation lives here.</p>
        </div>
      )}
      <div className="spacer" />
    </>
  );
}
