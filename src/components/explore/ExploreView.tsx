import { CATS, CATMETA } from "../../data/categories";
import { LISTINGS } from "../../data/listings";
import { UNCLAIMED } from "../../data/unclaimed";
import { ICONS } from "../../data/icons";
import { SLOT_TIMES } from "../../data/slots";
import { dateKey } from "../../lib/dates";
import { DAYS, fmtDate } from "../../lib/format";
import { daySlotsOpen, openSeats } from "../../lib/inventory";
import { useApp } from "../../state/AppProvider";
import { Markup } from "../Markup";
import { ListingCard, MiniCard } from "./ListingCard";
import { UnclaimedCard } from "./UnclaimedCard";

export function ExploreView() {
  const { state, dates, setCat, setQ, setDate } = useApp();
  const d = dates[state.dateIdx];
  const dk = dateKey(d);
  const q = state.q.trim().toLowerCase();
  const meta = CATMETA[state.cat] || CATMETA.all;
  const inCat = LISTINGS.filter((l) => state.cat === "all" || l.cat === state.cat);
  let list = inCat;
  if (q) {
    list = list.filter((l) => (l.title + " " + l.op + " " + l.specs.join(" ") + " " + l.cat).toLowerCase().includes(q));
  }
  const soon = list
    .filter((l) => openSeats(l, dk, SLOT_TIMES[2], state.bookings) > 0 || openSeats(l, dk, SLOT_TIMES[3], state.bookings) > 0)
    .slice(0, 4);

  return (
    <>
      <div className="apphead">
        <div className="locrow">
          <button className="locbtn">
            <Markup html={ICONS.pin} />
            <span className="lbl">
              <small>Booking near</small>
              <b>Tampa Bay, FL</b>
            </span>
          </button>
          <span className="avatar">H</span>
        </div>
        <div className="search">
          <Markup html={ICONS.search} />
          <input
            id="q"
            placeholder={meta.search}
            value={state.q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>
      <div className="chipbar">
        {CATS.map((c) => (
          <button
            key={c.id}
            className="chip"
            aria-pressed={state.cat === c.id}
            onClick={() => setCat(c.id)}
          >
            {c.name}
          </button>
        ))}
      </div>
      <div style={{ height: 14 }} />
      <div className="dates">
        {dates.slice(0, 8).map((dd, i) => {
          const k = dateKey(dd);
          const free = inCat.reduce((n, l) => n + daySlotsOpen(l, k, state.bookings), 0);
          return (
            <button
              key={k}
              className="date"
              aria-pressed={state.dateIdx === i}
              onClick={() => setDate(i)}
            >
              <small>{i === 0 ? "Today" : i === 1 ? "Tmrw" : DAYS[dd.getDay()]}</small>
              <b>{dd.getDate()}</b>
              <span className="free">{free}</span>
            </button>
          );
        })}
      </div>
      <p className="note" style={{ textAlign: "left", padding: "7px 18px 0" }}>
        Green figure = open slots that day.
      </p>
      <div style={{ height: 16 }} />
      {soon.length ? (
        <>
          <div className="pad rowbetween">
            <div>
              <p className="eyebrow">{meta.railEyebrow}</p>
              <h2 className="sec">{meta.railTitle}</h2>
            </div>
          </div>
          <div style={{ height: 11 }} />
          <div className="rail">
            {soon.map((l) => (
              <MiniCard key={l.id} listing={l} date={d} />
            ))}
          </div>
          <div style={{ height: 22 }} />
        </>
      ) : null}
      <div className="pad rowbetween">
        <div>
          <p className="eyebrow">{fmtDate(d)}</p>
          <h2 className="sec">
            {list.length} {meta.head}
          </h2>
        </div>
      </div>
      <div style={{ height: 12 }} />
      {list.length ? (
        <div className="cards">
          {list.map((l) => (
            <ListingCard key={l.id} listing={l} date={d} />
          ))}
        </div>
      ) : (
        <div className="empty">
          <div className="glyph">
            <Markup html={ICONS.search} />
          </div>
          <b>{meta.emptyTitle}</b>
          <p>{meta.emptyBody}</p>
        </div>
      )}
      <p className="note">{meta.note}</p>
      {state.cat === "all" && !q ? (
        <>
          <div style={{ height: 28 }} />
          <div className="pad rowbetween">
            <div>
              <p className="eyebrow">Real businesses, seeded from public listings</p>
              <h2 className="sec">Not on Outset yet</h2>
            </div>
          </div>
          <p className="note" style={{ textAlign: "left", padding: "6px 18px 14px" }}>
            These are real Tampa Bay operators we don&apos;t have a relationship with. No invented pricing or hours. Tap
            one and we&apos;ll text them your request directly.
          </p>
          <div className="cards">
            {UNCLAIMED.map((u) => (
              <UnclaimedCard key={u.id} item={u} />
            ))}
          </div>
        </>
      ) : null}
      <div className="spacer" />
    </>
  );
}
