import { ICONS } from "../../data/icons";
import { loadGuest } from "../../lib/storage";
import { useApp } from "../../state/AppProvider";
import { Markup } from "../Markup";

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
        <div className="hostcard" role="button" tabIndex={0} onClick={() => openOperator()} style={{ cursor: "pointer" }}>
          <h3>Run an experience?</h3>
          <p>See requests, your schedule and your menu the way operators do.</p>
          <span className="go">
            List your business <Markup html={ICONS.arrow} />
          </span>
        </div>
        <div className="menu">
          <button>
            <Markup html={ICONS.ticket} />
            Payments
            <span className="arrow">
              <Markup html={ICONS.arrow} />
            </span>
          </button>
          <button>
            <Markup html={ICONS.user} />
            Riders &amp; waivers
            <span className="arrow">
              <Markup html={ICONS.arrow} />
            </span>
          </button>
          <button>
            <Markup html={ICONS.pin} />
            Saved areas
            <span className="arrow">
              <Markup html={ICONS.arrow} />
            </span>
          </button>
          <button>
            <Markup html={ICONS.chat} />
            Help
            <span className="arrow">
              <Markup html={ICONS.arrow} />
            </span>
          </button>
        </div>
      </div>
      <div className="spacer" />
    </>
  );
}
