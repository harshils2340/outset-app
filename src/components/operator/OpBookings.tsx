import { useEffect, useRef, useState } from "react";
import { dateKey, startOfToday } from "../../lib/dates";
import { fmtTime, money } from "../../lib/format";
import { bookingPayout, fmtTotal, guestHearsBack, isoToDate, relDay, type OpBooking, type OpStatus } from "../../lib/operator";
import { Markup } from "../Markup";
import { useModal } from "../layout/useModal";
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
  const { bookings, p, set, toast } = useOp();
  const [filter, setFilter] = useState<Filter>("new");
  const toggleInstant = () => {
    const on = !p.instantBook;
    set((cur) => {
      // Switching Instant Book on must not answer requests already waiting. A browser-local request reads its
      // status from this switch, so each undecided one is pinned as a request first.
      const decisions = { ...cur.decisions };
      if (on) for (const b of bookings) if (b.source === "guest" && b.status === "new" && !decisions[b.code]) decisions[b.code] = "new";
      return { ...cur, instantBook: on, decisions };
    });
    toast(on ? "Instant Book on. New bookings confirm on their own." : "Instant Book off. Each booking waits for your Accept.");
  };
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
        <button type="button" className={"optoggle" + (p.instantBook ? " on" : "")} onClick={toggleInstant} aria-pressed={p.instantBook} aria-label="Instant Book">
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
  const { decide, p, toast } = useOp();
  const past = b.date < dateKey(startOfToday());
  const d = isoToDate(b.date);
  const svc = p.services.find((s) => s.name === b.service);
  // Cancelling a confirmed booking refunds the guest and cannot be taken back, so it asks once.
  const [sure, setSure] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const box = useRef<HTMLElement | null>(null);
  // It says aria-modal, so Tab has to stay in it and the feed it came from gets the focus back. Declared first
  // so the opener it remembers is the booking card, not the Close button the effect below moves focus to.
  useModal(box);
  // onClose is a fresh arrow each render of the shell; read through a ref so the effect runs once per booking.
  const closeFn = useRef(onClose);
  closeFn.current = onClose;
  useEffect(() => {
    setSure(false);
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeFn.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [b.id]);
  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(b.code);
      toast("Code " + b.code + " copied");
    } catch {
      toast("Couldn't copy. The code is " + b.code);
    }
  };
  // A decline or cancel already sent the guest's money back; confirming it again would promise a time nobody has paid for.
  const refunded = b.source === "remote" && b.payment === "released";
  // Whether a decision here reaches the guest at all: see guestHearsBack.
  const heard = guestHearsBack(b);
  const moneyBack = b.payment === "captured" || b.payment === "authorized";
  return (
    <div className="oddrawerwrap" onClick={onClose}>
      <aside className="oddrawer" ref={box} role="dialog" aria-modal="true" aria-label={"Booking " + b.code} onClick={(e) => e.stopPropagation()}>
        <div className="oddrawerhead">
          <span className={"odstatus " + b.status}>{STATUS_LABEL[b.status]}</span>
          <button type="button" className="odiconbtn" ref={closeRef} onClick={onClose} aria-label="Close"><Markup html={OD_ICONS.x} /></button>
        </div>
        <h2>{b.guest}</h2>
        <p className="odmuted">Booking {b.code}{b.source === "sample" ? " · sample" : ""}</p>

        <div className="oddl">
          <div><small>When</small><b>{d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</b><span>{fmtTime(b.slot)}{/\d+\s*(hours?|hrs?|min)/i.test(b.variant || "") ? " · " + b.variant : svc ? " · " + (svc.durationMin >= 60 ? (svc.durationMin / 60).toString().replace(/\.0$/, "") + (svc.durationMin === 60 ? " hour" : " hours") : svc.durationMin + " min") : ""}</span></div>
          <div><small>What</small><b>{b.service}</b><span>{b.variant || "Standard"}</span></div>
          <div><small>Who</small><b>{b.qty} {b.qty === 1 ? "guest" : "guests"}</b></div>
          {/* The guest's total carries Outset's service fee, and the operator's own price still carries Outset's
              5%. "You receive" was printing that price, which is the email's "Your price" line, a whole fee
              above the "You receive" line underneath it: $116 here against the $110.20 the transfer sends. */}
          <div><small>Total</small><b>{b.subtotal != null && b.total != null && b.subtotal < b.total ? "Guest pays " + money(b.total) + " · you receive " + money(bookingPayout(b)) : fmtTotal(b)}</b>{b.addons?.length ? <span>Add-ons: {b.addons.join(", ")}</span> : null}</div>
        </div>
        {b.note ? <blockquote className="odnote">“{b.note}”</blockquote> : null}

        <div className="odcontactrow">
          <a className="odchip" href={b.phone ? "tel:" + b.phone : undefined} aria-disabled={!b.phone}><Markup html={OD_ICONS.phone} /> Call</a>
          <a className="odchip" href={b.email ? "mailto:" + b.email : undefined} aria-disabled={!b.email}><Markup html={OD_ICONS.mail} /> Email</a>
          <button type="button" className="odchip" onClick={copyCode}><Markup html={OD_ICONS.ticket} /> Copy code</button>
        </div>
        {/* The number and address themselves: on a desktop a tel: link goes nowhere, and the owner reads them off the screen. */}
        {b.phone || b.email ? <p className="odmuted odguestcontact">{[b.phone, b.email].filter(Boolean).join(" · ")}</p> : null}
        {!b.phone && !b.email ? <p className="odfine">{b.source === "sample" ? "A sample row has no guest to contact. Real bookings carry the guest's mobile and email." : "This booking came without contact details."}</p> : null}

        {b.status === "new" && past ? <p className="odfine">This date has already passed. Decline it so the guest hears back, or accept it if they came anyway.</p> : null}
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
          {b.status === "accepted" && !past && !sure ? (
            <>
              <button type="button" className="cta ghost" onClick={() => setSure(true)}>Cancel booking</button>
              <button type="button" className="cta" onClick={() => { decide(b, "completed"); onClose(); }}>Mark completed</button>
            </>
          ) : null}
          {b.status === "accepted" && !past && sure ? (
            <>
              <button type="button" className="cta ghost" onClick={() => setSure(false)} autoFocus>Keep it</button>
              <button type="button" className="cta danger" onClick={() => { decide(b, "cancelled"); onClose(); }}>Yes, cancel it</button>
            </>
          ) : null}
          {(b.status === "declined" || b.status === "cancelled") && !refunded ? (
            <button type="button" className="cta ghost" onClick={() => { decide(b, "accepted"); onClose(); }}>Reinstate as confirmed</button>
          ) : null}
          {b.status === "noshow" ? (
            <button type="button" className="cta ghost" onClick={() => { decide(b, "accepted"); onClose(); }}>Undo no-show</button>
          ) : null}
        </div>
        {/* What actually happens, rather than what would be nice. The decline email says the time is not free
            and links back to the listing so the guest can pick another; it does not offer a time, because
            nothing picks one. And email is the only channel there is, while the booking form only requires a
            name and a mobile, so a guest who left the email box empty hears nothing at all. */}
        {b.status === "new" ? (
          <p className="odfine">
            {heard ? "Declining emails the guest to say the time is not free, with a link back to your listing to pick another." : "This guest gets no email from us, so declining tells them nothing. Their mobile is above."}
          </p>
        ) : null}
        {b.status === "accepted" && !past && sure ? (
          <p className="odfine">
            {moneyBack ? (heard ? "The guest gets their money back and an email saying you cancelled." : "The guest gets their money back, but no email, because we have no address for them.") : heard ? "The guest gets an email saying you cancelled." : "The guest gets no email, because we have no address for them. Their mobile is above."}
            {" "}This can't be undone.
          </p>
        ) : null}
        {refunded ? <p className="odfine">The guest's card was refunded when this was {b.status}, so it can't be confirmed again. Ask them to book once more.</p> : null}
      </aside>
    </div>
  );
}
