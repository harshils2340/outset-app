import { useEffect, useState } from "react";
import { dateKey, startOfToday } from "../../lib/dates";
import { fmtTime, money } from "../../lib/format";
import { DAY_SHORT, completedLately, onTheBooks, payoutSum, setupChecks, weekAheadLine } from "../../lib/operator";
import type { OpBooking } from "../../lib/operator";
import { Markup } from "../Markup";
import { OD_ICONS, useOp } from "./opContext";
import { BookingRow } from "./OpBookings";

type Tab = "action" | "today" | "upcoming";

/**
 * Home is the Airbnb host "Today" tab with the Uber Eats merchant home's one job: whatever needs a decision is
 * the biggest thing on the screen, with Accept and Decline right there. Then today's schedule, then the week.
 * Money shows as one quiet line once there is any, and the setup checklist sits last, until it is finished.
 */
export function OpHome() {
  const { p, bookings, go, set, compact, preview, jump } = useOp();
  const todayKey = dateKey(startOfToday());
  const bySlot = (a: OpBooking, b: OpBooking) => a.date.localeCompare(b.date) || a.slot.localeCompare(b.slot);
  const fresh = bookings.filter((b) => b.status === "new").sort(bySlot);
  const today = bookings.filter((b) => b.date === todayKey && (b.status === "accepted" || b.status === "completed")).sort(bySlot);
  const weekEnd = (() => {
    const d = new Date(startOfToday());
    d.setDate(d.getDate() + 7);
    return dateKey(d);
  })();
  const upcoming = bookings.filter((b) => b.date > todayKey && b.date < weekEnd && b.status === "accepted").sort(bySlot);
  const later = bookings.filter((b) => b.date >= weekEnd && b.status === "accepted").length;
  // Money on this page is the operator's own, after Outset's fee, which is the number their booking email and
  // the Payouts page give. A booking's total is what the guest paid, and it carries the guest's service fee.
  // Summing those instead read "$122 on the books" for a trip the email promised $110.20 for.
  const week = onTheBooks(bookings);
  const month = completedLately(bookings);
  const weekTotal = payoutSum(week);
  const monthTotal = payoutSum(month);
  const nextToday = today.find((b) => b.slot >= new Date().toTimeString().slice(0, 5)) || null;
  const checks = setupChecks(p);
  const done = checks.filter((c) => c.done).length;
  // Judged on what is on screen: once a real booking hides the samples, the "rows marked Sample" note went on showing.
  const hasSamples = bookings.some((b) => b.source === "sample");
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  // Open on whatever needs the operator first; follow a request arriving or being answered.
  const wanted: Tab = fresh.length ? "action" : today.length ? "today" : "upcoming";
  const [tab, setTab] = useState<Tab>(wanted);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched) setTab(wanted);
  }, [wanted, touched]);
  const pick = (t: Tab) => {
    setTab(t);
    setTouched(true);
  };

  const line = fresh.length
    ? `${fresh.length} ${fresh.length === 1 ? "request is" : "requests are"} waiting for your answer.`
    : today.length
      ? `${today.length} ${today.length === 1 ? "booking" : "bookings"} today${nextToday ? `, next at ${fmtTime(nextToday.slot)}` : ""}.`
      : upcoming.length
        ? `Nothing today. ${upcoming.length} ${upcoming.length === 1 ? "booking" : "bookings"} in the next 7 days.`
        : "Nothing waiting on you.";

  // Upcoming, grouped by day so a week reads as a short list, not seven boxes.
  const days = new Map<string, OpBooking[]>();
  for (const b of upcoming) days.set(b.date, [...(days.get(b.date) || []), b]);
  // This tab lists confirmed bookings only, so "Your calendar is open" was told to a shop with five requests
  // waiting in that very week, two lines under a Needs action badge reading 5, and to a shop whose next
  // booking is eight days out. Say what is actually there.
  const freshSoon = fresh.filter((b) => b.date >= todayKey && b.date < weekEnd).length;
  const emptyWeek = weekAheadLine(freshSoon, later);

  // A day's line carries the operator's share too, and only when there is one: a day of quotes, or a demo's
  // sample rows, printed a flat "$0" beside two real bookings.
  const dayMoney = (items: OpBooking[]) => {
    const m = payoutSum(items);
    return m ? " · " + money(m) : "";
  };
  const dayLabel = (k: string) => {
    const d = new Date(k + "T12:00:00");
    const diff = Math.round((d.getTime() - startOfToday().getTime()) / 86400000);
    return (diff === 1 ? "Tomorrow" : DAY_SHORT[d.getDay()]) + " " + d.getDate();
  };

  return (
    <div className="odpage odhome">
      <div className="odhello">
        <h2>{hello}{p.ownerName ? ", " + p.ownerName.split(" ")[0] : ""}.</h2>
        <p>{line}</p>
      </div>

      {!p.published ? (
        <div className="odbanner warn">
          <b>Your listing is hidden.</b> Guests can't find you on Outset right now.
          <button type="button" className="odlink" onClick={() => set({ published: true })}>Publish it</button>
        </div>
      ) : !p.accepting ? (
        <div className="odbanner">
          <b>You're paused.</b> The listing stays up, but guests can't pick a time until you switch Accepting back on.
          <button type="button" className="odlink" onClick={() => set({ accepting: true })}>Resume</button>
        </div>
      ) : null}

      <section className="odcard ohfeed">
        <div className="ohtabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "action"} className={"ohtab" + (tab === "action" ? " on" : "") + (fresh.length ? " hot" : "")} onClick={() => pick("action")}>
            Needs action{fresh.length ? <i>{fresh.length}</i> : null}
          </button>
          <button type="button" role="tab" aria-selected={tab === "today"} className={"ohtab" + (tab === "today" ? " on" : "")} onClick={() => pick("today")}>
            Today{today.length ? <i>{today.length}</i> : null}
          </button>
          <button type="button" role="tab" aria-selected={tab === "upcoming"} className={"ohtab" + (tab === "upcoming" ? " on" : "")} onClick={() => pick("upcoming")}>
            Next 7 days{upcoming.length ? <i>{upcoming.length}</i> : null}
          </button>
          <button type="button" className="odlink" onClick={() => go(tab === "action" ? "bookings" : "calendar")}>
            {tab === "action" ? "All requests" : "Calendar"} <Markup html={OD_ICONS.chev} />
          </button>
        </div>

        {tab === "action" ? (
          fresh.length ? (
            <div className="ohlist">
              {fresh.map((b) => <BookingRow key={b.id} b={b} actions />)}
            </div>
          ) : (
            <p className="ohempty">
              <Markup html={OD_ICONS.check} />
              {p.instantBook ? "All answered. Instant Book is on, so most bookings confirm on their own." : "All answered. New requests land here the moment a guest taps Book."}
            </p>
          )
        ) : null}

        {tab === "today" ? (
          today.length ? (
            <div className="ohlist">
              {today.map((b) => <BookingRow key={b.id} b={b} />)}
            </div>
          ) : (
            <p className="ohempty"><Markup html={OD_ICONS.calendar} />Nothing on today's schedule.</p>
          )
        ) : null}

        {tab === "upcoming" ? (
          upcoming.length ? (
            <div className="ohlist">
              {[...days.entries()].map(([k, items]) => (
                <div className="ohday" key={k}>
                  <h4 className="odsub">{dayLabel(k)} · {items.length} {items.length === 1 ? "booking" : "bookings"}{dayMoney(items)}</h4>
                  {items.map((b) => <BookingRow key={b.id} b={b} />)}
                </div>
              ))}
              {later ? <p className="odmuted">{later} more after that. <button type="button" className="odlink" onClick={() => go("calendar")}>Open calendar</button></p> : null}
            </div>
          ) : (
            <p className="ohempty"><Markup html={OD_ICONS.calendar} />{emptyWeek}</p>
          )
        ) : null}
      </section>

      {weekTotal || monthTotal ? (
        <div className="ohpulse">
          <button type="button" onClick={() => go("calendar")}>
            <small>On the books, next 7 days</small>
            <b>{money(weekTotal)}</b>
            <span>{week.length} {week.length === 1 ? "booking" : "bookings"} · after fees</span>
          </button>
          <button type="button" onClick={() => go("payouts")}>
            <small>Completed, last 30 days</small>
            <b>{money(monthTotal)}</b>
            <span>{month.length} {month.length === 1 ? "trip" : "trips"} · after fees</span>
          </button>
        </div>
      ) : null}

      {hasSamples ? (
        <div className="odbanner soft">
          Rows marked <span className="odtag">Sample</span> are examples so you can see how bookings look. Real ones replace them.
          <button type="button" className="odlink" onClick={() => set((cur) => ({ ...cur, bookings: cur.bookings.filter((b) => b.source !== "sample") }))}>Remove samples</button>
        </div>
      ) : null}

      {done < checks.length ? (
        <section className="odcard odsetup">
          <div className="odcardhead">
            <h3>Finish setting up</h3>
            <span className="odprogress"><i style={{ width: Math.round((done / checks.length) * 100) + "%" }} /></span>
            <small className="odmuted">{done} of {checks.length}</small>
            <button type="button" className="odlink" onClick={preview}>See what guests see</button>
          </div>
          <div className="odchecks">
            {checks.filter((c) => !c.done).map((c) => (
              <button type="button" key={c.id} className="odcheck" onClick={() => jump(c.field)}>
                <span className="tick" />
                <span>{c.label}</span>
                <Markup html={OD_ICONS.chev} />
              </button>
            ))}
          </div>
          {compact ? null : <p className="odmuted">Done items are gone from this list. It leaves once everything is set.</p>}
        </section>
      ) : null}
    </div>
  );
}
