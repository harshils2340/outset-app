import { useMemo, useState } from "react";
import { dateKey, startOfToday } from "../../lib/dates";
import { fmtTime, money } from "../../lib/format";
import { DAY_SHORT, payoutSum, slotsForDay } from "../../lib/operator";
import { Markup } from "../Markup";
import { OD_ICONS, useOp } from "./opContext";

/**
 * Booksy style calendar. Week view on desktop, day view in the phone frame. Bookings sit in their slot,
 * empty slots can be blocked as time off with one click, and closed days are shaded.
 */
export function OpCalendar() {
  const { p, bookings, compact, openBooking, set, toast } = useOp();
  const [anchor, setAnchor] = useState(() => startOfToday());
  const todayKey = dateKey(startOfToday());

  const days = useMemo(() => {
    if (compact) return [anchor];
    const start = new Date(anchor);
    start.setDate(start.getDate() - start.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [anchor, compact]);

  const move = (n: number) => {
    const d = new Date(anchor);
    d.setDate(d.getDate() + n * (compact ? 1 : 7));
    setAnchor(d);
  };

  const byCell = useMemo(() => {
    const m = new Map<string, typeof bookings>();
    for (const b of bookings) {
      if (b.status === "declined" || b.status === "cancelled") continue;
      const k = b.date + "|" + b.slot;
      m.set(k, [...(m.get(k) || []), b]);
    }
    return m;
  }, [bookings]);

  // Rows: every slot start across the open hours of the week, at the operator's slot interval, plus every time
  // a guest is already booked in. A booking has to keep its row even when the day was taken off or the hours
  // have moved since it was made: this is the page an owner reads to see who is turning up, and a row that is
  // not here is a guest they will not know about until the guest is standing in front of them.
  const rows = useMemo(() => {
    const all = new Set<string>();
    for (const d of days) for (const s of slotsForDay(p, d)) all.add(s);
    const shown = new Set(days.map(dateKey));
    for (const k of byCell.keys()) if (shown.has(k.slice(0, k.indexOf("|")))) all.add(k.slice(k.indexOf("|") + 1));
    if (!all.size) for (const s of slotsForDay({ ...p, hours: p.hours.map(() => ({ closed: false, open: "09:00", close: "17:00" })) }, days[0])) all.add(s);
    return Array.from(all).sort();
  }, [days, p, byCell]);

  const toggleBlock = (key: string) => {
    // Last week's empty slots took a click and turned into time off that nothing could ever use. Past cells
    // are drawn without the button, and this is the guard behind it.
    if (key.slice(0, 10) < todayKey) return;
    const on = p.blockedSlots.includes(key);
    set({ blockedSlots: on ? p.blockedSlots.filter((x) => x !== key) : [...p.blockedSlots, key] });
    toast(on ? "Slot reopened" : "Blocked as time off");
  };
  const toggleDay = (k: string) => {
    // Yesterday cannot be taken off. Past days stay as they were.
    if (k < todayKey) return;
    const on = p.blockedDates.includes(k);
    set({ blockedDates: on ? p.blockedDates.filter((x) => x !== k) : [...p.blockedDates, k] });
    // Taking a day off stops new bookings; the ones already on it stay, and the toast used to say nothing
    // about them, so an owner closing for a storm could think the guests had been told.
    const held = bookings.filter((b) => b.date === k && (b.status === "accepted" || b.status === "new")).length;
    toast(on ? "Day reopened" : held ? `Day off added. ${held} booking${held === 1 ? "" : "s"} that day still stand${held === 1 ? "s" : ""}; cancel ${held === 1 ? "it" : "them"} under Bookings.` : "Day off added");
  };

  // The week label carries its year once it leaves this one: "Dec 28 to Jan 3" said nothing about which January.
  const thisYear = startOfToday().getFullYear();
  const span = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.getFullYear() === thisYear ? undefined : "numeric" });
  const label = compact
    ? anchor.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: anchor.getFullYear() === thisYear ? undefined : "numeric" })
    : span(days[0]) + " to " + span(days[6]);

  // The operator's own money, after Outset's fee, the same number Home, Payouts and the booking email give.
  // This line summed guest totals, so the week the Home tile called $110.20 read $121 on the page that tile
  // links to. Sample rows are not money here either, and with none there is no figure to print.
  const weekTotal = payoutSum(days.flatMap((d) => bookings.filter((b) => b.date === dateKey(d) && (b.status === "accepted" || b.status === "completed"))));

  return (
    <div className="odpage odcalpage">
      <div className="odbar">
        <div className="odcalnav">
          <button type="button" className="odiconbtn" onClick={() => move(-1)} aria-label="Previous"><Markup html={OD_ICONS.back} /></button>
          <button type="button" className="odiconbtn" onClick={() => move(1)} aria-label="Next"><Markup html={OD_ICONS.chev} /></button>
          <button type="button" className="odghost" onClick={() => setAnchor(startOfToday())}>Today</button>
          <h2>{label}</h2>
        </div>
        <div className="odcallegend">
          <span><i className="bk" /> Booked</span>
          <span><i className="off" /> Time off</span>
          {weekTotal ? <b>{money(weekTotal)} {compact ? "today" : "this week"}</b> : null}
        </div>
      </div>
      <p className="odmuted odcalhint">Click an empty slot to block it as time off. Click a day name to take the whole day off.</p>

      <div className="odcalscroll">
        <div className="odcal" style={{ gridTemplateColumns: "64px repeat(" + days.length + ", minmax(" + (compact ? "0" : "120px") + ", 1fr))" }}>
          <div className="odcalcorner" />
          {days.map((d) => {
            const k = dateKey(d);
            // A day with no start times reads as off, whether that is the closed switch, a day off, or hours
            // that leave no room for one. A day whose own switch is off can still carry the late session of
            // the day before, and that is a day guests can book.
            const dayOff = p.blockedDates.includes(k);
            const closed = !slotsForDay(p, d).length || dayOff;
            const count = bookings.filter((b) => b.date === k && (b.status === "accepted" || b.status === "completed" || b.status === "new")).length;
            const past = k < todayKey;
            // "Reopen this day" on a day that is only shut because its hours leave no room promised the opposite
            // of what the click does, which is to take the day off. Only a day actually taken off reopens.
            return (
              <button type="button" key={k} data-k={k} className={"odcalday" + (k === todayKey ? " today" : "") + (closed ? " closed" : "") + (past ? " past" : "")} onClick={() => toggleDay(k)} disabled={past} title={past ? "Past day" : dayOff ? "Reopen this day" : "Take this day off"}>
                <small>{DAY_SHORT[d.getDay()]}</small>
                <b>{d.getDate()}</b>
                <span>{closed ? (count ? "Off · " + count : "Off") : count ? count + (count === 1 ? " booking" : " bookings") : "Open"}</span>
              </button>
            );
          })}
          {rows.map((slot) => (
            <CalRow key={slot} slot={slot} days={days} byCell={byCell} toggleBlock={toggleBlock} open={openBooking} />
          ))}
        </div>
      </div>
    </div>
  );
}

function CalRow({ slot, days, byCell, toggleBlock, open }: { slot: string; days: Date[]; byCell: Map<string, ReturnType<typeof useOp>["bookings"]>; toggleBlock: (k: string) => void; open: (id: string) => void }) {
  const { p } = useOp();
  return (
    <>
      <div className="odcaltime">{fmtTime(slot)}</div>
      {days.map((d) => {
        const k = dateKey(d);
        const key = k + "|" + slot;
        const inHours = slotsForDay(p, d).includes(slot);
        const dayOff = p.blockedDates.includes(k);
        const blocked = p.blockedSlots.includes(key);
        const items = byCell.get(key) || [];
        // A day off, or hours that no longer reach this time, closes the cell to new time off but never hides a
        // booking that is already in it.
        const shut = !inHours || dayOff;
        // A slot that has gone by cannot be taken off; the day header is already disabled for the same reason.
        const past = k < dateKey(startOfToday());
        if (shut && !items.length) return <div key={key} data-k={key} className="odcalcell closed" />;
        return (
          <div key={key} data-k={key} className={"odcalcell" + (shut ? " closed" : "") + (blocked ? " blocked" : "") + (past ? " past" : "")}>
            {items.map((b) => (
              <button type="button" key={b.id} className={"odevent " + b.status} onClick={() => open(b.id)}>
                <b>{b.guest}</b>
                <small>{b.qty} · {b.service}</small>
              </button>
            ))}
            {!items.length && !shut && !past ? (
              <button type="button" className="odcalfill" onClick={() => toggleBlock(key)} aria-label={blocked ? "Reopen slot" : "Block slot"}>
                {blocked ? "Time off" : ""}
              </button>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
