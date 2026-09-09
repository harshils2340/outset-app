import { ICONS } from "../../data/icons";
import type { Booking } from "../../data/types";
import { addressLine, contactFor, experienceById, fmtPhone, mapsHref, plainWords, telHref } from "../../lib/catalog";
import { fmtTime, money } from "../../lib/format";
import { useApp } from "../../state/AppProvider";
import { Photo } from "../art/Photo";
import { Markup } from "../Markup";

/** Desktop confirmation page. What was booked, where to go, and what happens next, on one screen. */
export function WebConfirm({ booking, onDone, onOpen }: { booking: Booking; onDone: () => void; onOpen: (id: string) => void }) {
  const { goto } = useApp();
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
          <h1>You're booked{booking.guest?.name ? ", " + booking.guest.name.split(" ")[0] : ""}.</h1>
          <p className="wconfirmsub">
            {when} · {fmtTime(booking.slot)} · {booking.qty} {booking.qty === 1 ? "guest" : "guests"}
            {booking.guest?.phone ? " · Confirmation texted to " + booking.guest.phone : ""}
          </p>
          <div className="wconfirmbody">
            <div className="wconfirmart">
              <Photo src={item.cover} kind={item.art} id={"cf" + item.id} alt={item.title} />
            </div>
            <div>
              <h2>{item.title}</h2>
              {picked ? <p className="wconfirmline">{plainWords(picked.name)}{picked.detail ? " · " + plainWords(picked.detail) : ""}</p> : null}
              {extras.length ? <p className="wconfirmline">Add-ons: {extras.join(", ")}</p> : null}
              <p className="wconfirmline"><b>Total {booking.total ? money(booking.total) : "paid on site"}</b> · Code {booking.code}</p>
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
              <li>The operator gets your request and confirms. You'll get a text.</li>
              <li>Show up 15 minutes early. If there's a waiver, it's linked on the listing.</li>
              <li>Questions? Otto on the listing answers from the operator's own info.</li>
            </ol>
          </div>
          <div className="wconfirmactions">
            <button type="button" className="wghost" onClick={() => onOpen(item.id)}>View the listing</button>
            <button type="button" className="wghost" onClick={() => { goto("trips"); onDone(); }}>My trips</button>
            <button type="button" className="cta small" onClick={onDone}>Find another experience</button>
          </div>
        </div>
      </div>
    </div>
  );
}
