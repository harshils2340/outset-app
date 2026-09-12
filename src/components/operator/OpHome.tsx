import { dateKey, startOfToday } from "../../lib/dates";
import { fmtTime, money } from "../../lib/format";
import { DAY_SHORT, bookingTotal, relDay, setupChecks, fmtTotal } from "../../lib/operator";
import { Markup } from "../Markup";
import { OD_ICONS, useOp, type OpPage } from "./opContext";
import { BookingRow } from "./OpBookings";

/** Home: today at a glance, what needs a decision, and the setup checklist. Uber Eats merchant home shape. */
export function OpHome() {
  const { p, bookings, go, set, compact, preview } = useOp();
  const todayKey = dateKey(startOfToday());
  const fresh = bookings.filter((b) => b.status === "new");
  const today = bookings.filter((b) => b.date === todayKey && (b.status === "accepted" || b.status === "completed"));
  const upcoming = bookings.filter((b) => b.date > todayKey && b.status === "accepted");
  const week = (() => {
    const d = new Date(startOfToday());
    d.setDate(d.getDate() + 7);
    const k = dateKey(d);
    return bookings.filter((b) => b.date >= todayKey && b.date < k && (b.status === "accepted" || b.status === "completed"));
  })();
  const month = (() => {
    const d = new Date(startOfToday());
    d.setDate(d.getDate() - 30);
    const k = dateKey(d);
    return bookings.filter((b) => b.date >= k && b.date <= todayKey && b.status === "completed");
  })();
  // The 30 days before that. Only used when it actually holds bookings, so the tile never shows a
  // comparison against a period this operator was not on Outset for.
  const priorMonth = (() => {
    const from = new Date(startOfToday());
    from.setDate(from.getDate() - 60);
    const to = new Date(startOfToday());
    to.setDate(to.getDate() - 30);
    const a = dateKey(from);
    const b2 = dateKey(to);
    return bookings.filter((b) => b.date >= a && b.date < b2 && b.status === "completed");
  })();
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startOfToday());
    d.setDate(d.getDate() + i);
    const k = dateKey(d);
    const items = bookings.filter((b) => b.date === k && (b.status === "accepted" || b.status === "completed" || b.status === "new"));
    return { d, k, count: items.length, pending: items.filter((b) => b.status === "new").length, total: items.reduce((n, b) => n + bookingTotal(b), 0), off: p.hours[d.getDay()].closed || p.blockedDates.includes(k) };
  });
  const weekTotal = week.reduce((n, b) => n + bookingTotal(b), 0);
  const monthTotal = month.reduce((n, b) => n + bookingTotal(b), 0);
  const priorTotal = priorMonth.reduce((n, b) => n + bookingTotal(b), 0);
  const monthDelta = priorTotal > 0 ? Math.round(((monthTotal - priorTotal) / priorTotal) * 100) : null;
  const nextToday = today.find((b) => b.slot);
  const checks = setupChecks(p);
  const done = checks.filter((c) => c.done).length;
  const hasSamples = p.bookings.some((b) => b.source === "sample");
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="odpage">
      {done < checks.length ? (
        <section className="odcard odsetup">
          <div className="odcardhead">
            <h3>Set up your listing</h3>
            <span className="odprogress"><i style={{ width: Math.round((done / checks.length) * 100) + "%" }} /></span>
            <small className="odmuted">{done} of {checks.length}</small>
            <button type="button" className="odlink" onClick={preview}>See what guests see</button>
          </div>
          <div className="odchecks">
            {checks.map((c, i) => (
              <button type="button" key={c.id} className={"odcheck" + (c.done ? " done" : "")} onClick={() => go(c.page as OpPage)}>
                <span className="tick">{c.done ? <Markup html={OD_ICONS.check} /> : <i>{i + 1}</i>}</span>
                <span>{c.label}</span>
                <Markup html={OD_ICONS.chev} />
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <div className="odhello">
        <h2>{hello}{p.ownerName ? ", " + p.ownerName.split(" ")[0] : ""}.</h2>
        <p>
          {fresh.length ? <>{fresh.length} {fresh.length === 1 ? "request needs" : "requests need"} an answer. </> : "Nothing waiting on you. "}
          {today.length ? <>{today.length} {today.length === 1 ? "booking" : "bookings"} today.</> : "No bookings today."}
        </p>
      </div>


      <div className="odstats">
        <button type="button" onClick={() => go("bookings")}>
          <span className="odstaticon"><Markup html={OD_ICONS.ticket} /></span>
          <small>New requests</small>
          <b>{fresh.length}</b>
          <span className="odstatfoot">
            {fresh.length ? <em className="warn">Needs an answer</em> : <em className="ok">All answered</em>}
          </span>
        </button>
        <button type="button" onClick={() => go("calendar")}>
          <span className="odstaticon"><Markup html={OD_ICONS.calendar} /></span>
          <small>Today</small>
          <b>{today.length}</b>
          <span className="odstatfoot">
            {nextToday ? <><em>Next</em> {fmtTime(nextToday.slot)}</> : <em className="quiet">Nothing booked</em>}
          </span>
        </button>
        <button type="button" onClick={() => go("calendar")}>
          <span className="odstaticon"><Markup html={OD_ICONS.clock} /></span>
          <small>Next 7 days on the books</small>
          <b>{money(weekTotal)}</b>
          <span className="odstatfoot">
            <em>{week.length}</em> {week.length === 1 ? "booking" : "bookings"}
          </span>
        </button>
        <button type="button" onClick={() => go("payouts")}>
          <span className="odstaticon"><Markup html={OD_ICONS.card} /></span>
          <small>Completed, last 30 days</small>
          <b>{money(monthTotal)}</b>
          <span className="odstatfoot">
            {monthDelta === null ? (
              <><em>{month.length}</em> {month.length === 1 ? "trip" : "trips"}</>
            ) : (
              <><em className={monthDelta >= 0 ? "ok" : "warn"}>{monthDelta >= 0 ? "+" : ""}{monthDelta}%</em> vs prior 30 days</>
            )}
          </span>
        </button>
      </div>

      {!p.published ? (
        <div className="odbanner warn">
          <b>Your listing is hidden.</b> Guests can't find you on Outset right now.
          <button type="button" className="odlink" onClick={() => set({ published: true })}>Publish it</button>
        </div>
      ) : !p.accepting ? (
        <div className="odbanner">
          <b>You're paused.</b> The listing stays up, but guests can't pick a time until you switch Accepting back on.
        </div>
      ) : null}

      {hasSamples ? (
        <div className="odbanner soft">
          Rows marked <span className="odtag">Sample</span> are examples so you can see how bookings look. Real ones replace them.
          <button type="button" className="odlink" onClick={() => set((cur) => ({ ...cur, bookings: cur.bookings.filter((b) => b.source !== "sample") }))}>Remove samples</button>
        </div>
      ) : null}

      <div className={"odcols" + (compact ? " one" : "")}>
        <section className="odcard">
          <div className="odcardhead">
            <h3>Needs a decision</h3>
            {fresh.length ? <button type="button" className="odlink" onClick={() => go("bookings")}>All requests <Markup html={OD_ICONS.chev} /></button> : null}
          </div>
          {fresh.length === 0 ? <p className="odmuted">New requests show up here the moment a guest taps Book{p.instantBook ? ". Instant Book is on, so most bookings confirm on their own." : "."}</p> : null}
          {fresh.slice(0, 4).map((b) => (
            <BookingRow key={b.id} b={b} actions />
          ))}
        </section>

        <section className="odcard">
          <div className="odcardhead">
            <h3>Today</h3>
            <button type="button" className="odlink" onClick={() => go("calendar")}>Calendar <Markup html={OD_ICONS.chev} /></button>
          </div>
          {today.length === 0 ? <p className="odmuted">Nothing on today's schedule.</p> : null}
          {today.map((b) => (
            <BookingRow key={b.id} b={b} />
          ))}
          {upcoming.length ? (
            <>
              <h4 className="odsub">Coming up</h4>
              {upcoming.slice(0, 3).map((b) => (
                <div className="odline" key={b.id}>
                  <span className="odwhen">{relDay(b.date)} · {fmtTime(b.slot)}</span>
                  <span className="meta"><b>{b.guest}</b><small>{b.service}{b.variant ? " · " + b.variant : ""}</small></span>
                  <b className="odamt">{fmtTotal(b)}</b>
                </div>
              ))}
            </>
          ) : null}
        </section>
      </div>

      <section className="odcard">
        <div className="odcardhead">
          <h3>This week</h3>
          <button type="button" className="odlink" onClick={() => go("calendar")}>Open calendar <Markup html={OD_ICONS.chev} /></button>
        </div>
        <div className="odweek">
          {weekDays.map((w, i) => (
            <button type="button" key={w.k} className={"odweekday" + (i === 0 ? " today" : "") + (w.off ? " off" : "")} onClick={() => go("calendar")}>
              <small>{i === 0 ? "Today" : DAY_SHORT[w.d.getDay()]}</small>
              <b>{w.d.getDate()}</b>
              <span>{w.off ? "Off" : w.count ? w.count + (w.count === 1 ? " booking" : " bookings") : "Open"}</span>
              {w.total ? <em>{money(w.total)}</em> : null}
              {w.pending ? <i>{w.pending} waiting</i> : null}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
