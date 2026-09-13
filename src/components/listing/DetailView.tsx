import { ICONS } from "../../data/icons";
import { SLOT_TIMES } from "../../data/slots";
import { dateKey } from "../../lib/dates";
import { fmtDate, fmtTime, money } from "../../lib/format";
import { daySlotsOpen, openSeats } from "../../lib/inventory";
import { priceFor } from "../../lib/pricing";
import { useApp } from "../../state/AppProvider";
import { Art } from "../art/Art";
import { Markup } from "../Markup";
import { SlotCalendar } from "../booking/SlotCalendar";

export function DetailView() {
  const { state, dates, listing, back, setDate, setSlot, bumpQty, toggleAddon, openReview, openChat } = useApp();
  if (!listing) return null;
  const d = dates[state.dateIdx];
  const dk = dateKey(d);
  const seats = state.slot ? openSeats(listing, dk, state.slot, state.bookings) : 0;
  const p = priceFor(listing, state.qty, state.addons);
  const qtyCap = state.slot ? Math.max(1, seats) : listing.qtyMax;

  return (
    <>
      <div className="detailart">
        <Art kind={listing.art} id={listing.id + "d"} />
        <button className="backbtn" onClick={back}>
          <Markup html={ICONS.back} />
        </button>
        <span className="rating" style={{ right: 14, top: 14 }}>
          <Markup html={ICONS.star} />
          {listing.rating.toFixed(1)}{" "}
          <span style={{ color: "var(--ink-faint)", fontWeight: 500 }}>({listing.reviews})</span>
        </span>
      </div>
      <div className="detailbody">
        <p className="eyebrow" style={{ marginBottom: 6 }}>
          {listing.launch} · {listing.dist}
        </p>
        <h1>{listing.title}</h1>
        <div className="oprow">
          <span className="avatar">{listing.opInit}</span>
          <span className="meta">
            <b>{listing.op}</b>
            <small>{listing.opSince}</small>
            <br />
            <span className="agentpill">
              <Markup html={ICONS.spark} />
              Agent replies in seconds
            </span>
          </span>
          <button className="pill" onClick={() => openChat(listing.id)}>
            Ask
          </button>
        </div>
        <div className="factgrid">
          {listing.facts.map((f) => (
            <div className="fact" key={f[0]}>
              <small>{f[0]}</small>
              <b>{f[1]}</b>
            </div>
          ))}
        </div>
        <p className="blurb">{listing.blurb}</p>
        <ul className="policy">
          {listing.policy.map((x) => (
            <li key={x}>
              <Markup html={ICONS.dot} />
              <span>{x}</span>
            </li>
          ))}
        </ul>

        <div className="slotwrap">
          <div className="rowbetween">
            <div>
              <p className="eyebrow">Live availability</p>
              <h2 className="sec">{fmtDate(d)}</h2>
            </div>
            <span className="mono" style={{ fontSize: 12, color: "var(--ink-faint)" }}>
              {daySlotsOpen(listing, dk, state.bookings)}/{SLOT_TIMES.length} open
            </span>
          </div>
          <div style={{ height: 10 }} />
          {/* Month calendar plus the day's start times. Both carry this listing's real inventory: a day
              that is booked out cannot be picked, and every slot keeps its seats-left line. */}
          <SlotCalendar
            dates={dates}
            dateIdx={state.dateIdx}
            onPickDate={setDate}
            slots={SLOT_TIMES}
            time={state.slot}
            onPickTime={setSlot}
            dayMeta={(dd) => {
              const open = daySlotsOpen(listing, dateKey(dd), state.bookings);
              return { open, full: open === 0 };
            }}
            slotMeta={(t) => {
              const n = openSeats(listing, dk, t, state.bookings);
              const few = n <= Math.max(1, Math.round(listing.qtyMax * 0.3));
              return {
                note: n === 0 ? "Sold out" : n + " " + listing.qtyUnit + (n > 1 ? "s" : ""),
                disabled: n === 0,
                tone: n === 0 ? "gone" : few ? "few" : undefined,
              };
            }}
          />
          <p className="note" style={{ textAlign: "left", padding: "10px 0 0" }}>
            Slots update as other guests book. Inventory is saved on this device.
          </p>
        </div>

        <div style={{ height: 20 }} />
        <div className="rowbetween">
          <h2 className="sec">{listing.qtyLabel}</h2>
          <span className="stepper">
            <button onClick={() => bumpQty(-1)} disabled={state.qty <= 1}>
              −
            </button>
            <span className="n">{state.qty}</span>
            <button onClick={() => bumpQty(1)} disabled={state.qty >= qtyCap}>
              +
            </button>
          </span>
        </div>
        {state.slot ? (
          <p className="note" style={{ textAlign: "left", padding: "6px 0 0" }}>
            {seats} {listing.qtyUnit}{seats > 1 ? "s" : ""} available at {fmtTime(state.slot)}.
          </p>
        ) : (
          <p className="note" style={{ textAlign: "left", padding: "6px 0 0" }}>
            Pick a time to see how many are left.
          </p>
        )}

        <div style={{ height: 18 }} />
        <h2 className="sec">Add-ons</h2>
        <div>
          {(listing.addons || []).map((a) => (
            <button
              key={a.id}
              className="addon"
              aria-pressed={state.addons.includes(a.id)}
              onClick={() => toggleAddon(a.id)}
            >
              <span className="tick">
                <Markup html={ICONS.check} />
              </span>
              <span className="txt">
                <b>{a.name}</b>
                <small>{a.note}</small>
              </span>
              <span className="mono" style={{ fontSize: 13, fontWeight: 500 }}>
                {a.price ? "+" + money(a.price) : "Free"}
              </span>
            </button>
          ))}
        </div>
        <div style={{ height: 12 }} />
      </div>
      <div className="dock">
        <div className="price">
          <b>{money(p.total)}</b>
          <span className="min">{state.slot ? fmtDate(d) + " · " + fmtTime(state.slot) : "total with fees"}</span>
        </div>
        <button className="cta" disabled={!state.slot} onClick={openReview}>
          {state.slot ? "Review booking" : "Pick a time"}
        </button>
      </div>
    </>
  );
}
