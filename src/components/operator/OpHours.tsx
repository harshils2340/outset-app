import { useState } from "react";
import { fmtTime } from "../../lib/format";
import { DAY_NAMES, isoToDate, relDay, timeOptions, type DayHours } from "../../lib/operator";
import { Markup } from "../Markup";
import { OD_ICONS, useOp } from "./opContext";

const TIMES = timeOptions(30);

/** Availability: weekly hours, slot length, notice, booking window and days off. Booksy's working hours screen. */
export function OpHours() {
  const { p, set, toast } = useOp();
  const [newOff, setNewOff] = useState("");

  const patchDay = (i: number, patch: Partial<DayHours>) => set((cur) => ({ ...cur, hours: cur.hours.map((h, j) => (j === i ? { ...h, ...patch } : h)) }));
  // Copying a closed row would close the whole week, so that one asks for a second click.
  const [armed, setArmed] = useState<number | null>(null);
  const copyToAll = (i: number) => {
    const src = p.hours[i];
    if (src.closed && armed !== i) {
      setArmed(i);
      toast("Tap again to close every day");
      window.setTimeout(() => setArmed((a) => (a === i ? null : a)), 4000);
      return;
    }
    setArmed(null);
    set({ hours: p.hours.map(() => ({ ...src })) });
    toast(src.closed ? "Closed every day" : "Applied to every day");
  };

  return (
    <div className="odpage">
      <div className="odcols">
        <section className="odcard">
          <div className="odcardhead"><h3>Opening hours</h3></div>
          <p className="odmuted">Guests can only pick times inside these hours. {p.hours.every((h) => !h.closed && h.open === "09:00" && h.close === "17:00") ? "We couldn't read hours from your site, so these are a placeholder. Fix them." : "Copied from your website."}</p>
          <div className="odhours">
            {p.hours.map((h, i) => (
              <div className={"odhour" + (h.closed ? " closed" : "")} key={i}>
                <b>{DAY_NAMES[i]}</b>
                <button type="button" className={"optoggle small" + (h.closed ? "" : " on")} onClick={() => patchDay(i, { closed: !h.closed })} aria-pressed={!h.closed}><span className="knob" /></button>
                {h.closed ? (
                  <span className="odmuted">Closed</span>
                ) : (
                  <span className="odtimes">
                    <select value={h.open} onChange={(e) => patchDay(i, { open: e.target.value })}>{TIMES.map((t) => <option key={t} value={t}>{fmtTime(t)}</option>)}</select>
                    <span>to</span>
                    <select value={h.close} onChange={(e) => patchDay(i, { close: e.target.value })}>{TIMES.filter((t) => t > h.open).map((t) => <option key={t} value={t}>{fmtTime(t)}</option>)}</select>
                  </span>
                )}
                <button type="button" className={"odlink tiny" + (armed === i ? " danger" : "")} onClick={() => copyToAll(i)}>{armed === i ? "Close every day?" : "Apply to all"}</button>
              </div>
            ))}
          </div>
        </section>

        <div className="odstack">
          <section className="odcard">
            <div className="odcardhead"><h3>Booking rules</h3></div>
            <label className="odfield row"><span>Time between start times</span>
              <select value={p.slotMinutes} onChange={(e) => set({ slotMinutes: Number(e.target.value) })}>
                {[15, 30, 45, 60, 90, 120, 180, 240].map((m) => <option key={m} value={m}>{m < 60 ? m + " min" : m / 60 + (m === 60 ? " hour" : " hours")}</option>)}
              </select>
            </label>
            <label className="odfield row"><span>Minimum notice</span>
              <select value={p.leadHours} onChange={(e) => set({ leadHours: Number(e.target.value) })}>
                {[0, 1, 2, 4, 12, 24, 48, 72].map((h) => <option key={h} value={h}>{h === 0 ? "None" : h < 24 ? h + (h === 1 ? " hour" : " hours") : h / 24 + (h === 24 ? " day" : " days")}</option>)}
              </select>
            </label>
            <label className="odfield row"><span>How far ahead guests can book</span>
              <select value={p.windowDays} onChange={(e) => set({ windowDays: Number(e.target.value) })}>
                {[7, 14, 30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>{d < 30 ? d + " days" : d < 365 ? Math.round(d / 30) + " months" : "1 year"}</option>)}
              </select>
            </label>
            <p className="odfine">Capacity per slot is set on each service under Services.</p>
          </section>

          <section className="odcard">
            <div className="odcardhead"><h3>Days off</h3></div>
            <p className="odmuted">Holidays, maintenance, weather days. Guests can't book these dates.</p>
            <div className="odaddoff">
              <input type="date" value={newOff} onChange={(e) => setNewOff(e.target.value)} />
              <button type="button" className="cta small" disabled={!newOff} onClick={() => { if (!p.blockedDates.includes(newOff)) set({ blockedDates: [...p.blockedDates, newOff].sort() }); setNewOff(""); }}><Markup html={OD_ICONS.plus} /> Add</button>
            </div>
            {p.blockedDates.length === 0 ? <p className="odfine">No days off scheduled.</p> : null}
            {p.blockedDates.map((d) => (
              <div className="odline" key={d}>
                <span className="meta"><b>{isoToDate(d).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</b><small>{relDay(d)}</small></span>
                <button type="button" className="odiconbtn" onClick={() => set({ blockedDates: p.blockedDates.filter((x) => x !== d) })} aria-label="Remove"><Markup html={OD_ICONS.trash} /></button>
              </div>
            ))}
            {p.blockedSlots.length ? <p className="odfine">{p.blockedSlots.length} single {p.blockedSlots.length === 1 ? "slot is" : "slots are"} blocked from the calendar. <button type="button" className="odlink tiny" onClick={() => set({ blockedSlots: [] })}>Clear them</button></p> : null}
          </section>
        </div>
      </div>
    </div>
  );
}
