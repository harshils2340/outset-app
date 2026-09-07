import { ICONS } from "../../data/icons";
import { useApp } from "../../state/AppProvider";
import { Markup } from "../Markup";

export function AccountView() {
  const { state } = useApp();
  const n = state.bookings.length;
  return (
    <>
      <div className="apphead">
        <p className="eyebrow">Account</p>
        <h2 className="sec" style={{ fontSize: 24 }}>
          Harshil
        </h2>
      </div>
      <div className="acct">
        <div className="acctcard">
          <div className="rowbetween">
            <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>Trips booked</span>
            <b className="mono" style={{ fontSize: 18 }}>
              {n}
            </b>
          </div>
          <div className="rowbetween" style={{ marginTop: 9 }}>
            <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>Saved vs. calling around</span>
            <b className="mono" style={{ fontSize: 18, color: "var(--open)" }}>
              {n * 11} min
            </b>
          </div>
        </div>
        <div className="hostcard">
          <h3>Run an experience business?</h3>
          <p>
            Rentals, tours, lanes, jumps, rooms: post your inventory once. Outset&apos;s agent answers every question,
            quotes real availability, and books the slot, even at 11 PM on a Sunday.
          </p>
          <span className="go">
            List your business <Markup html={ICONS.arrow} />
          </span>
        </div>
        <div className="menu">
          <button>
            <Markup html={ICONS.ticket} />
            Payment methods
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
            Saved locations
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
