import { useEffect, useState } from "react";
import { connectPayouts, hasApi, payoutStatus, setPayoutSchedule, type PayoutInterval, type PayoutState, type PayoutStatus } from "../../lib/api";
import { dateKey, startOfToday } from "../../lib/dates";
import { money } from "../../lib/format";
import { bookingTotal, deleteProfile, isoToDate, relDay } from "../../lib/operator";
import { OPERATOR_FEE_RATE, SERVICE_FEE_CAP, serviceFee } from "../../lib/pricing";
import { Markup } from "../Markup";
import { OD_ICONS, PAGES, useOp } from "./opContext";

const FEE = OPERATOR_FEE_RATE;

/**
 * The operator's own price behind a guest total. A booking's `total` is what the guest paid: the operator's
 * price plus the guest's stepped service fee. The fee is a whole number of dollars and never more than $25, so
 * there are only 26 candidates to try. Mirrors subtotalFromTotal in backend/src/payments/money.ts.
 */
function operatorPrice(total: number): number {
  for (let fee = 0; fee <= SERVICE_FEE_CAP; fee++) {
    const sub = Math.round((total - fee) * 100) / 100;
    if (sub > 0 && serviceFee(sub) === fee) return sub;
  }
  return total;
}

/**
 * What the operator receives for one booking: their price less Outset's 5%. Taking 5% off the guest total
 * instead counted the guest's service fee as the operator's money, so the tiles here promised more than the
 * booking email for the same trip ("You receive $194.75" against "$202" on this page).
 */
const payoutOf = (b: Parameters<typeof bookingTotal>[0]): number => operatorPrice(bookingTotal(b)) * (1 - FEE);

/** Cents in the account's currency: "$1,240", "$7.50", "CA$95". */
function cents(n: number, currency?: string): string {
  const v = n / 100;
  const code = (currency || "usd").toUpperCase();
  try {
    return v.toLocaleString("en-US", { style: "currency", currency: code, minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
  } catch {
    return money(v);
  }
}

function longDay(iso: string): string {
  return isoToDate(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

const STATE_LABEL: Record<PayoutState, { label: string; cls: string }> = {
  scheduled: { label: "Scheduled", cls: "new" },
  paid: { label: "Paid", cls: "accepted" },
  reversed: { label: "Reversed", cls: "declined" },
  cancelled: { label: "Cancelled", cls: "cancelled" },
};

/**
 * Payouts. With a connected Stripe account the numbers are the API's ledger: what goes out on the next pay day,
 * what waits on later trip dates, what has been paid, and each booking's payout. Without the API the page falls
 * back to what this device's real bookings add up to, and sample rows never count.
 */
export function OpPayouts() {
  const { p, bookings, toast } = useOp();
  const todayKey = dateKey(startOfToday());
  // Money only from real bookings; sample rows never count.
  const real = bookings.filter((b) => b.source !== "sample");
  const done = real.filter((b) => b.status === "completed");
  const earned = done.reduce((n, b) => n + payoutOf(b), 0);
  const upcomingLocal = real.filter((b) => b.status === "accepted" && b.date >= todayKey).reduce((n, b) => n + bookingTotal(b), 0);
  const pending = done.filter((b) => b.date >= dateKey(new Date(Date.now() - 7 * 86400000))).reduce((n, b) => n + payoutOf(b), 0);
  const [status, setStatus] = useState<PayoutStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!hasApi()) { setStatus({ available: false }); return; }
    void payoutStatus(p.id).then((s) => { if (alive) setStatus(s); });
    return () => { alive = false; };
  }, [p.id]);
  const connect = async () => {
    setBusy(true);
    const r = await connectPayouts(p.id);
    setBusy(false);
    if (r.url) window.location.assign(r.url);
    else toast(r.error || "Could not open Stripe. Try again.");
  };
  // The ledger is real only when the API answered for a connected account.
  const ledger = status?.connected && typeof status.nextPayoutOn === "string" ? status : null;
  const interval: PayoutInterval = status?.interval === "biweekly" ? "biweekly" : "weekly";
  const pickInterval = async (next: PayoutInterval) => {
    if (!status || next === interval || saving) return;
    const prev = status;
    setStatus({ ...status, interval: next });
    setSaving(true);
    const r = await setPayoutSchedule(p.id, next);
    setSaving(false);
    if (!r.ok) {
      setStatus(prev);
      toast(r.error || "Could not change your pay schedule. Try again.");
      return;
    }
    toast(next === "weekly" ? "Paid every Monday" : "Paid every other Monday");
    // The next pay day moves with the schedule; read it back.
    void payoutStatus(p.id).then((s) => setStatus(s));
  };
  const history = ledger?.history || [];

  return (
    <div className="odpage">
      {ledger ? (
        <div className="odstats">
          <div><b>{cents(ledger.nextAmount || 0, ledger.currency)}</b><small>Next payout · {longDay(ledger.nextPayoutOn!)}</small></div>
          <div><b>{cents(ledger.upcoming || 0, ledger.currency)}</b><small>Scheduled for later pay days</small></div>
          <div><b>{cents(ledger.paidTotal || 0, ledger.currency)}</b><small>Paid out to date</small></div>
          <div><b>{Math.round(FEE * 100)}%</b><small>Outset fee per booking</small></div>
        </div>
      ) : (
        <div className="odstats">
          <div><b>{money(Math.round(pending))}</b><small>Next payout, after fees</small></div>
          <div><b>{money(Math.round(earned))}</b><small>Earned to date, after fees</small></div>
          <div><b>{money(upcomingLocal)}</b><small>Confirmed, not yet completed</small></div>
          <div><b>{Math.round(FEE * 100)}%</b><small>Outset fee per booking</small></div>
        </div>
      )}
      <p className="odmuted">Guests pay by card when they book. An accepted booking is paid on your next pay day after the experience date, then Stripe sends it to your bank, usually within 1 to 2 business days. Outset keeps {Math.round(FEE * 100)}% of your price; the guest's service fee is separate.</p>

      <div className="odcols">
        <div className="odstack">
          <section className="odcard" data-jump="payout">
            <div className="odcardhead"><h3>Bank account</h3>{status?.enabled ? <span className="odtag live">Payouts on</span> : status?.connected ? <span className="odtag">Finish setup</span> : null}</div>
            {status === null ? <p className="odmuted">Checking…</p> : null}
            {status && !status.available ? (
              <p className="odmuted">Card payments and payouts switch on shortly. Until then guests pay you on site, and there is nothing to set up here.</p>
            ) : null}
            {status?.available && !status.enabled ? (
              <>
                <p className="odmuted">{status.connected ? "Stripe still needs a detail or two before payouts can start." : "Payouts run through Stripe, the same processor Shopify and Lyft use. It takes about three minutes: your name, business details and the bank account to pay into. We never see your account number."}</p>
                <button type="button" className="cta" disabled={busy} onClick={connect}>{busy ? "Opening Stripe…" : status.connected ? "Finish setup with Stripe" : "Set up payouts with Stripe"}</button>
              </>
            ) : null}
            {status?.enabled ? (
              <>
                <p className="odmuted">Your bank account is connected. {interval === "weekly" ? "Payouts go out every Monday." : "Payouts go out every other Monday."}</p>
                <button type="button" className="odlink" disabled={busy} onClick={connect}>Update bank details</button>
              </>
            ) : null}
          </section>

          {status?.connected ? (
            <section className="odcard">
              <div className="odcardhead"><h3>Pay schedule</h3></div>
              <div className="odseg" role="group" aria-label="How often you are paid">
                <button type="button" aria-pressed={interval === "weekly"} disabled={saving} onClick={() => void pickInterval("weekly")}>Every week</button>
                <button type="button" aria-pressed={interval === "biweekly"} disabled={saving} onClick={() => void pickInterval("biweekly")}>Every two weeks</button>
              </div>
              <p className="odfine">Both are paid on Mondays.{ledger?.nextPayoutOn ? " Your next pay day is " + longDay(ledger.nextPayoutOn) + "." : ""}</p>
            </section>
          ) : null}
        </div>

        {ledger ? (
          <section className="odcard">
            <div className="odcardhead"><h3>Payout history</h3></div>
            {history.length === 0 ? <p className="odmuted">Each accepted booking shows here with its payout and when it is paid.</p> : null}
            {history.map((h) => {
              const st = STATE_LABEL[h.state] || { label: h.state, cls: "" };
              return (
                <div className="odline odpayline" key={h.code + h.state}>
                  <span className="meta">
                    <b>{h.code}</b>
                    <small>Trip {relDay(h.date)}{h.state === "paid" && h.paidAt ? " · paid " + new Date(h.paidAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}</small>
                  </span>
                  <span className={"odstatus " + st.cls}>{st.label}</span>
                  <span className="odamt"><b className={h.state === "reversed" || h.state === "cancelled" ? "odstruck" : undefined}>{cents(h.amount, h.currency)}</b></span>
                </div>
              );
            })}
          </section>
        ) : (
          <section className="odcard">
            <div className="odcardhead"><h3>Completed bookings</h3></div>
            {done.length === 0 ? <p className="odmuted">Completed bookings show here with what you earned on each.</p> : null}
            {done.slice().reverse().slice(0, 8).map((b) => (
              <div className="odline" key={b.id}>
                <span className="meta"><b>{b.guest}</b><small>{relDay(b.date)} · {b.service}</small></span>
                <span className="odamt"><b>{money(Math.round(bookingTotal(b) * (1 - FEE)))}</b><small>of {money(bookingTotal(b))}</small></span>
              </div>
            ))}
          </section>
        )}
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
        <section className="odcard" data-jump="owner">
          <div className="odcardhead"><h3>Owner</h3></div>
          <label className="odfield"><span>Name</span><input value={p.ownerName} onChange={(e) => set({ ownerName: e.target.value })} /></label>
          <label className="odfield"><span>Email</span><input type="email" value={p.ownerEmail} onChange={(e) => set({ ownerEmail: e.target.value })} /></label>
          <label className="odfield"><span>Mobile</span><input type="tel" value={p.ownerPhone} onChange={(e) => set({ ownerPhone: e.target.value })} /></label>
        </section>

        <section className="odcard">
          <div className="odcardhead"><h3>Booking alerts</h3></div>
          {/* Only what actually happens. Push and text alerts are not built, and every booking email already
              goes out, so switches for them would be promises the product does not keep. */}
          {!hasApi() ? (
            <p className="odmuted">Alerts start once your account is connected.</p>
          ) : p.ownerEmail.trim() ? (
            <div className="odrow">
              <span className="meta"><b>Email</b><small>Every new request goes to {p.ownerEmail.trim()} straight away, with the guest's name and number so you can reach them.</small></span>
            </div>
          ) : (
            <div className="odrow">
              <span className="meta"><b>No email yet</b><small>Add your email under Owner. Until you do, booking requests have nowhere to reach you.</small></span>
            </div>
          )}
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
          <span className="meta"><b>Log out</b><small>{hasApi() ? "Your listing and bookings stay saved to your account. Sign back in with your email." : "Your edits stay on this device."}</small></span>
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
