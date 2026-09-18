import { useCallback, useEffect, useMemo, useState } from "react";
import "../../styles/admin.css";
import { money } from "../../lib/format";
import { adminSessionEmail, fetchAdminMetrics, mockName, RANGES, type AdminMetrics, type Maybe, type MetricsResult } from "../../lib/adminApi";
import { AdminSignIn } from "./AdminSignIn";
import { ChartEmpty, Funnel, RowBars, ShareBar, Sparkline, TimeChart, type Point } from "./charts";

/**
 * Harshil's private metrics page, at /admin. It answers one question: is outreach turning into claims, and do
 * claims turn into bookings and money.
 *
 * Nothing links here. It is not in any guest or operator navigation, the route is checked server-side against
 * ADMIN_EMAILS, and a caller who is not on that list gets 404 from /admin/metrics, which this page renders as
 * a plain "Not found" and nothing else. Claimed-versus-unclaimed counts exist here and nowhere else in the app.
 *
 * Honesty rules this page keeps, because a number nobody can trust is worse than no number:
 * - A figure the API returns as null reads "not tracked yet" with the reason, never 0.
 * - Every percentage names its denominator.
 * - A range with no data says so instead of drawing an empty axis.
 */

const NULL_REASONS: Record<string, string> = {
  complained: "Spam complaints arrive on a provider webhook that is not recorded yet.",
  reachable: "The reachable count lives in the pipeline's own database, which the live API cannot read.",
  default: "The API cannot measure this yet.",
};

/** A count, or an honest blank. `reason` is the one line that says why the blank is there. */
function Figure({ v, reason, fmt = (n: number) => n.toLocaleString("en-US") }: { v: Maybe; reason?: string; fmt?: (n: number) => string }) {
  if (v == null) return <span className="adnull" title={reason}>not tracked yet</span>;
  return <>{fmt(v)}</>;
}

function Money({ v, reason }: { v: Maybe; reason?: string }) {
  return <Figure v={v} reason={reason} fmt={(n) => money(Math.round(n * 100) / 100)} />;
}

/**
 * The change against the previous period. The API sends one window, so the comparison is this window's later
 * half against its earlier half, and the label says exactly that rather than implying a period nobody fetched.
 */
function halves(values: number[]): { now: number; before: number; pct: number | null } {
  const mid = Math.floor(values.length / 2);
  const before = values.slice(0, mid).reduce((a, b) => a + b, 0);
  const now = values.slice(mid).reduce((a, b) => a + b, 0);
  return { now, before, pct: before > 0 ? ((now - before) / before) * 100 : null };
}

function Tile({ label, value, values, color, sub }: { label: string; value: React.ReactNode; values: number[]; color: string; sub: string }) {
  const h = halves(values);
  const half = Math.floor(values.length / 2);
  return (
    <div className="adtile">
      <span className="adtile-label">{label}</span>
      <strong className="adtile-value">{value}</strong>
      <Sparkline values={values} color={color} />
      <span className="adtile-delta">
        {h.pct == null ? (
          <em>no earlier half to compare with</em>
        ) : (
          <>
            <b className={h.pct >= 0 ? "adup" : "addown"}>{h.pct >= 0 ? "+" : "−"}{Math.abs(h.pct).toFixed(0)}%</b> last {values.length - half} days vs the {half} before
          </>
        )}
      </span>
      <span className="adtile-sub">{sub}</span>
    </div>
  );
}

function Section({ id, title, blurb, children }: { id: string; title: string; blurb: string; children: React.ReactNode }) {
  return (
    <section className="adsection" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <p className="adblurb">{blurb}</p>
      {children}
    </section>
  );
}

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** The whole page once the data is in. Split out so the states above it stay easy to read. */
function Dashboard({ m }: { m: AdminMetrics }) {
  const sentDays: Point[] = m.outreach.byDay.map((d) => ({ day: d.day, values: [d.sent, d.bounced] }));
  const sentValues = m.outreach.byDay.map((d) => d.sent);
  const claimDays: Point[] = m.claims.byDay.map((d) => ({ day: d.day, values: [d.claimed] }));
  const claimValues = m.claims.byDay.map((d) => d.claimed);
  const bookDays: Point[] = m.bookings.byDay.map((d) => ({ day: d.day, values: [d.booked] }));
  const bookValues = m.bookings.byDay.map((d) => d.booked);
  const moneyDays: Point[] = m.money.byDay.map((d) => ({ day: d.day, values: [Math.max(0, d.gross - d.fee), d.fee] }));
  const moneyValues = m.money.byDay.map((d) => d.gross);
  const statuses = Object.entries(m.bookings.byStatus || {}).map(([label, value]) => ({ label, value }));
  const bounceRate = m.outreach.sent && m.outreach.bounced != null && m.outreach.sent > 0 ? (m.outreach.bounced / m.outreach.sent) * 100 : null;

  return (
    <>
      <div className="adtiles">
        <Tile label="Emails sent" value={<Figure v={m.outreach.sent} />} values={sentValues} color="var(--ad-1)" sub={`in the last ${m.days} days`} />
        <Tile label="Claims" value={<Figure v={m.claims.claimedInRange} />} values={claimValues} color="var(--ad-2)" sub={m.claims.claimed == null ? "total claimed not tracked yet" : `${m.claims.claimed.toLocaleString("en-US")} claimed in total`} />
        <Tile label="Bookings" value={<Figure v={m.bookings.inRange} />} values={bookValues} color="var(--ad-3)" sub={m.bookings.total == null ? "lifetime total not tracked yet" : `${m.bookings.total.toLocaleString("en-US")} since the beginning`} />
        <Tile label="Gross taken" value={<Money v={m.money.gross} />} values={moneyValues} color="var(--ad-4)" sub="payments actually captured" />
        <Tile label="Outset's fee" value={<Money v={m.money.fee} />} values={m.money.byDay.map((d) => d.fee)} color="var(--ad-1)" sub="our cut of that gross" />
      </div>

      <Section id="ad-outreach" title="Outreach" blurb="Emails sent to operators, and what came back. Bounces and unsubscribes are the cost of sending; a rising bounce line means the address list is going stale.">
        <TimeChart title="Emails sent and bounced" points={sentDays} series={[{ label: "Sent", color: "var(--ad-1)" }, { label: "Bounced", color: "var(--ad-3)" }]} height={220} />
        <dl className="adfacts">
          <div><dt>Sent</dt><dd><Figure v={m.outreach.sent} /></dd></div>
          <div><dt>Bounced</dt><dd><Figure v={m.outreach.bounced} /> {bounceRate != null ? <em>{bounceRate.toFixed(1)}% of sent</em> : null}</dd></div>
          <div><dt>Unsubscribed</dt><dd><Figure v={m.outreach.unsubscribed} /></dd></div>
          <div><dt>Complained</dt><dd><Figure v={m.outreach.complained} reason={NULL_REASONS.complained} /></dd></div>
          <div><dt>On the suppression list</dt><dd><Figure v={m.outreach.suppressed} /> <em>all time, not just this range</em></dd></div>
        </dl>
        {m.outreach.complained == null ? <p className="adwhy">Complained: {NULL_REASONS.complained}</p> : null}
      </Section>

      <Section id="ad-funnel" title="The funnel" blurb="The only chain that matters: an address we can reach, an email sent to it, a business that claims its page, publishes it, and takes a booking.">
        <Funnel
          steps={[
            // The funnel's own count if the API has one, else the catalog's; both are the same fact, and both
            // come from the pipeline's database, so both are often null.
            { label: "Reachable", value: m.funnel.reachable ?? m.catalog.reachable, note: (m.funnel.reachable ?? m.catalog.reachable) == null ? NULL_REASONS.reachable : "Operators with an address we can mail." },
            { label: "Emailed", value: m.funnel.emailed, note: "Distinct addresses mailed in this range." },
            { label: "Claimed", value: m.funnel.claimed, note: "Businesses that claimed their listing in this range." },
            { label: "Listed", value: m.funnel.listed, note: "Of those, the ones that published the page." },
            { label: "Booked", value: m.funnel.booked, note: "Distinct listings with at least one booking." },
          ]}
        />
      </Section>

      <Section id="ad-claims" title="Claims" blurb="How much of the catalog belongs to its operator yet. The share is against the whole catalog, not against what outreach has reached.">
        {m.catalog.total != null && m.catalog.claimed != null ? (
          <ShareBar part={m.catalog.claimed} whole={m.catalog.total} partLabel="claimed" wholeLabel="listings in the catalog" />
        ) : (
          <ChartEmpty label="Claimed share" reason="The catalog size is not known to the API yet, so a share cannot be honest." />
        )}
        {m.catalog.asOf ? <p className="adwhy">Catalog counted {when(m.catalog.asOf)}.</p> : null}
        <TimeChart title="Claims per day" points={claimDays} series={[{ label: "Claims", color: "var(--ad-2)" }]} kind="bars" height={200} emptyReason="No listing was claimed in this range." />
        <h3>Most recent claims</h3>
        {m.claims.recent.length ? (
          <div className="adtablewrap">
            <table className="adtable">
              <thead><tr><th scope="col">Listing</th><th scope="col">Email</th><th scope="col">Claimed</th><th scope="col">Published</th></tr></thead>
              <tbody>
                {m.claims.recent.map((c) => (
                  <tr key={c.id + c.claimedAt}>
                    <td className="adid">{c.id}</td>
                    <td>{c.email || <span className="adnull">no address recorded</span>}</td>
                    <td>{when(c.claimedAt)}</td>
                    <td>{c.published ? "Yes" : "Not yet"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="adwhy">No claims in this range.</p>
        )}
      </Section>

      <Section id="ad-bookings" title="Bookings" blurb="Every booking across every listing, whoever took it.">
        <TimeChart title="Bookings per day" points={bookDays} series={[{ label: "Bookings", color: "var(--ad-3)" }]} kind="bars" height={200} emptyReason="No booking was made in this range." />
        <h3>By status</h3>
        <RowBars rows={statuses} color="var(--ad-2)" title="Bookings by status" />
        <h3>Most recent bookings</h3>
        {m.bookings.recent.length ? (
          <div className="adtablewrap">
            <table className="adtable">
              <thead><tr><th scope="col">Code</th><th scope="col">Listing</th><th scope="col">Guest</th><th scope="col">Date</th><th scope="col">Status</th><th scope="col">Total</th></tr></thead>
              <tbody>
                {m.bookings.recent.map((b) => (
                  <tr key={b.code}>
                    <td className="adid">{b.code}</td>
                    <td className="adid">{b.listing}</td>
                    <td>{b.guest || <span className="adnull">no name</span>}</td>
                    <td>{b.date}</td>
                    <td><span className={"adpill adpill-" + b.status}>{b.status}</span></td>
                    <td className="adnum"><Money v={b.total} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="adwhy">No bookings in this range.</p>
        )}
      </Section>

      <Section id="ad-money" title="Money" blurb={`Every figure is ${(m.money.currency || "usd").toUpperCase()} and counts captured payments only: money held on a card but not taken is listed separately.`}>
        <TimeChart
          title="Gross and fee per day"
          points={moneyDays}
          series={[{ label: "Operator net", color: "var(--ad-2)" }, { label: "Outset fee", color: "var(--ad-4)" }]}
          kind="bars"
          height={220}
          fmt={(n) => money(Math.round(n * 100) / 100)}
          emptyReason="No money was captured in this range."
        />
        <dl className="adfacts">
          <div><dt>Gross captured</dt><dd><Money v={m.money.gross} /></dd></div>
          <div><dt>Outset's fee</dt><dd><Money v={m.money.fee} /> {m.money.gross && m.money.fee != null && m.money.gross > 0 ? <em>{((m.money.fee / m.money.gross) * 100).toFixed(1)}% of gross</em> : null}</dd></div>
          <div><dt>Operator net</dt><dd><Money v={m.money.operatorNet} /></dd></div>
          <div><dt>Held, not captured</dt><dd><Money v={m.money.authorized} /> <em>authorised on a card</em></dd></div>
          <div><dt>Refunded</dt><dd><Money v={m.money.refunded} /></dd></div>
          <div><dt>Payouts scheduled</dt><dd><Money v={m.money.payouts.scheduled} /></dd></div>
          <div><dt>Payouts paid</dt><dd><Money v={m.money.payouts.paid} /></dd></div>
          <div><dt>Payouts reversed</dt><dd><Money v={m.money.payouts.reversed} /></dd></div>
        </dl>
      </Section>
    </>
  );
}

/** What a visitor who is not an admin sees, and what the page shows for a 404 from the metrics route. */
function NotFound() {
  return (
    <div className="adgate">
      <div className="adgate-card">
        <h1>Not found</h1>
      </div>
    </div>
  );
}

export function AdminView() {
  const [days, setDays] = useState<number>(90);
  const [email, setEmail] = useState<string | null>(() => adminSessionEmail());
  const [res, setRes] = useState<MetricsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const mock = mockName();
  const signedIn = !!email || !!mock;

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetchAdminMetrics(days);
    setRes(r);
    setLoading(false);
  }, [days]);

  useEffect(() => {
    document.title = "Outset metrics";
    document.body.classList.add("adbody");
    return () => document.body.classList.remove("adbody");
  }, []);

  useEffect(() => {
    if (!signedIn) { setLoading(false); return; }
    void load();
  }, [signedIn, load]);

  const generated = useMemo(() => (res && res.ok ? when(res.data.generatedAt) : null), [res]);

  if (!signedIn) return <AdminSignIn onDone={(e) => setEmail(e)} />;
  if (res && !res.ok && res.notFound) return <NotFound />;

  return (
    <div className="adpage">
      <header className="adhead">
        <div>
          <h1>Metrics</h1>
          <p className="adwho">{email || "fixture"} · last {days} days</p>
        </div>
        <div className="adcontrols">
          <div className="adrange" role="group" aria-label="Range">
            {RANGES.map((r) => (
              <button key={r} type="button" className={"adbtn adbtn-range" + (r === days ? " on" : "")} aria-pressed={r === days} onClick={() => setDays(r)}>
                {r} days
              </button>
            ))}
          </div>
          <button type="button" className="adbtn adbtn-go" onClick={() => void load()} disabled={loading}>
            {loading ? "Reading…" : "Refresh"}
          </button>
          <span className="adstamp">{generated ? `Generated ${generated}` : "—"}</span>
        </div>
      </header>

      {loading && !res ? (
        <p className="adstate" role="status">Reading the numbers…</p>
      ) : res && !res.ok ? (
        <div className="adstate aderr" role="alert">
          <b>Could not read the metrics.</b>
          <span>{res.error}</span>
          <button type="button" className="adbtn adbtn-go" onClick={() => void load()}>Try again</button>
        </div>
      ) : res && res.ok ? (
        <Dashboard m={res.data} />
      ) : null}
    </div>
  );
}
