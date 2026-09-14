import { LISTINGS } from "../../data/listings";
import { ICONS } from "../../data/icons";
import { experienceById } from "../../lib/catalog";
import { fmtDate, fmtTime, money } from "../../lib/format";
import { useApp } from "../../state/AppProvider";
import { Markup } from "../Markup";
import { Fragment } from "react";
import { tidyLength, tidyName } from "../web/WebListing";

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
  // Only a shop that claimed its listing and switched Instant Book on can promise a confirmed slot.
  const instant = !!(u?.claimed && u?.instant);
  const addonNames = l
    ? (b.addons || [])
        .map((id) => (l.addons || []).find((x) => x.id === id)?.name)
        .filter(Boolean)
    : (b.addons || [])
        .map((idx) => {
          const o = u!.options[Number(idx)];
          return o ? (o.detail ? tidyName(o.name) + " · " + tidyLength(o.detail) : tidyName(o.name)) : null;
        })
        .filter(Boolean);

  return (
    <div className="conf">
      <div className="confmark">
        <Markup html={ICONS.checkbig} />
      </div>
      <h1>{instant ? "Booked." : "Request sent."}</h1>
      <p>{instant ? op + " has it on their board. No call needed." : op + " confirms by text or email, usually within the day. Nothing is charged until they do."}</p>
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
            <span>Guests</span>
            <b>{b.qty} {b.qty === 1 ? "guest" : "guests"}</b>
          </div>
          {addonNames.length ? (
            <div className="trow">
              <span>Service</span>
              <b>
                {/* Fragments, not spans: ".trow span" is the grey label style and turned the value grey. */}
                {addonNames.map((n, i) => (
                  <Fragment key={String(n)}>
                    {i ? <br /> : null}
                    {n}
                  </Fragment>
                ))}
              </b>
            </div>
          ) : null}
          <div className="trow">
            <span>Meet at</span>
            <b>{where}</b>
          </div>
          <div className="trow">
            <span>{b.paid ? "Paid" : instant ? "Total" : "Total, once confirmed"}</span>
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
