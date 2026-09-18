import { createReadStream } from "node:fs";
import { Hono, type Context } from "hono";
import { query } from "../db/pg.ts";
import { verifySession } from "./auth.ts";
import { hasAdminKey, isAdminEmail } from "../lib/admin.ts";
import { outreachDays, outreachTotals, type OutreachDay, type OutreachTotals } from "../lib/outreachLog.ts";
import { computeCost, type ComputeCost } from "../lib/renderCost.ts";
import { parseSnapshot, putSpend, readSpend, type SpendDay, type SpendSnapshot } from "../lib/spendLog.ts";
import { localPath, readJson } from "../lib/store.ts";
import { getDoc } from "../lib/repo.ts";
import type { UnsubFile } from "../lib/unsub.ts";

/**
 * GET /admin/metrics: the one internal page. Outreach sent and what came back, claims, bookings, money, and
 * how much of the catalog is still unclaimed, with a per-day series for each so a chart can plot them.
 *
 * Three rules this file keeps:
 *  - Postgres only. SQLite lives on the pipeline worker's disk and on the founder's laptop; the API host has
 *    neither, so anything read from there would be zero on the deployed service and a lie on the page.
 *  - Nothing a figure cannot be known from becomes a 0. The catalog files can be missing on a host that has no
 *    checkout, and "0 operators" and "I could not read the catalog" mean opposite things, so the first is null
 *    with a note beside it.
 *  - The database does the counting. The service is on Render's free plan behind a ten-second statement
 *    timeout, so each query comes back grouped (a row per day, status and payment state) and Node only adds the
 *    small grouped rows up and fills in the days nothing happened on.
 */

export const DEFAULT_DAYS = 90;
const MAX_DAYS = 365;
const RECENT = 12;

const num = (v: string | number | null | undefined): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
/** Dollars, to the cent. Every money figure in the contract is dollars, never cents-as-integer. */
const money = (n: number): number => Math.round(n * 100) / 100;

export function clampDays(raw: string | undefined | null): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return DEFAULT_DAYS;
  return Math.min(MAX_DAYS, Math.max(1, n));
}

/** The UTC day strings the window covers, oldest first, including today. */
export function dayRange(days: number, now: Date): string[] {
  const out: string[] = [];
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let i = days - 1; i >= 0; i--) out.push(new Date(end - i * 86400000).toISOString().slice(0, 10));
  return out;
}

/** The first instant of the window, which is what every "since" query is given. */
export function rangeStart(days: number, now: Date): string {
  return dayRange(days, now)[0] + "T00:00:00.000Z";
}

/**
 * A chart needs an entry for every day, including the ones nothing happened on, or it draws a line straight
 * from one busy day to the next and the gap disappears.
 */
export function fillDays<T extends { day: string }>(days: string[], rows: T[], zero: (day: string) => T): T[] {
  const by = new Map(rows.map((r) => [r.day, r]));
  return days.map((d) => by.get(d) ?? zero(d));
}

/* ---------- what the database hands back ---------- */

/** One row per (status, payment state, payout state) over all bookings ever. Counting is already done. */
export type BookingGroup = { status: string; pay: string; payout: string; n: number; total: number; fee: number; payoutAmount: number; currency: string };
export type BookingDay = { day: string; booked: number; gross: number; fee: number };
export type ClaimDay = { day: string; claimed: number };
export type RecentBooking = { code: string; listing: string; status: string; date: string | null; created: string; total: number | null; guest: string };
export type RecentClaim = { id: string; email: string | null; claimedAt: string | null; published: boolean };
export type CatalogCounts = { total: number | null; reachable: number | null; asOf: string | null; note: string | null };

export type MetricsDeps = {
  outreachTotals(): Promise<OutreachTotals>;
  outreachDays(sinceIso: string): Promise<OutreachDay[]>;
  suppression(): Promise<{ suppressed: number; unsubscribed: number }>;
  claimTotals(): Promise<{ claimed: number; published: number }>;
  claimDays(sinceIso: string): Promise<ClaimDay[]>;
  recentClaims(limit: number): Promise<RecentClaim[]>;
  bookingGroups(): Promise<BookingGroup[]>;
  bookingDays(sinceIso: string): Promise<BookingDay[]>;
  recentBookings(limit: number): Promise<RecentBooking[]>;
  bookedListings(): Promise<number>;
  catalog(): Promise<CatalogCounts>;
  /** The pipeline worker's last spend snapshot, or null when it has never posted one. */
  spend(): Promise<SpendSnapshot | null>;
  /** What the hosting costs, as far as Render will say. See lib/renderCost.ts: it will not say. */
  compute(): Promise<ComputeCost>;
};

/* ---------- the Postgres implementation of those ---------- */

export const pgDeps: MetricsDeps = {
  outreachTotals,
  outreachDays,

  /**
   * The suppression list is one jsonb document, so it is unwrapped in SQL rather than pulled into Node as a
   * map of every hash. "suppressed" is everyone we may not mail for any reason; "unsubscribed" is only the
   * people who asked. An older file has no `reasons`, and those hashes were all unsubscribes.
   */
  async suppression() {
    const file = await getDoc<UnsubFile>("mail/unsub.json");
    const hashes = Object.keys(file?.hashes || {});
    const reasons = file?.reasons || {};
    return {
      suppressed: hashes.length,
      unsubscribed: hashes.filter((h) => (reasons[h] || "unsubscribe") === "unsubscribe").length,
    };
  },

  async claimTotals() {
    const rows = await query<{ claimed: string; published: string }>(
      "select count(*)::text as claimed, count(*) filter (where published)::text as published from profiles",
    );
    return { claimed: num(rows[0]?.claimed), published: num(rows[0]?.published) };
  },

  async claimDays(sinceIso) {
    const rows = await query<{ day: string; n: string }>(
      `select to_char(claimed_at at time zone 'UTC', 'YYYY-MM-DD') as day, count(*)::text as n
         from profiles where claimed_at >= $1 group by 1`,
      [sinceIso],
    );
    return rows.map((r) => ({ day: r.day, claimed: num(r.n) }));
  },

  async recentClaims(limit) {
    const rows = await query<{ id: string; owner_email: string | null; claimed_at: string | Date | null; published: boolean }>(
      "select id, owner_email, claimed_at, published from profiles order by claimed_at desc nulls last limit $1",
      [limit],
    );
    return rows.map((r) => ({ id: r.id, email: r.owner_email, claimedAt: r.claimed_at ? new Date(r.claimed_at).toISOString() : null, published: r.published !== false }));
  },

  /**
   * Every booking ever, already grouped. The columns beside `doc` cannot answer this on their own (the payment
   * state and the money are inside the document), so the jsonb is read in SQL and only the grouped rows cross
   * the wire: at most a few dozen, however many bookings there are.
   */
  async bookingGroups() {
    const rows = await query<{ status: string; pay: string; payout: string; n: string; total: string; fee: string; payout_amount: string; currency: string }>(
      `select status,
              coalesce(doc->'payment'->>'state', 'unpaid') as pay,
              coalesce(doc->'payout'->>'state', 'none') as payout,
              coalesce(lower(doc->'payment'->>'currency'), 'usd') as currency,
              count(*)::text as n,
              coalesce(sum((doc->>'total')::numeric), 0)::text as total,
              coalesce(sum((doc->'pricing'->>'fee')::numeric), 0)::text as fee,
              coalesce(sum((doc->'payout'->>'amount')::numeric), 0)::text as payout_amount
         from bookings group by 1, 2, 3, 4`,
    );
    return rows.map((r) => ({ status: r.status, pay: r.pay, payout: r.payout, currency: r.currency, n: num(r.n), total: num(r.total), fee: num(r.fee), payoutAmount: num(r.payout_amount) }));
  },

  async bookingDays(sinceIso) {
    const rows = await query<{ day: string; n: string; gross: string; fee: string }>(
      `select to_char(created at time zone 'UTC', 'YYYY-MM-DD') as day,
              count(*)::text as n,
              coalesce(sum((doc->>'total')::numeric) filter (where doc->'payment'->>'state' = 'captured'), 0)::text as gross,
              coalesce(sum((doc->'pricing'->>'fee')::numeric) filter (where doc->'payment'->>'state' = 'captured'), 0)::text as fee
         from bookings where created >= $1 group by 1`,
      [sinceIso],
    );
    return rows.map((r) => ({ day: r.day, booked: num(r.n), gross: money(num(r.gross)), fee: money(num(r.fee)) }));
  },

  async recentBookings(limit) {
    const rows = await query<{ code: string; listing: string; status: string; date: string | Date | null; created: string | Date; total: string | null; guest: string | null }>(
      `select code, listing, status, to_char(date, 'YYYY-MM-DD') as date, created, (doc->>'total') as total, (doc->'guest'->>'name') as guest
         from bookings order by created desc limit $1`,
      [limit],
    );
    return rows.map((r) => ({
      code: r.code,
      listing: r.listing,
      status: r.status,
      date: r.date ? String(r.date) : null,
      created: new Date(r.created).toISOString(),
      total: r.total === null ? null : money(num(r.total)),
      guest: shortName(r.guest),
    }));
  },

  async bookedListings() {
    const rows = await query<{ n: string }>("select count(distinct listing)::text as n from bookings");
    return num(rows[0]?.n);
  },

  catalog: catalogCounts,
  spend: readSpend,
  compute: computeCost,
};

/** "Christina Delacroix" -> "Christina D." A name is enough to recognise a booking; the rest is the guest's. */
export function shortName(name: string | null | undefined): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0];
  return parts[0] + " " + parts[parts.length - 1].slice(0, 1) + ".";
}

/* ---------- the catalog, from the generated files ---------- */

/**
 * The catalog is not in Postgres: it is the generated files under public/.
 *
 * `catalog.json` is the published catalog, 59,000 listings and 23 MB, so it is never parsed: the ids are read
 * off a stream, which costs one pass and a set of short strings instead of a 23 MB document on a 512 MB
 * instance. `catalog-lite.json` is NOT a smaller copy of it, it is the top 2,200 listings the home rails load
 * first (src/sync/contacts.ts), so counting that would report a catalog twenty-five times smaller than the real
 * one. It is used only for the timestamp when the big file is not in the checkout.
 *
 * claim-index.json says which listings we hold an email for. It covers every operator row we have, published or
 * not, so "reachable" is narrowed to ids that are actually in the catalog: otherwise the funnel opens with more
 * businesses reachable than exist to claim.
 *
 * Read once an hour and kept. Either file can be missing on a host with no checkout, and then the figure is
 * null with a note saying so, never a zero that reads like a fact.
 */
const CATALOG_TTL_MS = 60 * 60 * 1000;
let catalogCache: { at: number; value: CatalogCounts } | null = null;

export function clearCatalogCache(): void {
  catalogCache = null;
}

/** Every catalog id in the file, off a stream. The ids are `"id":"o-..."` at the head of each operator. */
async function idsFromCatalogStream(path: string): Promise<{ ids: Set<string>; generatedAt: string | null }> {
  const ids = new Set<string>();
  let generatedAt: string | null = null;
  // An id can straddle two chunks, so the tail of each chunk is carried into the next.
  let carry = "";
  const ID_RE = /"id":"(o-[a-z0-9-]{1,80})"/g;
  for await (const chunk of createReadStream(path, { encoding: "utf8", highWaterMark: 1 << 20 })) {
    const text = carry + (chunk as string);
    if (!generatedAt) generatedAt = /"generatedAt":"([^"]+)"/.exec(text)?.[1] ?? null;
    ID_RE.lastIndex = 0;
    for (let m = ID_RE.exec(text); m; m = ID_RE.exec(text)) ids.add(m[1]);
    carry = text.slice(-120);
  }
  return { ids, generatedAt };
}

async function catalogCounts(): Promise<CatalogCounts> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.value;
  const notes: string[] = [];
  let total: number | null = null;
  let reachable: number | null = null;
  let asOf: string | null = null;
  let ids: Set<string> | null = null;

  try {
    const path = localPath("catalog.json");
    if (path) {
      const read = await idsFromCatalogStream(path);
      ids = read.ids;
      total = read.ids.size;
      asOf = read.generatedAt;
    } else {
      notes.push("public/catalog.json is not in this checkout, so the catalog total is unknown (catalog-lite.json is only the 2,200-listing shard, not the catalog)");
      const lite = await readJson<{ generatedAt?: string }>("catalog-lite.json");
      asOf = lite?.generatedAt || null;
    }
  } catch (e) {
    notes.push("catalog.json: " + (e as Error).message);
  }

  try {
    // An entry carries `k` (a hash of the on-file email) when there is an address to write to. No address, no
    // outreach, so that is what "reachable" means.
    const index = await readJson<Record<string, { k?: string }>>("claim-index.json");
    if (!index) notes.push("public/claim-index.json is not readable here, so the reachable count is unknown");
    else if (!ids) notes.push("reachable needs the catalog ids, which could not be read, so it is left unknown");
    else reachable = Object.entries(index).filter(([id, e]) => !!e?.k && ids!.has(id)).length;
  } catch (e) {
    notes.push("claim-index.json: " + (e as Error).message);
  }

  const value: CatalogCounts = { total, reachable, asOf, note: notes.join("; ") || null };
  catalogCache = { at: Date.now(), value };
  return value;
}

/* ---------- what it costs ---------- */

export type Costs = {
  currency: "usd";
  discovery: number | null;
  extraction: number | null;
  compute: number | null;
  total: number | null;
  asOf: string | null;
  note: string | null;
  byDay: SpendDay[];
  perClaim: number | null;
  perBooking: number | null;
  capUsd: number | null;
  capUsedPct: number | null;
  computeRunRateMonthly: number | null;
};

/**
 * What Outset spends, beside what it earns. Never added to the money block: one is revenue and the other is a
 * bill, and a page that summed them would be reporting a number that means nothing.
 *
 * Three rules, and they are all the same rule:
 *  - A source that has not reported is `null`, not 0. The worker posts discovery and extraction; before its
 *    first post there is no figure, and "we have spent nothing on discovery" is a different claim from "nobody
 *    has told the API what discovery cost". Compute is null permanently because Render publishes no billing
 *    endpoint at all; the note says so rather than a list price dressed up as a bill.
 *  - `total` adds up only the sources that reported, and is null when none did. It is honest about being a
 *    partial total because the note names what is missing from it.
 *  - perClaim and perBooking divide by a count, so a zero denominator is `null`. Infinity is not a cost per
 *    claim, and neither is 0: the first business to claim has not cost nothing, we just cannot divide yet.
 */
export function buildCosts(opts: {
  snapshot: SpendSnapshot | null;
  compute: ComputeCost;
  claimed: number | null;
  bookings: number | null;
  range: string[];
}): Costs {
  const { snapshot, compute, claimed, bookings, range } = opts;
  const discovery = snapshot ? money(snapshot.discovery) : null;
  const extraction = snapshot ? money(snapshot.extraction) : null;
  const computeUsd = compute.monthToDate == null ? null : money(compute.monthToDate);

  const known = [discovery, extraction, computeUsd].filter((v): v is number => v != null);
  const total = known.length ? money(known.reduce((a, b) => a + b, 0)) : null;

  const per = (denominator: number | null): number | null =>
    total == null || denominator == null || denominator <= 0 ? null : money(total / denominator);

  // The cap guards paid API calls on the worker, which is discovery plus extraction; the hosting bill is not
  // under it, so the percentage is deliberately computed from the snapshot's own total and not from `total`.
  const paid = snapshot ? money(snapshot.discovery + snapshot.extraction) : null;
  const capUsd = snapshot?.capUsd ?? null;
  const capUsedPct = paid == null || capUsd == null || capUsd <= 0 ? null : Math.round((paid / capUsd) * 1000) / 10;

  // Only the days in the window, filled, so the chart plots it straight. No snapshot means no series at all
  // rather than a flat line of zeros, which would draw "we spent nothing" across the whole range.
  const inRange = (snapshot?.byDay || []).filter((d) => d.day >= range[0] && d.day <= range[range.length - 1]);
  const byDay = snapshot ? fillDays<SpendDay>(range, inRange, (day) => ({ day, discovery: 0, extraction: 0 })) : [];

  const notes: string[] = [];
  if (!snapshot) {
    notes.push(
      "The pipeline worker has not posted a spend snapshot yet, so discovery and extraction are unknown. They are counted in ledger files and in SQLite on the worker's own disk, which the deployed API cannot read; the nightly `spend` job posts them to POST /admin/spend.",
    );
  }
  notes.push("Compute: " + compute.note);

  return {
    // Spend is billed in US dollars whatever currency a booking was taken in, so this is not money.currency.
    currency: "usd",
    discovery,
    extraction,
    compute: computeUsd,
    total,
    asOf: snapshot?.at ?? null,
    note: notes.join(" ") || null,
    byDay,
    perClaim: per(claimed),
    perBooking: per(bookings),
    capUsd,
    capUsedPct,
    computeRunRateMonthly: compute.runRateMonthly == null ? null : money(compute.runRateMonthly),
  };
}

/* ---------- putting it together ---------- */

export type Metrics = Awaited<ReturnType<typeof collectMetrics>>;

export async function collectMetrics(deps: MetricsDeps, days: number, now = new Date()) {
  const since = rangeStart(days, now);
  const range = dayRange(days, now);
  const [outTotals, outDays, supp, claimT, claimD, claimR, groups, bookDays, bookR, bookedListings, catalog, snapshot, compute] = await Promise.all([
    deps.outreachTotals(),
    deps.outreachDays(since),
    deps.suppression(),
    deps.claimTotals(),
    deps.claimDays(since),
    deps.recentClaims(RECENT),
    deps.bookingGroups(),
    deps.bookingDays(since),
    deps.recentBookings(RECENT),
    deps.bookedListings(),
    deps.catalog(),
    deps.spend(),
    deps.compute(),
  ]);

  const bookings = summarizeBookings(groups);
  // One filled series behind both charts: the bookings chart plots the count and the money chart the dollars,
  // and a day missing from one but not the other would be two charts telling different stories.
  const dayRows = fillDays(range, bookDays, (day) => ({ day, booked: 0, gross: 0, fee: 0 }));
  const claimedInRange = claimD.reduce((a, d) => a + d.claimed, 0);

  return {
    generatedAt: now.toISOString(),
    days,
    outreach: {
      sent: outTotals.sent,
      bounced: outTotals.bounced,
      complained: outTotals.complained,
      unsubscribed: supp.unsubscribed,
      suppressed: supp.suppressed,
      byDay: fillDays(range, outDays, (day) => ({ day, sent: 0, bounced: 0 })),
    },
    claims: {
      claimed: claimT.claimed,
      published: claimT.published,
      claimedInRange,
      byDay: fillDays(range, claimD, (day) => ({ day, claimed: 0 })),
      recent: claimR,
    },
    bookings: {
      total: bookings.total,
      inRange: bookDays.reduce((a, d) => a + d.booked, 0),
      byStatus: bookings.byStatus,
      byDay: dayRows.map((d) => ({ day: d.day, booked: d.booked, gross: d.gross })),
      recent: bookR,
    },
    money: {
      ...bookings.money,
      byDay: dayRows.map((d) => ({ day: d.day, gross: d.gross, fee: d.fee })),
    },
    catalog: {
      total: catalog.total,
      claimed: claimT.claimed,
      unclaimed: catalog.total === null ? null : Math.max(0, catalog.total - claimT.claimed),
      reachable: catalog.reachable,
      asOf: catalog.asOf,
      note: catalog.note,
    },
    // Cost per claimed business and cost per booking are the point of this block, so both denominators are the
    // lifetime counts, matching the lifetime spend the worker reports. A window's spend against a window's
    // claims would need the worker to report spend per day for every day ever, which it does not.
    costs: buildCosts({ snapshot, compute, claimed: claimT.claimed, bookings: bookings.total, range }),
    funnel: {
      reachable: catalog.reachable,
      emailed: outTotals.sent,
      claimed: claimT.claimed,
      listed: claimT.published,
      booked: bookedListings,
    },
  };
}

const STATUSES = ["new", "accepted", "completed", "declined", "cancelled", "noshow", "pending"] as const;

/**
 * The money rules, in one place because they are the ones that are easy to get quietly wrong:
 *  - gross is money actually taken, so only a captured payment counts. An authorization is a hold on somebody
 *    else's card; counting it as revenue would report money we may never receive.
 *  - fee is Outset's cut of that captured money, operatorNet is the rest, and the two add back up to gross.
 *  - refunded is money that was taken and given back. A release before capture was never taken, so it is not a
 *    refund; what tells the two apart is the payout, which only exists once a card has been captured.
 */
export function summarizeBookings(groups: BookingGroup[]) {
  const byStatus: Record<string, number> = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  let total = 0;
  let gross = 0;
  let fee = 0;
  let authorized = 0;
  let refunded = 0;
  const payouts = { scheduled: 0, paid: 0, reversed: 0 };
  const currencies = new Map<string, number>();

  for (const g of groups) {
    total += g.n;
    byStatus[g.status] = (byStatus[g.status] || 0) + g.n;
    currencies.set(g.currency, (currencies.get(g.currency) || 0) + g.n);
    if (g.pay === "captured") {
      gross += g.total;
      fee += g.fee;
    }
    if (g.pay === "authorized") authorized += g.total;
    if (g.pay === "released" && (g.payout === "reversed" || g.payout === "cancelled")) refunded += g.total;
    if (g.payout === "scheduled" || g.payout === "paid" || g.payout === "reversed") payouts[g.payout] += g.payoutAmount;
  }

  const currency = [...currencies.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "usd";
  // The net is taken from the two figures that are published, not from the unrounded sums behind them: rounding
  // each of three numbers on its own lets fee and net add up to a cent more than the gross they came out of,
  // and a page that shows all three would be showing arithmetic that does not work.
  const grossOut = money(gross);
  const feeOut = money(fee);
  return {
    total,
    byStatus,
    money: {
      currency,
      gross: grossOut,
      fee: feeOut,
      operatorNet: money(grossOut - feeOut),
      captured: grossOut,
      authorized: money(authorized),
      refunded: money(refunded),
      payouts: { scheduled: money(payouts.scheduled), paid: money(payouts.paid), reversed: money(payouts.reversed) },
    },
  };
}

/* ---------- the route ---------- */

/**
 * Two doors, one answer. A session whose email is named in ADMIN_EMAILS is how the page gets in (the browser
 * signs in with an emailed code, so no secret is ever typed into a page or put in a URL); x-admin-key is how a
 * terminal gets in. Everything else is told the route is not there.
 */
export function isAdminRequest(c: Context): boolean {
  if (hasAdminKey(c)) return true;
  return isAdminEmail(verifySession(c.req.header("x-session"))?.email);
}

/**
 * Built around its dependencies so a test can drive the gate and the arithmetic without a database. The
 * exported `metrics` is this with the real Postgres queries behind it.
 *
 * It must be mounted BEFORE the blanket x-admin-key middleware in routes.ts: that middleware answers 404 to
 * anything without the key, which would close the session door this route exists to open.
 */
export function makeMetrics(deps: MetricsDeps = pgDeps) {
  const app = new Hono();
  app.get("/admin/metrics", async (c) => {
    // 404, not 403. A 403 tells whoever is guessing that there is something here to guess at.
    if (!isAdminRequest(c)) return c.json({ error: "not found" }, 404);
    const days = clampDays(c.req.query("days"));
    try {
      return c.json(await collectMetrics(deps, days));
    } catch (e) {
      console.error("[metrics] " + (e as Error).message);
      return c.json({ error: "metrics unavailable" }, 500);
    }
  });

  /**
   * The pipeline worker posts what it has spent. Same gate as the page, so the admin key opens it and a curl
   * can correct a snapshot by hand; same 404 for everyone else, for the same reason.
   *
   * One snapshot at a time, replaced: this is a running total read off the worker's ledgers, not an event
   * stream, so the newest reading is the only one worth keeping. A malformed body is 400 and changes nothing,
   * because a stored NaN would put a NaN on the page.
   */
  app.post("/admin/spend", async (c) => {
    if (!isAdminRequest(c)) return c.json({ error: "not found" }, 404);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "expected a JSON body" }, 400);
    }
    const parsed = parseSnapshot(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    try {
      await putSpend(parsed.value);
      return c.json({ ok: true, stored: { discovery: parsed.value.discovery, extraction: parsed.value.extraction, total: parsed.value.total, days: parsed.value.byDay.length } });
    } catch (e) {
      console.error("[spend] " + (e as Error).message);
      return c.json({ error: "spend snapshot not stored" }, 500);
    }
  });
  return app;
}

export const metrics = makeMetrics();
