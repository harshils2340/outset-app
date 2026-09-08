import { useState } from "react";
import { dateKey, startOfToday } from "../../lib/dates";
import { money } from "../../lib/format";
import { bookingTotal, deleteProfile, relDay } from "../../lib/operator";
import { Markup } from "../Markup";
import { OD_ICONS, PAGES, useOp } from "./opContext";

const FEE = 0.1;

/** Payouts: earnings from completed bookings, the next payout, and a payout method. Numbers come from the bookings list. */
export function OpPayouts() {
  const { p, bookings, set, toast } = useOp();
  const [bank, setBank] = useState(p.payout?.bank || "");
  const [name, setName] = useState(p.payout?.name || p.ownerName);
  const [acct, setAcct] = useState("");
  const [schedule, setSchedule] = useState<"daily" | "weekly">(p.payout?.schedule || "weekly");
  const todayKey = dateKey(startOfToday());
  const done = bookings.filter((b) => b.status === "completed");
  const gross = done.reduce((n, b) => n + bookingTotal(b), 0);
  const upcoming = bookings.filter((b) => b.status === "accepted" && b.date >= todayKey).reduce((n, b) => n + bookingTotal(b), 0);
  const pending = done.filter((b) => b.date >= dateKey(new Date(Date.now() - 7 * 86400000))).reduce((n, b) => n + bookingTotal(b), 0);

  return (
    <div className="odpage">
      <div className="odstats">
        <div><b>{money(Math.round(pending * (1 - FEE)))}</b><small>Next payout, after fees</small></div>
        <div><b>{money(Math.round(gross * (1 - FEE)))}</b><small>Paid out to date</small></div>
        <div><b>{money(upcoming)}</b><small>Confirmed, not yet completed</small></div>
        <div><b>{Math.round(FEE * 100)}%</b><small>Outset fee per booking</small></div>
      </div>
      <p className="odmuted">Guests pay when they book. You're paid {p.payout?.schedule === "daily" ? "every day" : "every Monday"} for bookings completed since the last payout. Card processing and payouts aren't switched on yet, so these totals are from your bookings list.</p>

      <div className="odcols">
        <section className="odcard">
          <div className="odcardhead"><h3>Payout method</h3>{p.payout ? <span className="odtag live">Added</span> : null}</div>
          {p.payout ? (
            <div className="odline">
              <span className="meta"><b>{p.payout.bank} ····{p.payout.last4}</b><small>{p.payout.name} · {p.payout.schedule === "daily" ? "Daily" : "Weekly"} payouts</small></span>
              <button type="button" className="odlink" onClick={() => set({ payout: null })}>Change</button>
            </div>
          ) : (
            <>
              <label className="odfield"><span>Bank name</span><input value={bank} onChange={(e) => setBank(e.target.value)} placeholder="Chase, Wells Fargo, RBC" /></label>
              <label className="odfield"><span>Account holder</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
              <label className="odfield"><span>Account number</span><input inputMode="numeric" value={acct} onChange={(e) => setAcct(e.target.value.replace(/\D/g, ""))} placeholder="Only the last 4 digits are kept" /></label>
              <label className="odfield"><span>Payout schedule</span>
                <select value={schedule} onChange={(e) => setSchedule(e.target.value as "daily" | "weekly")}>
                  <option value="weekly">Weekly, every Monday</option>
                  <option value="daily">Daily</option>
                </select>
              </label>
              <button type="button" className="cta" disabled={!bank.trim() || !name.trim() || acct.length < 4} onClick={() => { set({ payout: { bank: bank.trim(), name: name.trim(), last4: acct.slice(-4), schedule } }); setAcct(""); toast("Payout method saved"); }}>Save payout method</button>
              <p className="odfine">Demo only. We store the bank name and last four digits on this device, nothing else.</p>
            </>
          )}
        </section>

        <section className="odcard">
          <div className="odcardhead"><h3>Completed bookings</h3></div>
          {done.length === 0 ? <p className="odmuted">Completed bookings show here with what you earned on each.</p> : null}
          {done.slice().reverse().slice(0, 8).map((b) => (
            <div className="odline" key={b.id}>
              <span className="meta"><b>{b.guest}{b.source === "sample" ? <span className="odtag">Sample</span> : null}</b><small>{relDay(b.date)} · {b.service}</small></span>
              <span className="odamt"><b>{money(Math.round(bookingTotal(b) * (1 - FEE)))}</b><small>of {money(bookingTotal(b))}</small></span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

/** Settings: owner, notifications, a phone-only page list, and the log out and unclaim actions. */
export function OpSettings() {
  const { p, set, compact, go, logout, toast } = useOp();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="odpage">
      {compact ? (
        <section className="odcard odmorelist">
          {PAGES.filter((x) => ["hours", "listing", "assistant", "payouts"].includes(x.id)).map((pg) => (
            <button type="button" key={pg.id} onClick={() => go(pg.id)}>
              <Markup html={OD_ICONS[pg.icon]} />
              <span>{pg.label}</span>
              <Markup html={OD_ICONS.chev} />
            </button>
          ))}
        </section>
      ) : null}

      <div className="odcols">
        <section className="odcard">
          <div className="odcardhead"><h3>Owner</h3></div>
          <label className="odfield"><span>Name</span><input value={p.ownerName} onChange={(e) => set({ ownerName: e.target.value })} /></label>
          <label className="odfield"><span>Email</span><input type="email" value={p.ownerEmail} onChange={(e) => set({ ownerEmail: e.target.value })} /></label>
          <label className="odfield"><span>Mobile</span><input type="tel" value={p.ownerPhone} onChange={(e) => set({ ownerPhone: e.target.value })} /></label>
        </section>

        <section className="odcard">
          <div className="odcardhead"><h3>Notifications</h3></div>
          {([
            ["push", "Push alerts for new requests", "A ping on your phone the moment a guest books."],
            ["sms", "Text messages", "New requests and same-day cancellations by SMS."],
            ["email", "Email", "A daily summary plus every new booking."],
          ] as const).map(([k, label, sub]) => (
            <div className="odrow" key={k}>
              <span className="meta"><b>{label}</b><small>{sub}</small></span>
              <button type="button" className={"optoggle" + (p.notify[k] ? " on" : "")} onClick={() => set({ notify: { ...p.notify, [k]: !p.notify[k] } })} aria-pressed={p.notify[k]}><span className="knob" /></button>
            </div>
          ))}
          <p className="odfine">Sending isn't switched on yet. These choices are saved for when it is.</p>
        </section>
      </div>

      <section className="odcard">
        <div className="odcardhead"><h3>Bookings</h3></div>
        <div className="odrow">
          <span className="meta"><b>Instant Book</b><small>{p.instantBook ? "Bookings confirm automatically." : "You approve each booking."}</small></span>
          <button type="button" className={"optoggle" + (p.instantBook ? " on" : "")} onClick={() => set({ instantBook: !p.instantBook })} aria-pressed={p.instantBook}><span className="knob" /></button>
        </div>
        {p.bookings.some((b) => b.source === "sample") ? (
          <div className="odrow">
            <span className="meta"><b>Sample bookings</b><small>Example rows so the dashboard isn't empty.</small></span>
            <button type="button" className="odghost" onClick={() => { set((cur) => ({ ...cur, bookings: cur.bookings.filter((b) => b.source !== "sample") })); toast("Samples removed"); }}>Remove</button>
          </div>
        ) : null}
      </section>

      <section className="odcard">
        <div className="odcardhead"><h3>Account</h3></div>
        <div className="odrow">
          <span className="meta"><b>Log out</b><small>Your edits stay on this device.</small></span>
          <button type="button" className="odghost" onClick={logout}><Markup html={OD_ICONS.logout} /> Log out</button>
        </div>
        <div className="odrow">
          <span className="meta"><b>Release this listing</b><small>Removes your edits and puts the listing back the way we built it.</small></span>
          {confirm ? (
            <div className="odbtns">
              <button type="button" className="odghost" onClick={() => setConfirm(false)}>Keep</button>
              <button type="button" className="odghost danger" onClick={() => { deleteProfile(p.id); logout(); }}>Yes, release</button>
            </div>
          ) : (
            <button type="button" className="odghost danger" onClick={() => setConfirm(true)}>Release</button>
          )}
        </div>
      </section>
    </div>
  );
}
