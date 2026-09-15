import { ICONS } from "../../data/icons";
import { loadGuest } from "../../lib/storage";
import { useApp } from "../../state/AppProvider";
import { Markup } from "../Markup";

const SOON = [
  { icon: ICONS.ticket, label: "Payments" },
  { icon: ICONS.user, label: "Riders & waivers" },
  { icon: ICONS.pin, label: "Saved areas" },
  { icon: ICONS.chat, label: "Help" },
];

export function AccountView() {
  const { state, openOperator } = useApp();
  const n = state.bookings.length;
  // Every guest's Profile tab was headed "Harshil", the founder's own name, left over from the first build of
  // this screen. The booking form already remembers who booked on this device; when nobody has, the tab is
  // simply the tab.
  const first = (loadGuest().name || "").trim().split(/\s+/)[0];
  return (
    <>
      <div className="apphead">
        <h2 className="sec">{first || "Profile"}</h2>
      </div>
      <div className="acct">
        <div className="acctcard">
          <div className="rowbetween">
            <span style={{ fontSize: 14, color: "var(--ink-soft)" }}>Trips booked</span>
            <b className="mono" style={{ fontSize: 16 }}>
              {n}
            </b>
          </div>
          <div className="rowbetween" style={{ marginTop: 10 }}>
            <span style={{ fontSize: 14, color: "var(--ink-soft)" }}>Time not spent on hold</span>
            <b className="mono" style={{ fontSize: 16 }}>
              {n * 11} min
            </b>
          </div>
        </div>
        {/* role="button" and a tab stop with nothing listening for a key press: focus reached this card and
            neither Enter nor Space opened it. */}
        <div
          className="hostcard"
          role="button"
          tabIndex={0}
          onClick={() => openOperator()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openOperator();
            }
          }}
          style={{ cursor: "pointer" }}
        >
          <h3>Run an experience?</h3>
          <p>See requests, your schedule and your menu the way operators do.</p>
          <span className="go">
            List your business <Markup html={ICONS.arrow} />
          </span>
        </div>
        {/* Four rows that looked like the rest of the app and did nothing at all: a guest pressed Help and the
            screen did not move. None of them is built. They say so rather than swallowing the press, the way
            the operator dashboard says so where payments and calendar sync are not built either. */}
        <div className="menu">
          {SOON.map(({ icon, label }) => (
            <button type="button" key={label} disabled aria-label={label + ", not built yet"}>
              <Markup html={icon} />
              {label}
              <span className="arrow soon">Not yet</span>
            </button>
          ))}
        </div>
        <p className="note">Card payments, waivers and saved areas are on the way. For anything now, message the operator from your trip.</p>
      </div>
      <div className="spacer" />
    </>
  );
}
