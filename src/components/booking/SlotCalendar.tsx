import { useMemo, useState } from "react";
import { ICONS } from "../../data/icons";
import { dateKey, startOfToday } from "../../lib/dates";
import { fmtTime } from "../../lib/format";
import { Markup } from "../Markup";

const WEEK = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Month calendar beside the day's start times, the 21st.dev appointment picker shape.
 *
 * The app offers a fixed booking window (see DATES in AppProvider), so days outside it render greyed
 * rather than hidden: an owner-facing month still shows where the bookable days fall in the week without
 * pretending a date further out can be picked. Times are the operator's published start times. This does
 * not claim a day is full or has seats left, because the catalog does not carry live inventory.
 */
export type DayMeta = { open?: number; full?: boolean };
export type SlotMeta = { note?: string; disabled?: boolean; tone?: "few" | "gone" };

export function SlotCalendar({
  dates,
  dateIdx,
  onPickDate,
  slots,
  time,
  onPickTime,
  emptyNote = "No more start times today. Pick another day.",
  dayMeta,
  slotMeta,
}: {
  dates: Date[];
  dateIdx: number;
  onPickDate: (i: number) => void;
  slots: string[];
  time: string | null;
  onPickTime: (t: string) => void;
  emptyNote?: string;
  /** Live inventory for a bookable day. Only passed where the listing really has it. */
  dayMeta?: (d: Date) => DayMeta;
  /** Seats left on a start time, and whether it can still be picked. */
  slotMeta?: (t: string) => SlotMeta;
}) {
  const selected = dates[dateIdx];
  const [month, setMonth] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1));

  // Index every bookable day by its key so a grid cell can find its position in the window.
  const bookable = useMemo(() => {
    const m = new Map<string, number>();
    dates.forEach((d, i) => m.set(dateKey(d), i));
    return m;
  }, [dates]);

  // Only let the arrows reach months the window actually touches.
  const firstMonth = useMemo(() => new Date(dates[0].getFullYear(), dates[0].getMonth(), 1), [dates]);
  const lastMonth = useMemo(() => {
    const last = dates[dates.length - 1];
    return new Date(last.getFullYear(), last.getMonth(), 1);
  }, [dates]);
  const canPrev = month > firstMonth;
  const canNext = month < lastMonth;

  const todayKey = dateKey(startOfToday());
  const selectedKey = dateKey(selected);

  // Leading blanks so the first of the month lands under the right weekday.
  const cells = useMemo(() => {
    const start = new Date(month.getFullYear(), month.getMonth(), 1);
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const out: (Date | null)[] = Array.from({ length: start.getDay() }, () => null);
    for (let d = 1; d <= days; d++) out.push(new Date(month.getFullYear(), month.getMonth(), d));
    return out;
  }, [month]);

  const shift = (by: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + by, 1));

  return (
    <div className="slotcal">
      <div className="slotcalmonth">
        <div className="slotcalhead">
          <button type="button" onClick={() => shift(-1)} disabled={!canPrev} aria-label="Previous month">
            <Markup html={ICONS.back} />
          </button>
          <b>{MONTHS[month.getMonth()]} {month.getFullYear()}</b>
          <button type="button" onClick={() => shift(1)} disabled={!canNext} aria-label="Next month">
            <Markup html={ICONS.arrow} />
          </button>
        </div>
        <div className="slotcalweek">
          {WEEK.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
        <div className="slotcalgrid">
          {cells.map((d, i) => {
            if (!d) return <span key={"blank" + i} />;
            const k = dateKey(d);
            const idx = bookable.get(k);
            const open = idx !== undefined;
            const meta = open && dayMeta ? dayMeta(d) : null;
            const full = !!meta?.full;
            return (
              <button
                type="button"
                key={k}
                className={"slotcalday" + (k === selectedKey ? " on" : "") + (k === todayKey ? " today" : "") + (full ? " full" : "")}
                disabled={!open || full}
                aria-pressed={k === selectedKey}
                aria-label={open && meta?.open !== undefined ? d.getDate() + ", " + (full ? "booked out" : meta.open + " open") : undefined}
                onClick={() => open && !full && onPickDate(idx)}
              >
                {d.getDate()}
                {meta?.open ? <i /> : null}
              </button>
            );
          })}
        </div>
        <p className="slotcalnote">Bookable through {MONTHS[dates[dates.length - 1].getMonth()].slice(0, 3)} {dates[dates.length - 1].getDate()}.</p>
      </div>

      <div className="slotcaltimes">
        <p className="slotcaltitle">Start times</p>
        <div className="slotcallist">
          {slots.map((t) => {
            const m = slotMeta ? slotMeta(t) : null;
            return (
              <button
                type="button"
                key={t}
                className={"slotcaltime" + (m?.tone ? " " + m.tone : "")}
                aria-pressed={time === t}
                disabled={!!m?.disabled}
                onClick={() => onPickTime(t)}
              >
                <b>{fmtTime(t)}</b>
                {m?.note ? <small>{m.note}</small> : null}
              </button>
            );
          })}
          {slots.length === 0 ? <p className="slotcalempty">{emptyNote}</p> : null}
        </div>
      </div>
    </div>
  );
}
