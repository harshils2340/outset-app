import { useMemo, useState } from "react";
import { dateKey, startOfToday } from "../../lib/dates";
import { fmtTime, money } from "../../lib/format";
import { DAY_SHORT, bookingTotal, slotsForDay } from "../../lib/operator";
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

  // Rows: every slot start across the open hours of the week, at the operator's slot interval.
  const rows = useMemo(() => {
    const all = new Set<string>();
    for (const d of days) for (const s of slotsForDay(p, d)) all.add(s);
    if (!all.size) for (const s of slotsForDay({ ...p, hours: p.hours.map(() => ({ closed: false, open: "09:00", close: "17:00" })) }, days[0])) all.add(s);
    return Array.from(all).sort();
  }, [days, p]);

  const byCell = useMemo(() => {
    const m = new Map<string, typeof bookings>();
    for (const b of bookings) {
      if (b.status === "declined" || b.status === "cancelled") continue;
      const k = b.date + "|" + b.slot;
      m.set(k, [...(m.get(k) || []), b]);
    }
    return m;
  }, [bookings]);

  const toggleBlock = (key: string) => {
    const on = p.blockedSlots.includes(key);
    set({ blockedSlots: on ? p.blockedSlots.filter((x) => x !== key) : [...p.blockedSlots, key] });
    toast(on ? "Slot reopened" : "Blocked as time off");
  };
  const toggleDay = (k: string) => {
    const on = p.blockedDates.includes(k);
    set({ blockedDates: on ? p.blockedDates.filter((x) => x !== k) : [...p.blockedDates, k] });
    toast(on ? "Day reopened" : "Day off added");
  };

  const label = compact
    ? anchor.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
    : days[0].toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " to " + days[6].toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const weekTotal = days.reduce((n, d) => n + bookings.filter((b) => b.date === dateKey(d) && (b.status === "accepted" || b.status === "completed")).reduce((m, b) => m + bookingTotal(b), 0), 0);

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
          <b>{money(weekTotal)} {compact ? "today" : "this week"}</b>
        </div>
      </div>
      <p className="odmuted odcalhint">Click an empty slot to block it as time off. Click a day name to take the whole day off.</p>

      <div className="odcalscroll">
        <div className="odcal" style={{ gridTemplateColumns: "64px repeat(" + days.length + ", minmax(" + (compact ? "0" : "120px") + ", 1fr))" }}>
          <div className="odcalcorner" />
          {days.map((d) => {
            const k = dateKey(d);
            const closed = p.hours[d.getDay()].closed || p.blockedDates.includes(k);
            const count = bookings.filter((b) => b.date === k && (b.status === "accepted" || b.status === "completed" || b.status === "new")).length;
            return (
              <button type="button" key={k} className={"odcalday" + (k === todayKey ? " today" : "") + (closed ? " closed" : "")} onClick={() => toggleDay(k)} title={closed ? "Reopen this day" : "Take this day off"}>
                <small>{DAY_SHORT[d.getDay()]}</small>
                <b>{d.getDate()}</b>
                <span>{closed ? "Off" : count ? count + (count === 1 ? " booking" : " bookings") : "Open"}</span>
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
        const h = p.hours[d.getDay()];
        const inHours = !h.closed && slotsForDay(p, d).includes(slot);
        const dayOff = p.blockedDates.includes(k);
        const blocked = p.blockedSlots.includes(key);
        const items = byCell.get(key) || [];
        if (!inHours || dayOff) return <div key={key} className="odcalcell closed" />;
        return (
          <div key={key} className={"odcalcell" + (blocked ? " blocked" : "")}>
            {items.map((b) => (
              <button type="button" key={b.id} className={"odevent " + b.status} onClick={() => open(b.id)}>
                <b>{b.guest}</b>
                <small>{b.qty} · {b.service}</small>
              </button>
            ))}
            {!items.length ? (
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
