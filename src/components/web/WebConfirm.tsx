import { useEffect } from "react";
import "../../styles/air-listing.css";
import { ICONS } from "../../data/icons";
import type { Booking } from "../../data/types";
import { addressLine, contactFor, experienceById, fmtPhone, mapsHref, perPerson, publicRating, telHref } from "../../lib/catalog";
import { addonPrice, priceUnclaimed, serviceFeeLabel } from "../../lib/pricing";
import { splitAddons } from "../../lib/storage";
import { arrivalNote, tidyAddress, tidyLength, tidyName } from "./WebListing";
import { fmtReviews, fmtTime, money } from "../../lib/format";
import { Photo } from "../art/Photo";
import { Mark } from "../layout/Mark";
import { Markup } from "../Markup";

const STAR = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.6l2.9 6 6.6.8-4.9 4.6 1.3 6.5L12 17.3l-5.9 3.2 1.3-6.5-4.9-4.6 6.6-.8z"/></svg>';
const PIN = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.2 7-11.2a7 7 0 1 0-14 0C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.6"/></svg>';
const PHONE = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 16.4v2.9a2 2 0 0 1-2.2 2 19.5 19.5 0 0 1-8.5-3 19.2 19.2 0 0 1-5.9-5.9 19.5 19.5 0 0 1-3-8.5A2 2 0 0 1 3.4 1.8h2.9a2 2 0 0 1 2 1.7l.5 3.1a2 2 0 0 1-.6 1.8L7 9.6a15.5 15.5 0 0 0 6 6l1.2-1.2a2 2 0 0 1 1.8-.6l3.1.5a2 2 0 0 1 1.9 2.1z"/></svg>';

/**
 * Desktop confirmation page in the shape of Airbnb's "Request sent" trip page: what happens next and the trip
 * details on the left, a summary card with the photo, the booking and the total on the right.
 */
export function WebConfirm({ booking, onDone, onOpen }: { booking: Booking; onDone: () => void; onOpen: (id: string) => void }) {
  // The page opens where the booking form was scrolled to; the confirmation belongs at the top, in view.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [booking.code]);
  const item = experienceById(booking.listing);
  if (!item) return null;
  const contact = contactFor(item);
  // Null when the shop published something that is not a number a guest can ring, and then no call is offered.
  const callHref = contact?.phone ? telHref(contact.phone) : null;
  const addressRaw = contact ? addressLine(contact) : null;
  const address = addressRaw ? tidyAddress(addressRaw) : null;
  const score = publicRating(item);
  const { optionIdx, extras } = splitAddons(booking.addons);
  const picked = optionIdx != null ? item.options[optionIdx] : null;
  const [y, m, d] = booking.date.split("-").map(Number);
  // A trip in another year carries its year: bookings run up to a year ahead, and "Sunday, January 3" on a
  // confirmation written in December does not say which January.
  const trip = new Date(y, m - 1, d);
  const when = trip.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: trip.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
  const instant = !!(item.claimed && item.instant);
  const first = booking.guest?.name ? booking.guest.name.split(" ")[0] : "";
  // The price lines are the same breakdown the listing showed; they appear only when they add up to the stored total.
  const addonRows = (item.addons || []).filter((a) => extras.includes(a.name));
  const arrival = arrivalNote(item);
  const steps = [
    instant
      ? booking.guest?.email
        ? "Your spot is confirmed. The details are in your confirmation email."
        : "Your spot is confirmed. Keep the code above: it is your booking."
      : booking.guest?.email
        ? "The operator gets your request and confirms. You'll get an email the moment they answer."
        : "The operator gets your request and confirms. With no email on the booking, check back here or call them for the answer.",
    arrival,
    "Questions? Otto on the listing answers from the operator's own info.",
  ].filter(Boolean);
  const p = picked ? priceUnclaimed(picked, booking.qty, addonRows) : null;
  const lines = p && p.base && booking.total && Math.abs(p.total - booking.total) < 0.01 ? p : null;

  return (
    <div className="wlisting al">
      <header className="alhead">
        <div className="alwrap alheadin">
          <button type="button" className="alback" onClick={() => onOpen(item.id)} aria-label="Back to the listing">
            <span className="alround"><Markup html={'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m14.5 5.5-6.5 6.5 6.5 6.5"/></svg>'} /></span>
            <span>Back to the listing</span>
          </button>
          <a className="allogo" href="#" onClick={(e) => { e.preventDefault(); onDone(); }} aria-label="Outset home">
            <Mark size={30} />
            <b>Outset</b>
          </a>
        </div>
      </header>

      <div className="alwrap">
        <div className="alconfirm">
          <div className="alconfirmmain">
            <span className="alconfirmmark"><Markup html={ICONS.checkbig} /></span>
            <h1 className="alconfirmtitle">{instant ? "You're booked" : "Request sent"}{first ? ", " + first : ""}</h1>
            {/* No operator promised an answer within the day, so the lead says only that the request reached
                them. When they answer is in the step list, and that is the one thing we do control. */}
            <p className="alconfirmlead">
              {instant
                ? "Your spot is confirmed. " + item.title + " has your details" + (booking.guest?.email ? ", and a confirmation email is on its way." : ".")
                : item.title + " has your request. " + (booking.paid ? "Your card is held and only charged when they confirm." : "You won't be charged until they do.")}
            </p>

            <section className="alsec">
              <h2>Your booking</h2>
              <div className="alconfirmrow">
                <span><b>Date</b><small>{when}</small></span>
              </div>
              <div className="alconfirmrow">
                <span><b>Start time</b><small>{fmtTime(booking.slot)}</small></span>
              </div>
              <div className="alconfirmrow">
                <span><b>Guests</b><small>{booking.qty} {booking.qty === 1 ? "guest" : "guests"}</small></span>
              </div>
              {picked ? (
                <div className="alconfirmrow">
                  <span><b>Booking</b><small>{tidyName(picked.name)}{picked.detail ? " · " + tidyLength(picked.detail) : ""}</small></span>
                </div>
              ) : booking.service ? (
                <div className="alconfirmrow">
                  <span><b>Booking</b><small>{booking.service}</small></span>
                </div>
              ) : null}
              {extras.length ? (
                <div className="alconfirmrow">
                  <span><b>Add-ons</b><small>{extras.join(", ")}</small></span>
                </div>
              ) : null}
              <div className="alconfirmrow">
                <span><b>Confirmation code</b><small>{booking.code}</small></span>
              </div>
              {/* Only the email is a channel we send on. Text messages are not built, so a phone number listed
                  under "Updates go to" was a promise nothing keeps: it is how the shop reaches the guest. */}
              {booking.guest?.email ? (
                <div className="alconfirmrow">
                  <span><b>Updates go to</b><small>{booking.guest.email}</small></span>
                </div>
              ) : null}
              {booking.guest?.phone ? (
                <div className="alconfirmrow">
                  <span><b>{item.title} can reach you on</b><small>{fmtPhone(booking.guest.phone)}</small></span>
                </div>
              ) : null}
            </section>

            <section className="alsec">
              <h2>What happens next</h2>
              <ol className="alsteps">
                {/* A guest who left the email box empty gets no mail, because there is nowhere to send it, and
                    telling them one is coming is how a declined request goes unheard. The arrival step is the
                    operator's own line or nothing: no shop asked us to tell their guests to come 15 minutes
                    early, so the numbering closes over the gap. */}
                {steps.map((text, i) => (
                  <li key={text}><span className="n">{i + 1}</span><span>{text}</span></li>
                ))}
              </ol>
            </section>

            <section className="alsec">
              <h2>Getting there</h2>
              <a className="alwhererow" href={contact ? mapsHref(contact, item.title + " " + item.area) : "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(item.title + " " + item.area)} target="_blank" rel="noreferrer">
                <Markup html={PIN} />
                <span><b>{address || item.area}</b><small>Get directions</small></span>
              </a>
              {callHref && contact?.phone ? (
                <a className="alwhererow alconfirmgap" href={callHref}>
                  <Markup html={PHONE} />
                  <span><b>{fmtPhone(contact.phone)}</b><small>Running late? Call the shop</small></span>
                </a>
              ) : null}
            </section>

            <div className="alconfirmactions">
              <button type="button" className="alprimary" onClick={onDone}>Find another experience</button>
              <button type="button" className="aloutline" onClick={() => onOpen(item.id)}>View the listing</button>
            </div>
          </div>

          <aside className="alconfirmaside">
            <div className="alreserve alconfirmcard">
              <div className="alconfirmitem">
                <div className="alconfirmart">
                  <Photo src={item.cover || item.photos?.[0]} kind={item.art} id={"cf" + item.id} alt={item.title} />
                </div>
                <span>
                  <b>{item.title}</b>
                  <small>{item.area}</small>
                  {score ? <small className="alconfirmrate"><Markup html={STAR} /> <b>{score.rating.toFixed(1)}</b> ({fmtReviews(score.reviews)})</small> : null}
                </span>
              </div>
              <div className="alconfirmprice">
                <h3>Price details</h3>
                {lines && picked ? (
                  <div className="allines alconfirmlines">
                    <div className="alline"><span className="wrap">{perPerson(picked) && picked.price != null ? money(picked.price) + " × " + booking.qty + (booking.qty === 1 ? " guest" : " guests") : tidyName(picked.name)}</span><span>{money(lines.base)}</span></div>
                    {addonRows.map((a) => <div className="alline" key={a.name}><span className="wrap">{a.name}</span><span>{money(addonPrice(a))}</span></div>)}
                    {lines.fee ? <div className="alline"><span className="wrap">{serviceFeeLabel(lines)}</span><span>{money(lines.fee)}</span></div> : null}
                  </div>
                ) : picked ? (
                  <div className="alline"><span className="wrap">{tidyName(picked.name)}</span><span>{booking.qty} {booking.qty === 1 ? "guest" : "guests"}</span></div>
                ) : null}
                <div className="alline total">
                  <span>{booking.paid ? (instant ? "Paid by card" : "Held on your card") : "Total"}</span>
                  <span>{booking.total ? money(booking.total) : "Pay on site"}</span>
                </div>
                <p className="alfine">{booking.paid ? (instant ? "Charged to your card." : "Charged only when " + item.title + " confirms.") : instant ? "Pay as agreed with the business." : "You won't be charged until " + item.title + " confirms."}</p>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
