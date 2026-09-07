import { LISTINGS } from "../../data/listings";
import { ICONS } from "../../data/icons";
import { experienceById } from "../../lib/catalog";
import { fmtDate, fmtTime, money } from "../../lib/format";
import { useApp } from "../../state/AppProvider";
import { Markup } from "../Markup";

export function ConfirmView() {
  const { state, openChat, openRequest, goto } = useApp();
  const b = state.booking;
  if (!b) return null;
  const l = LISTINGS.find((x) => x.id === b.listing);
  const u = experienceById(b.listing);
  if (!l && !u) return null;
  const d = new Date(b.date + "T00:00:00");
  const title = l ? l.title : u!.title;
  const where = l ? l.launch : u!.area;
  const op = l ? l.op : u!.title;
  const addonNames = l
    ? (b.addons || [])
        .map((id) => (l.addons || []).find((x) => x.id === id)?.name)
        .filter(Boolean)
    : (b.addons || [])
        .map((idx) => {
          const o = u!.options[Number(idx)];
          return o ? (o.detail ? o.name + " · " + o.detail : o.name) : null;
        })
        .filter(Boolean);

  return (
    <div className="conf">
      <div className="confmark">
        <Markup html={ICONS.checkbig} />
      </div>
      <h1>Booked.</h1>
      <p>{op} has it on their board. No call needed.</p>
      <div className="ticket">
        <div className="top">
          <small className="eyebrow">Check-in code</small>
          <div className="code">{b.code}</div>
        </div>
        <div className="rows">
          <div className="trow">
            <span>Experience</span>
            <b>{title}</b>
          </div>
          <div className="trow">
            <span>When</span>
            <b>
              {fmtDate(d)}
              <br />
              {fmtTime(b.slot)}
            </b>
          </div>
          <div className="trow">
            <span>People</span>
            <b>{b.qty}</b>
          </div>
          {addonNames.length ? (
            <div className="trow">
              <span>Service</span>
              <b>
                {addonNames.map((n) => (
                  <span key={String(n)}>
                    {n}
                    <br />
                  </span>
                ))}
              </b>
            </div>
          ) : null}
          <div className="trow">
            <span>Meet at</span>
            <b>{where}</b>
          </div>
          <div className="trow">
            <span>Paid</span>
            <b className="mono">{b.total ? money(b.total) : "On site"}</b>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        {l ? (
          <button className="cta ghost" style={{ flex: 1 }} onClick={() => openChat(l.id)}>
            Message operator
          </button>
        ) : (
          <button className="cta ghost" style={{ flex: 1 }} onClick={() => openRequest(u!.id)}>
            View listing
          </button>
        )}
        <button className="cta" style={{ flex: 1 }} onClick={() => goto("trips")}>
          See my trips
        </button>
      </div>
      <p className="note">A confirmation was sent to your phone.</p>
    </div>
  );
}
