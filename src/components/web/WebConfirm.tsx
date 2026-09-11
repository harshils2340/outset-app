import { ICONS } from "../../data/icons";
import type { Booking } from "../../data/types";
import { addressLine, contactFor, experienceById, fmtPhone, mapsHref, plainWords, telHref } from "../../lib/catalog";
import { fmtTime, money } from "../../lib/format";
import { Photo } from "../art/Photo";
import { Markup } from "../Markup";

/** Desktop confirmation page. What was booked, where to go, and what happens next, on one screen. */
export function WebConfirm({ booking, onDone, onOpen }: { booking: Booking; onDone: () => void; onOpen: (id: string) => void }) {
  const item = experienceById(booking.listing);
  if (!item) return null;
  const contact = contactFor(item);
  const address = contact ? addressLine(contact) : null;
  const picked = booking.addons.length && /^\d+$/.test(booking.addons[0]) ? item.options[Number(booking.addons[0])] : null;
  const extras = booking.addons.filter((a) => !/^\d+$/.test(a));
  const [y, m, d] = booking.date.split("-").map(Number);
  const when = new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="wlisting">
      <div className="wwrap wconfirm">
        <div className="wconfirmcard">
          <div className="confmark">
            <Markup html={ICONS.check} />
          </div>
          <h1>{item.claimed && item.instant ? "You're booked" : "Request sent"}{booking.guest?.name ? ", " + booking.guest.name.split(" ")[0] : ""}.</h1>
          {!(item.claimed && item.instant) ? <p className="wconfirmsub">{item.title} confirms by text or email, usually within the day. Nothing is charged until they do.</p> : null}
          <p className="wconfirmsub">
            {when} · {fmtTime(booking.slot)} · {booking.qty} {booking.qty === 1 ? "guest" : "guests"}
            {booking.guest?.phone ? " · Updates go to " + booking.guest.phone : ""}
          </p>
          <div className="wconfirmbody">
            <div className="wconfirmart">
              <Photo src={item.cover} kind={item.art} id={"cf" + item.id} alt={item.title} />
            </div>
            <div>
              <h2>{item.title}</h2>
              {picked ? <p className="wconfirmline">{plainWords(picked.name)}{picked.detail ? " · " + plainWords(picked.detail) : ""}</p> : null}
              {extras.length ? <p className="wconfirmline">Add-ons: {extras.join(", ")}</p> : null}
              <p className="wconfirmline"><b>{booking.total ? (booking.paid ? "Paid " + money(booking.total) + " by card" : "Total " + money(booking.total)) : "Pay on site"}</b> · Code {booking.code}</p>
              <div className="contact" style={{ marginTop: 12 }}>
                <a className="crow" href={contact ? mapsHref(contact, item.title + " " + item.area) : "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(item.title + " " + item.area)} target="_blank" rel="noreferrer">
                  <Markup html={ICONS.pin} />
                  <span><b>{address || item.area}</b><small>Get directions</small></span>
                </a>
                {contact?.phone ? (
                  <a className="crow" href={telHref(contact.phone)}>
                    <Markup html={ICONS.phone} />
                    <span><b>{fmtPhone(contact.phone)}</b><small>Running late? Call the shop</small></span>
                  </a>
                ) : null}
              </div>
            </div>
          </div>
          <div className="wconfirmnext">
            <b>What happens next</b>
            <ol>
              <li>{item.claimed && item.instant ? "Your spot is confirmed. You'll get a text with the details." : "The operator gets your request and confirms. You'll get a text or email."}</li>
              <li>Show up 15 minutes early. If there's a waiver, it's linked on the listing.</li>
              <li>Questions? Otto on the listing answers from the operator's own info.</li>
            </ol>
          </div>
          <div className="wconfirmactions">
            <button type="button" className="wghost" onClick={() => onOpen(item.id)}>View the listing</button>
            <button type="button" className="cta small" onClick={onDone}>Find another experience</button>
          </div>
        </div>
      </div>
    </div>
  );
}
