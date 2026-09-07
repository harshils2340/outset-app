import { LISTINGS } from "../../data/listings";
import { ICONS } from "../../data/icons";
import { fmtDate, fmtTime, money } from "../../lib/format";
import { useApp } from "../../state/AppProvider";
import { Markup } from "../Markup";

export function ConfirmView() {
  const { state, openChat, goto } = useApp();
  const b = state.booking;
  if (!b) return null;
  const l = LISTINGS.find((x) => x.id === b.listing);
  if (!l) return null;
  const d = new Date(b.date + "T00:00:00");
  const addonNames = (b.addons || [])
    .map((id) => (l.addons || []).find((x) => x.id === id)?.name)
    .filter(Boolean) as string[];

  return (
    <div className="conf">
      <div className="confmark">
        <Markup html={ICONS.checkbig} />
      </div>
      <h1>Booked.</h1>
      <p>
        {l.op} has it on their board. No call needed.
      </p>
      <div className="ticket">
        <div className="top">
          <small className="eyebrow">Check-in code</small>
          <div className="code">{b.code}</div>
        </div>
        <div className="rows">
          <div className="trow">
            <span>Experience</span>
            <b>{l.title}</b>
          </div>
          <div className="trow">
            <span>When</span>
            <b>
              {fmtDate(d)}
              <br />
              {fmtTime(b.slot)} · {l.minHours} hr
            </b>
          </div>
          <div className="trow">
            <span>{l.qtyLabel}</span>
            <b>{b.qty}</b>
          </div>
          {addonNames.length ? (
            <div className="trow">
              <span>Add-ons</span>
              <b>
                {addonNames.map((n) => (
                  <span key={n}>
                    {n}
                    <br />
                  </span>
                ))}
              </b>
            </div>
          ) : null}
          <div className="trow">
            <span>Meet at</span>
            <b>{l.launch}</b>
          </div>
          <div className="trow">
            <span>Paid</span>
            <b className="mono">{money(b.total)}</b>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <button className="cta ghost" style={{ flex: 1 }} onClick={() => openChat(l.id)}>
          Message operator
        </button>
        <button className="cta" style={{ flex: 1 }} onClick={() => goto("trips")}>
          See my trips
        </button>
      </div>
      <p className="note">A confirmation and the marina pin were sent to your phone.</p>
    </div>
  );
}
