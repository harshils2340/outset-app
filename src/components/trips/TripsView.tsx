import { useEffect, useState } from "react";
import { LISTINGS } from "../../data/listings";
import { ICONS } from "../../data/icons";
import { bookingStatus, hasApi } from "../../lib/api";
import { startOfToday, dateKey } from "../../lib/dates";
import { experienceById, stillArriving } from "../../lib/catalog";
import { fmtDate, fmtTime } from "../../lib/format";
import { loadProfile } from "../../lib/operator";
import { useApp } from "../../state/AppProvider";
import { Art } from "../art/Art";
import { Markup } from "../Markup";

/**
 * What the operator did with a booking, as the guest should read it. A request the operator declined used to
 * sit here looking exactly like a confirmed trip: a title, a time, a party and a code, for a day the shop was
 * not expecting anyone. The guest's device only ever knew it had sent the booking, so the answer is read back
 * from the API.
 */
const STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: "Payment not finished", tone: "var(--few)" },
  new: { label: "Waiting on the operator", tone: "var(--ink)" },
  accepted: { label: "Confirmed", tone: "var(--open)" },
  completed: { label: "Confirmed", tone: "var(--open)" },
  declined: { label: "Not available", tone: "var(--few)" },
  cancelled: { label: "Cancelled", tone: "var(--few)" },
};

/**
 * Answers already read, so flipping between tabs does not ask the API the same question again. A booking it
 * has no answer for (one of the hand-built listings, or the API being down) is remembered as an empty answer,
 * because the route a guest may call is rate limited and asking again every time the tab opens spends it.
 */
const answered: Record<string, string> = {};

export function TripsView() {
  const { state, openListing, openRequest } = useApp();
  const today = startOfToday();
  const mine = state.bookings.slice().sort((a, b) => (a.date + a.slot).localeCompare(b.date + b.slot));
  const up = mine.filter((b) => b.date >= dateKey(today));
  const [status, setStatus] = useState<Record<string, string>>(() => ({ ...answered }));
  const codes = up.map((b) => b.code).join(",");
  /* Bookings come straight out of localStorage; the listing each one names is looked up in a catalog fetched
     after the first paint. Every trip whose operator had not landed yet rendered as null, so a guest opening
     this tab on a cold start saw "Trips" over a blank page instead of the trip they booked. */
  const resolved = up.filter((b) => LISTINGS.some((x) => x.id === b.listing) || experienceById(b.listing)).length;
  const pending = stillArriving(up.length - resolved, resolved, state.catalogComplete);

  // Every answer is re-asked when the tab comes back into focus, so an operator's accept in another tab (or
  // on their phone) shows here without a reload. The first pass still reads from the cache.
  const [pass, setPass] = useState(0);
  useEffect(() => {
    const onFocus = () => setPass((n) => n + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    if (!up.length) return;
    if (!hasApi()) {
      // No API on this host: the operator's dashboard lives in this same browser, and its decisions are in the
      // profile it saves. Without this the guest saw no answer at all after the operator accepted or declined.
      const next: Record<string, string> = {};
      for (const b of up) {
        const p = loadProfile(b.listing);
        const d = p?.decisions[b.code] || (p?.instantBook ? "accepted" : "");
        if (d) next[b.code] = d;
      }
      setStatus((cur) => ({ ...cur, ...next }));
      return;
    }
    let alive = true;
    void (async () => {
      for (const b of up) {
        if (pass === 0 && b.code in answered) continue;
        // A booking the operator already settled does not change again; only open ones are re-asked.
        if (pass > 0 && ["declined", "cancelled", "completed"].includes(answered[b.code] || "")) continue;
        const s = await bookingStatus(b.listing, b.code);
        answered[b.code] = s || "";
        if (!alive) return;
        if (s) setStatus((cur) => ({ ...cur, [b.code]: s }));
      }
    })();
    return () => {
      alive = false;
    };
  }, [codes, pass]);

  return (
    <>
      <div className="apphead">
        <h2 className="sec">Trips</h2>
      </div>
      {pending ? (
        <div className="empty">
          <div className="glyph">
            <Markup html={ICONS.ticket} />
          </div>
          <b>Loading your {up.length === 1 ? "trip" : up.length + " trips"}</b>
          <p>One moment while we look them up.</p>
        </div>
      ) : up.length ? (
        <div className="cards">
          {up.map((b) => {
            const l = LISTINGS.find((x) => x.id === b.listing);
            const u = experienceById(b.listing);
            const d = new Date(b.date + "T00:00:00");
            // A trip whose listing the catalog no longer carries is still a trip: the shop is expecting them,
            // the code is in their email, and the money is spent. It used to render as null, so a confirmed
            // booking simply vanished from the tab a guest opens to check it. What the booking itself stored
            // carries the card instead, and there is nowhere to send a press.
            const title = l ? l.title : u ? u.title : b.service || "Your booking";
            const art = l ? l.art : u ? u.art : "generic";
            const sub = l ? l.op + " · " + l.launch : u ? u.area : "Details are in your confirmation email";
            const st = STATUS[status[b.code]] || null;
            const open = l ? () => openListing(l.id) : u ? () => openRequest(u.id) : null;
            const inner = (
              <>
                <span className="thumb">
                  <Art kind={art} id={(l ? l.id : u ? u.id : b.listing) + "t" + b.code} />
                </span>
                <span className="info">
                  <b>{title}</b>
                  <small>{sub}</small>
                  <span className="when">
                    {fmtDate(d)} · {fmtTime(b.slot)} · {b.qty} {b.qty === 1 ? "person" : "people"}
                  </span>
                  {st ? <span className="agentpill" style={{ marginTop: 6, color: st.tone }}>{st.label}</span> : null}
                </span>
                <span className="mono" style={{ fontSize: 11, color: "var(--ink-faint)", alignSelf: "center" }}>
                  {b.code}
                </span>
              </>
            );
            // A card with no page behind it is not a button: a disabled one greys a confirmed trip, and an
            // enabled one takes a press nowhere.
            return open ? (
              <button className="trip" key={b.code} onClick={open}>
                {inner}
              </button>
            ) : (
              <div className="trip" key={b.code}>
                {inner}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty">
          <div className="glyph">
            <Markup html={ICONS.ticket} />
          </div>
          {/* A guest whose trips have all been and gone has booked, so "no trips booked yet" was simply wrong. */}
          <b>{mine.length ? "Nothing coming up" : "No trips booked yet"}</b>
          <p>{mine.length ? "Your past trips stay in the confirmation emails. Book again and it shows here." : "When you book, the confirmation lives here."}</p>
        </div>
      )}
      <div className="spacer" />
    </>
  );
}
