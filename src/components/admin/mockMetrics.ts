import type { AdminMetrics, MetricsResult } from "../../lib/adminApi";

/**
 * Fixtures for the metrics page, used only in dev (`/admin?mock=populated`). The production build replaces
 * `import.meta.env.DEV` with false in adminApi.ts, so nothing here reaches the bundle a visitor downloads.
 *
 * The shape is the agreed contract in the shared brief, including deliberate nulls: outreach.complained and
 * catalog.reachable are figures the API cannot always know, and the page must say "not tracked yet" for them
 * rather than print a zero that reads as a fact.
 */

const DAY = 86400000;

function dayString(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

/** A stable pseudo-random sequence, so two runs (and two screenshots) draw exactly the same chart. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function buildMetrics(days: number, opts: { empty?: boolean } = {}): AdminMetrics {
  const end = Date.parse("2026-09-18T00:00:00.000Z");
  const start = end - (days - 1) * DAY;
  const r = rng(7 + days);
  const outreachByDay: AdminMetrics["outreach"]["byDay"] = [];
  const claimsByDay: AdminMetrics["claims"]["byDay"] = [];
  const bookingsByDay: AdminMetrics["bookings"]["byDay"] = [];
  const moneyByDay: AdminMetrics["money"]["byDay"] = [];
  let sent = 0;
  let bounced = 0;
  let claimedInRange = 0;
  let inRange = 0;
  let gross = 0;
  let fee = 0;
  for (let i = 0; i < days; i += 1) {
    const day = dayString(start + i * DAY);
    const ramp = i / Math.max(1, days - 1);
    const s = opts.empty ? 0 : Math.round(20 + ramp * 260 * (0.6 + r() * 0.8));
    const b = opts.empty ? 0 : Math.round(s * 0.03 * r());
    const c = opts.empty ? 0 : (r() < 0.45 ? 0 : Math.round(ramp * 6 * r()) + (r() < 0.2 ? 1 : 0));
    const bk = opts.empty ? 0 : (r() < 0.55 ? 0 : Math.round(ramp * 5 * r()));
    const g = opts.empty ? 0 : Math.round(bk * (95 + r() * 220) * 100) / 100;
    const f = Math.round(g * 0.12 * 100) / 100;
    outreachByDay.push({ day, sent: s, bounced: b });
    claimsByDay.push({ day, claimed: c });
    bookingsByDay.push({ day, booked: bk, gross: g });
    moneyByDay.push({ day, gross: g, fee: f });
    sent += s;
    bounced += b;
    claimedInRange += c;
    inRange += bk;
    gross += g;
    fee += f;
  }
  gross = Math.round(gross * 100) / 100;
  fee = Math.round(fee * 100) / 100;
  const claimed = opts.empty ? 0 : 418;
  const total = 59214;
  return {
    generatedAt: "2026-09-18T22:04:11.000Z",
    days,
    outreach: {
      sent,
      bounced,
      // Complaints arrive on a webhook that is not wired up yet: a real null, not a zero.
      complained: null,
      unsubscribed: opts.empty ? 0 : Math.round(sent * 0.011),
      suppressed: opts.empty ? 0 : Math.round(sent * 0.02) + 143,
      byDay: outreachByDay,
    },
    claims: {
      claimed,
      published: opts.empty ? 0 : 351,
      claimedInRange,
      byDay: claimsByDay,
      recent: opts.empty
        ? []
        : [
            { id: "o-cascade-jet-ski", email: "owner@cascadejetski.com", claimedAt: "2026-09-18T18:22:00.000Z", published: true },
            { id: "o-bluewater-charters", email: "sam@bluewatercharters.com", claimedAt: "2026-09-18T15:04:00.000Z", published: false },
            { id: "o-highline-climbing", email: "front.desk@highlineclimbing.com", claimedAt: "2026-09-17T21:41:00.000Z", published: true },
            { id: "o-stonefire-pottery", email: "hello@stonefirepottery.com", claimedAt: "2026-09-17T13:09:00.000Z", published: true },
            { id: "o-riverbend-tubing", email: "book@riverbendtubing.com", claimedAt: "2026-09-16T17:55:00.000Z", published: false },
          ],
    },
    bookings: {
      total: opts.empty ? 0 : inRange + 64,
      inRange,
      byStatus: opts.empty
        ? { new: 0, accepted: 0, completed: 0, declined: 0, cancelled: 0, noshow: 0, pending: 0 }
        : { new: 11, accepted: 46, completed: 72, declined: 7, cancelled: 9, noshow: 2, pending: 4 },
      byDay: bookingsByDay,
      recent: opts.empty
        ? []
        : [
            { code: "SA-4821", listing: "o-cascade-jet-ski", status: "accepted", date: "2026-09-21", created: "2026-09-18T19:02:00.000Z", total: 356, guest: "Chris D." },
            { code: "SA-4817", listing: "o-highline-climbing", status: "new", date: "2026-09-20", created: "2026-09-18T16:30:00.000Z", total: 88, guest: "Priya N." },
            { code: "SA-4809", listing: "o-riverbend-tubing", status: "completed", date: "2026-09-17", created: "2026-09-15T11:12:00.000Z", total: 142.5, guest: "Marcus L." },
            { code: "SA-4802", listing: "o-bluewater-charters", status: "declined", date: "2026-09-19", created: "2026-09-14T08:45:00.000Z", total: 1240, guest: "Dana W." },
            { code: "SA-4790", listing: "o-stonefire-pottery", status: "cancelled", date: "2026-09-16", created: "2026-09-12T20:20:00.000Z", total: 96, guest: "Ella R." },
          ],
    },
    money: {
      currency: "usd",
      gross,
      fee,
      operatorNet: Math.round((gross - fee) * 100) / 100,
      captured: gross,
      authorized: opts.empty ? 0 : 2480.5,
      refunded: opts.empty ? 0 : 318,
      payouts: opts.empty ? { scheduled: 0, paid: 0, reversed: 0 } : { scheduled: 3140.25, paid: Math.round((gross - fee - 3140.25) * 100) / 100, reversed: 142 },
      byDay: moneyByDay,
    },
    catalog: {
      total,
      claimed,
      unclaimed: total - claimed,
      // The reachable count lives in the pipeline's SQLite, which the deployed API cannot read.
      reachable: null,
      asOf: "2026-09-18T06:00:00.000Z",
    },
    funnel: {
      // The reachable count is the pipeline's, and the live API cannot read it: null, so the page has to say so
      // and the conversion into "emailed" has to admit it cannot be worked out.
      reachable: null,
      emailed: opts.empty ? 0 : Math.round(sent * 0.94),
      claimed: claimedInRange,
      listed: opts.empty ? 0 : Math.round(claimedInRange * 0.84),
      booked: opts.empty ? 0 : Math.round(claimedInRange * 0.22),
    },
  };
}

/** Maps `?mock=<state>` onto a result the page must render correctly. "loading" never settles. */
export async function mockResult(name: string, days: number): Promise<MetricsResult> {
  if (name === "loading") return new Promise<MetricsResult>(() => {});
  if (name === "error") return { ok: false, notFound: false, error: "The API did not answer in time." };
  if (name === "notfound" || name === "404") return { ok: false, notFound: true };
  if (name === "empty") return { ok: true, data: buildMetrics(days, { empty: true }) };
  return { ok: true, data: buildMetrics(days) };
}
