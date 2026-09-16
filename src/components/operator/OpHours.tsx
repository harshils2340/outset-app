import { useState } from "react";
import { dateKey, startOfToday } from "../../lib/dates";
import { fmtTime } from "../../lib/format";
import { DAY_NAMES, LATEST_WRAP, hoursAreDefault, hoursRun, isoToDate, minutesOfDay, relDay, timeOptions, type DayHours } from "../../lib/operator";
import { Markup } from "../Markup";
import { OD_ICONS, useOp } from "./opContext";

const TIMES = timeOptions(30);

/**
 * The half hour grid with one more entry when the shop's own time is not on it. Hours are read off the
 * operator's website, which is under no obligation to use half hours: a shop open "8:45am to 5:15pm" had a
 * time in neither select, so both sat blank and the row said nothing about the hours actually saved.
 */
function withTime(list: string[], t: string): string[] {
  return list.includes(t) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t || "") ? list : [...list, t].sort();
}

/** Availability: weekly hours, slot length, notice, booking window and days off. Booksy's working hours screen. */
export function OpHours() {
  const { p, set, toast, bookings } = useOp();
  const [newOff, setNewOff] = useState("");

  const patchDay = (i: number, patch: Partial<DayHours>) => set((cur) => ({ ...cur, hours: cur.hours.map((h, j) => (j === i ? { ...h, ...patch } : h)) }));
  // Moving the opening time past the closing time leaves a day that opens and never closes. It used to save
  // anyway, and the day then offered guests no start time at all while the closing select sat blank. The
  // closing time follows the opening one out of the way unless the shop really does close after midnight.
  const patchOpen = (i: number, open: string) => {
    const h = p.hours[i];
    if (hoursRun({ ...h, open })) return patchDay(i, { open });
    // Opening at 11:30 PM has no later time on the grid. The old fallback saved 11:30 to 11:30, a day that
    // opens and closes in the same minute and offers nothing; midnight is the next half hour.
    patchDay(i, { open, close: TIMES.find((t) => t > open) || "00:00" });
  };
  // Bookings a guest holds on one date. Taking that date off does not cancel them, so the owner is told.
  const heldOn = (d: string) => bookings.filter((b) => b.date === d && (b.status === "accepted" || b.status === "new")).length;
  const todayKey = dateKey(startOfToday());
  const addOff = () => {
    const d = newOff;
    setNewOff("");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    // The picker let any date through, and a day already gone sat in the list as "Yesterday" doing nothing.
    if (d < todayKey) return toast("That day has already passed");
    if (p.blockedDates.includes(d)) return toast("Already a day off");
    set({ blockedDates: [...p.blockedDates, d].sort() });
    const held = heldOn(d);
    toast(held ? `Day off added. ${held} booking${held === 1 ? "" : "s"} that day still stand${held === 1 ? "s" : ""}; cancel ${held === 1 ? "it" : "them"} under Bookings.` : "Day off added");
  };
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
        <section className="odcard" data-jump="hours">
          <div className="odcardhead"><h3>Opening hours</h3></div>
          <p className="odmuted">Guests can only pick times inside these hours. {hoursAreDefault(p) ? "We couldn't find your hours on your website, so we started you at 9 to 5 every day. Set your real hours before a guest books a time you're closed." : "Copied from your website. Change any day that is off."}</p>
          {hoursAreDefault(p) && !p.hoursConfirmed ? (
            <div className="odbanner soft">
              <span>Open 9 to 5 every day?</span>
              <button type="button" className="odlink" onClick={() => { set({ hoursConfirmed: true }); toast("Hours confirmed"); }}>Yes, these are right</button>
            </div>
          ) : null}
          <div className="odhours">
            {p.hours.map((h, i) => (
              <div className={"odhour" + (h.closed ? " closed" : "")} key={i}>
                <b>{DAY_NAMES[i]}</b>
                {/* The two selects beside it say which day they belong to; this switch said nothing at all, so a
                    screen reader read seven identical "button, pressed" rows with no way to tell Sunday from Monday. */}
                <button type="button" className={"optoggle small" + (h.closed ? "" : " on")} onClick={() => patchDay(i, { closed: !h.closed })} aria-pressed={!h.closed} aria-label={"Open on " + DAY_NAMES[i]}><span className="knob" /></button>
                {h.closed ? (
                  <span className="odmuted">Closed</span>
                ) : (
                  <span className="odtimes">
                    <select value={h.open} aria-label={DAY_NAMES[i] + " opening time"} onChange={(e) => patchOpen(i, e.target.value)}>{withTime(TIMES, h.open).map((t) => <option key={t} value={t}>{fmtTime(t)}</option>)}</select>
                    <span>to</span>
                    {/* A shop open until midnight or later stores a closing time at or before its opening one,
                        which is what the scrape reads off "10am to 12am". With only the later times listed, that
                        day's own closing time was in no option at all, so the select sat blank on hours the shop
                        really keeps. The late ones are listed and marked as the next day. */}
                    <select value={h.close} aria-label={DAY_NAMES[i] + " closing time"} onChange={(e) => patchDay(i, { close: e.target.value })}>
                      {withTime(TIMES, h.close).filter((t) => t > h.open).map((t) => <option key={t} value={t}>{fmtTime(t)}</option>)}
                      {withTime(TIMES, h.close).filter((t) => t < h.open && minutesOfDay(t) <= LATEST_WRAP).map((t) => <option key={t} value={t}>{fmtTime(t)}, next day</option>)}
                      {/* An inverted day ("6pm to 5pm", from a scrape or a slip) keeps a close that is in neither
                          list, and the select then showed its first option, 6:30 PM, over a row whose warning
                          said the hours end before they start. Show the time actually saved, named for what it is. */}
                      {!hoursRun(h) && h.close <= h.open && /^([01]\d|2[0-3]):[0-5]\d$/.test(h.close) && minutesOfDay(h.close) > LATEST_WRAP ? <option value={h.close}>{fmtTime(h.close)} ({h.close === h.open ? "same as opening" : "before opening"})</option> : null}
                    </select>
                    {/* A day that opens and never closes offers guests nothing, and the only sign of it used to
                        be an empty picker on the listing. Say it where the hours are set. */}
                    {hoursRun(h) ? null : <small className="odwarn">These hours end before they start, so guests see no times on {DAY_NAMES[i]}.</small>}
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
                {[7, 14, 30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>{d < 30 ? d + " days" : d < 365 ? Math.round(d / 30) + (d < 60 ? " month" : " months") : "1 year"}</option>)}
              </select>
            </label>
            <p className="odfine">Capacity per slot is set on each service under Services.</p>
          </section>

          <section className="odcard">
            <div className="odcardhead"><h3>Days off</h3></div>
            <p className="odmuted">Holidays, maintenance, weather days. Guests can't book these dates.</p>
            <div className="odaddoff">
              <input type="date" aria-label="Date to take off" value={newOff} min={todayKey} onChange={(e) => setNewOff(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newOff) { e.preventDefault(); addOff(); } }} />
              <button type="button" className="cta small" disabled={!newOff} onClick={addOff}><Markup html={OD_ICONS.plus} /> Add</button>
            </div>
            {p.blockedDates.length === 0 ? <p className="odfine">No days off scheduled.</p> : null}
            {p.blockedDates.map((d) => (
              <div className="odline" key={d}>
                {/* A day off next year read "Wednesday, December 25" with nothing to say which December. */}
                <span className="meta"><b>{isoToDate(d).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: d.slice(0, 4) === todayKey.slice(0, 4) ? undefined : "numeric" })}</b><small>{relDay(d)}{heldOn(d) ? " · " + heldOn(d) + (heldOn(d) === 1 ? " booking" : " bookings") + " still on" : ""}</small></span>
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
