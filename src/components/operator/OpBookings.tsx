import { useState } from "react";
import { dateKey, startOfToday } from "../../lib/dates";
import { fmtTime } from "../../lib/format";
import { fmtTotal, isoToDate, relDay, type OpBooking, type OpStatus } from "../../lib/operator";
import { Markup } from "../Markup";
import { OD_ICONS, useOp } from "./opContext";

/**
 * Bookings feed. Uber Eats orders tab shape: New, Upcoming, Past, Declined. Every row opens a detail drawer
 * with the same actions a merchant has: accept, decline, complete, no-show, cancel.
 */

type Filter = "new" | "upcoming" | "past" | "closed";

export const STATUS_LABEL: Record<OpStatus, string> = {
  new: "Needs answer",
  accepted: "Confirmed",
  declined: "Declined",
  completed: "Completed",
  noshow: "No-show",
  cancelled: "Cancelled",
};

export function BookingRow({ b, actions = false }: { b: OpBooking; actions?: boolean }) {
  const { openBooking, decide } = useOp();
  return (
    <div className={"odbk" + (b.status === "new" ? " fresh" : "")}>
      <button type="button" className="odbkmain" onClick={() => openBooking(b.id)}>
        <span className="avatar">{b.guest.slice(0, 1)}</span>
        <span className="meta">
          <b>
            {b.guest}
            {b.source === "sample" ? <span className="odtag">Sample</span> : null}
            {b.source === "guest" ? <span className="odtag live">From the app</span> : null}
          </b>
          <small>{relDay(b.date)} · {fmtTime(b.slot)} · {b.qty} {b.qty === 1 ? "guest" : "guests"}</small>
          <small className="odbksvc">{b.service}{b.variant ? " · " + b.variant : ""}</small>
        </span>
        <span className="odbkright">
          <b>{fmtTotal(b)}</b>
          <span className={"odstatus " + b.status}>{STATUS_LABEL[b.status]}</span>
        </span>
      </button>
      {actions && b.status === "new" ? (
        <div className="odbkactions">
          <button type="button" className="cta ghost" onClick={() => decide(b, "declined")}>Decline</button>
          <button type="button" className="cta" onClick={() => decide(b, "accepted")}>Accept</button>
        </div>
      ) : null}
    </div>
  );
}

export function OpBookings() {
  const { bookings, p, set } = useOp();
  const [filter, setFilter] = useState<Filter>("new");
  const [q, setQ] = useState("");
  const todayKey = dateKey(startOfToday());
  const buckets: Record<Filter, OpBooking[]> = {
    new: bookings.filter((b) => b.status === "new"),
    upcoming: bookings.filter((b) => b.status === "accepted" && b.date >= todayKey),
    past: bookings.filter((b) => b.status === "completed" || b.status === "noshow" || (b.status === "accepted" && b.date < todayKey)).reverse(),
    closed: bookings.filter((b) => b.status === "declined" || b.status === "cancelled").reverse(),
  };
  const list = buckets[filter].filter((b) => !q.trim() || (b.guest + " " + b.service + " " + b.code).toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="odpage">
      <div className="odbar">
        <div className="odseg">
          {(["new", "upcoming", "past", "closed"] as Filter[]).map((f) => (
            <button type="button" key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === "new" ? "New" : f === "upcoming" ? "Upcoming" : f === "past" ? "Past" : "Declined"}
              {f === "new" && buckets.new.length ? <em>{buckets.new.length}</em> : null}
            </button>
          ))}
        </div>
        <label className="odsearch small">
          <Markup html={OD_ICONS.search} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Guest, service or code" />
        </label>
      </div>

      <div className="odrow odinstant">
        <span className="meta">
          <b><Markup html={OD_ICONS.bolt} /> Instant Book</b>
          <small>{p.instantBook ? "New bookings confirm on their own. Switch off to approve each one." : "Every booking waits for your Accept. Switch on to confirm automatically."}</small>
        </span>
        <button type="button" className={"optoggle" + (p.instantBook ? " on" : "")} onClick={() => set({ instantBook: !p.instantBook })} aria-pressed={p.instantBook}>
          <span className="knob" />
        </button>
      </div>

      {list.length === 0 ? (
        <div className="odempty">
          <b>{filter === "new" ? "No new requests" : filter === "upcoming" ? "Nothing coming up" : filter === "past" ? "No past bookings yet" : "Nothing declined"}</b>
          <p>{filter === "new" ? "When a guest books a time on your listing it lands here." : "Bookings move here as their date passes."}</p>
        </div>
      ) : null}
      <div className="odbklist">
        {list.map((b, i) => {
          const newDay = i === 0 || list[i - 1].date !== b.date;
          return (
            <div key={b.id}>
              {newDay ? <p className="odday">{relDay(b.date)}</p> : null}
              <BookingRow b={b} actions={filter === "new"} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function BookingDrawer({ b, onClose }: { b: OpBooking; onClose: () => void }) {
  const { decide, p } = useOp();
  const past = b.date < dateKey(startOfToday());
  const d = isoToDate(b.date);
  const svc = p.services.find((s) => s.name === b.service);
  return (
    <div className="oddrawerwrap" onClick={onClose}>
      <aside className="oddrawer" onClick={(e) => e.stopPropagation()}>
        <div className="oddrawerhead">
          <span className={"odstatus " + b.status}>{STATUS_LABEL[b.status]}</span>
          <button type="button" className="odiconbtn" onClick={onClose} aria-label="Close"><Markup html={OD_ICONS.x} /></button>
        </div>
        <h2>{b.guest}</h2>
        <p className="odmuted">Booking {b.code}{b.source === "sample" ? " · sample" : ""}</p>

        <div className="oddl">
          <div><small>When</small><b>{d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</b><span>{fmtTime(b.slot)}{/\d+\s*(hours?|hrs?|min)/i.test(b.variant || "") ? " · " + b.variant : svc ? " · " + (svc.durationMin >= 60 ? (svc.durationMin / 60).toString().replace(/\.0$/, "") + (svc.durationMin === 60 ? " hour" : " hours") : svc.durationMin + " min") : ""}</span></div>
          <div><small>What</small><b>{b.service}</b><span>{b.variant || "Standard"}</span></div>
          <div><small>Who</small><b>{b.qty} {b.qty === 1 ? "guest" : "guests"}</b></div>
          <div><small>Total</small><b>{fmtTotal(b)}</b>{b.addons?.length ? <span>Add-ons: {b.addons.join(", ")}</span> : null}</div>
        </div>
        {b.note ? <blockquote className="odnote">“{b.note}”</blockquote> : null}

        <div className="odcontactrow">
          <a className="odchip" href={b.phone ? "tel:" + b.phone : undefined} aria-disabled={!b.phone}><Markup html={OD_ICONS.phone} /> Call</a>
          <a className="odchip" href={b.email ? "mailto:" + b.email : undefined} aria-disabled={!b.email}><Markup html={OD_ICONS.mail} /> Email</a>
        </div>
        {!b.phone && !b.email ? <p className="odfine">Guest contact details arrive with real bookings once messaging is switched on.</p> : null}

        <div className="oddraweractions">
          {b.status === "new" ? (
            <>
              <button type="button" className="cta ghost" onClick={() => { decide(b, "declined"); onClose(); }}>Decline</button>
              <button type="button" className="cta" onClick={() => { decide(b, "accepted"); onClose(); }}>Accept</button>
            </>
          ) : null}
          {b.status === "accepted" && past ? (
            <>
              <button type="button" className="cta ghost" onClick={() => { decide(b, "noshow"); onClose(); }}>No-show</button>
              <button type="button" className="cta" onClick={() => { decide(b, "completed"); onClose(); }}>Mark completed</button>
            </>
          ) : null}
          {b.status === "accepted" && !past ? (
            <>
              <button type="button" className="cta ghost" onClick={() => { decide(b, "cancelled"); onClose(); }}>Cancel booking</button>
              <button type="button" className="cta" onClick={() => { decide(b, "completed"); onClose(); }}>Mark completed</button>
            </>
          ) : null}
          {b.status === "declined" || b.status === "cancelled" ? (
            <button type="button" className="cta ghost" onClick={() => { decide(b, "accepted"); onClose(); }}>Reinstate as confirmed</button>
          ) : null}
        </div>
        {b.status === "new" ? <p className="odfine">Declining sends the guest an automatic note offering your next open time.</p> : null}
      </aside>
    </div>
  );
}
