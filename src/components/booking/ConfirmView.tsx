import { LISTINGS } from "../../data/listings";
import { ICONS } from "../../data/icons";
import { addressLine, contactFor, experienceById } from "../../lib/catalog";
import { fmtDate, fmtTime, moneyIn } from "../../lib/format";
import { countryOfArea } from "../../data/regions";
import { bookedInstant, bookedRow, splitAddons } from "../../lib/storage";
import { useApp } from "../../state/AppProvider";
import { Markup } from "../Markup";
import { Fragment, useEffect, useRef } from "react";
import { tidyAddress, tidyLength, tidyName } from "../web/WebListing";
import { bookedName, meetPlace } from "../../lib/listingDerive";
import { GUEST_AGENT } from "../../lib/flags";

export function ConfirmView() {
  const { state, openChat, openRequest, goto } = useApp();
  const b = state.booking;
  /**
   * Where the keyboard is on the one screen a guest keeps.
   *
   * A booking swaps this screen in for the sheet it was taken in, so the button that was pressed is gone and
   * there is no navigation for a screen reader to notice. Focus went to the document body, which is to say
   * the ticket, the code and the "Request sent" were on the screen and nothing said so. Focus goes to the
   * heading that says it. Before the early return, because a hook cannot sit behind one.
   */
  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (b) head.current?.focus();
  }, [b?.code]);
  if (!b) return null;
  const l = LISTINGS.find((x) => x.id === b.listing);
  const u = experienceById(b.listing);
  if (!l && !u) return null;
  const d = new Date(b.date + "T00:00:00");
  const title = l ? l.title : u!.title;
  /**
   * Where to go, on the one screen a guest keeps.
   *
   * This row read the raw area line, so the ticket for AerOhio Skydiving said "Meet at OH" while the desktop
   * confirmation for the same booking said "Ohio" with directions beside it, and 1,683 shipped listings
   * publish a state or province code with no town in front of it. The area line is not a meeting point even
   * when it does name a town: the shop's own street is on file for roughly nine listings in ten, the desktop
   * confirmation has printed it all along, and "Meet at Houston, TX" is not something a guest can drive to.
   *
   * So: the door the shop published, else the place spelled out, and `meetPlace` rather than `placeName`
   * because a row labelled "Meet at" may not be filled with a whole state. When neither exists there is
   * nothing honest to print and the row is left out, which is the rule the pay sheet's own sentence keeps.
   */
  const contact = u ? contactFor(u) : null;
  const addressRaw = contact ? addressLine(contact) : null;
  const where = l ? l.launch : addressRaw ? tidyAddress(addressRaw) : meetPlace(u!.area);
  const op = l ? l.op : u!.title;
  // Only a shop that claimed its listing and switched Instant Book on can promise a confirmed slot, and what
  // this ticket says is what it was taken as, not what the switch reads today: see `bookedInstant`.
  const instant = bookedInstant(b, u);
  // The dollars the booking was taken in, from the same area line the server charged it by.
  const cur = u ? countryOfArea(u.area) : "US";
  /* A catalog booking stores the service it picked as an index into the menu and every extra by name. This
     screen read the whole list as indexes, so the extras came out as nothing: a guest who added a $30 dry bag
     paid for it in the total and saw no dry bag anywhere on the screen that confirmed their booking. The
     desktop confirmation has named them all along. */
  // The shop's own add-on names, so an extra an operator called "2" is read as their add-on and not as a
  // menu index: see `splitAddons`.
  const split = splitAddons(b.addons, (u?.addons || []).map((a) => a.name));
  // The row the booking wrote down at confirm time, with the stored index only as its fallback: see bookedRow.
  // A hand-built listing stores its extras by id and has no menu to index into, so only the names a booking
  // of one wrote down can speak for it.
  const o = bookedRow(b, l ? undefined : u?.options);
  // `bookedName` drops a service whose name is the business's own, so the ticket does not print the listing
  // title twice. It used to reach only the bookings that carried no index; now it reads every row the same.
  const named = o ? bookedName(o.name, title) : "";
  const serviceName = named ? named + (o!.detail ? " · " + tidyLength(o!.detail) : "") : null;
  const extras = l
    ? (b.addons || []).map((id) => (l.addons || []).find((x) => x.id === id)?.name).filter((n): n is string => !!n)
    : split.extras;

  return (
    <div className="conf">
      <div className="confmark">
        <Markup html={ICONS.checkbig} />
      </div>
      <h1 ref={head} tabIndex={-1}>{instant ? "Booked." : "Request sent."}</h1>
      {/* Nobody at the shop promised an answer within the day, so this says only that the request reached them
          and, where we have an address, that we pass their answer on. */}
      <p>{instant ? op + " has it on their board. No call needed." : op + " has your request. Nothing is charged until they confirm." + (b.guest?.email ? " You'll get an email the moment they answer." : "")}</p>
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
          {serviceName ? (
            <div className="trow">
              <span>Service</span>
              <b>{serviceName}</b>
            </div>
          ) : null}
          {extras.length ? (
            <div className="trow">
              <span>{extras.length === 1 ? "Add-on" : "Add-ons"}</span>
              <b>
                {/* Fragments, not spans: ".trow span" is the grey label style and turned the value grey. */}
                {extras.map((n, i) => (
                  <Fragment key={n}>
                    {i ? <br /> : null}
                    {tidyName(n)}
                  </Fragment>
                ))}
              </b>
            </div>
          ) : null}
          {where ? (
            <div className="trow">
              <span>Meet at</span>
              <b>{where}</b>
            </div>
          ) : null}
          <div className="trow">
            <span>{b.paid ? "Paid" : instant ? "Total" : "Total, once confirmed"}</span>
            <b className="mono">{b.total ? moneyIn(b.total, cur) : "On site"}</b>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        {/* Messaging the operator is their agent answering, so it is behind `GUEST_AGENT` (lib/flags.ts). */}
        {l ? (
          GUEST_AGENT ? (
            <button className="cta ghost" style={{ flex: 1 }} onClick={() => openChat(l.id)}>
              Message operator
            </button>
          ) : null
        ) : (
          <button className="cta ghost" style={{ flex: 1 }} onClick={() => openRequest(u!.id)}>
            View listing
          </button>
        )}
        <button className="cta" style={{ flex: 1 }} onClick={() => goto("trips")}>
          See my trips
        </button>
      </div>
      {/* Text messages are not built, so nothing has ever reached the guest's phone. The email is real, and
          only when they gave one: the email box is optional and the mobile is the required field, so a guest
          who left it empty was told a confirmation had been sent when nothing had been. */}
      <p className="note">{b.guest?.email ? "A copy is on its way to " + b.guest.email + "." : "Keep your code. This trip is saved under Trips."}</p>
    </div>
  );
}
