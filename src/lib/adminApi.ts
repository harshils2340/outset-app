import { API_URL, loadApiSession } from "./api";

/**
 * The private metrics page's own API layer. Nothing here is imported by guest or operator code, and nothing
 * here may leak into it: claimed-versus-unclaimed counts are Harshil's numbers alone, so the types and the
 * calls both stay inside this file and src/components/admin.
 *
 * The route answers 404, not 403, when the caller is not an admin, so a signed-out visitor cannot learn that
 * /admin/metrics exists. The page shows a plain "Not found" for that, exactly like any unknown URL.
 */

/** A figure the API could not know is `null`, never 0. Every renderer must say so rather than print a zero. */
export type Maybe = number | null;

export type OutreachDay = { day: string; sent: number; bounced: number };
export type ClaimDay = { day: string; claimed: number };
export type BookingDay = { day: string; booked: number; gross: number };
export type MoneyDay = { day: string; gross: number; fee: number };
export type CostDay = { day: string; discovery: number; extraction: number };

export type AdminMetrics = {
  generatedAt: string;
  days: number;
  outreach: { sent: Maybe; bounced: Maybe; complained: Maybe; unsubscribed: Maybe; suppressed: Maybe; byDay: OutreachDay[] };
  claims: {
    claimed: Maybe;
    published: Maybe;
    claimedInRange: Maybe;
    byDay: ClaimDay[];
    recent: { id: string; email: string; claimedAt: string; published: boolean }[];
  };
  bookings: {
    total: Maybe;
    inRange: Maybe;
    byStatus: Record<string, number>;
    byDay: BookingDay[];
    recent: { code: string; listing: string; status: string; date: string; created: string; total: Maybe; guest: string }[];
  };
  money: {
    currency: string;
    gross: Maybe;
    fee: Maybe;
    operatorNet: Maybe;
    captured: Maybe;
    authorized: Maybe;
    refunded: Maybe;
    payouts: { scheduled: Maybe; paid: Maybe; reversed: Maybe };
    byDay: MoneyDay[];
  };
  /**
   * What Outset spends, which is a different kind of number from `money` and must never be added to it: one is
   * revenue and the other is a bill. Every figure here is US dollars whatever currency a booking was taken in.
   * A source that has not reported is null with the reason in `note`, and `perClaim`/`perBooking` are null when
   * their denominator is zero rather than Infinity or a zero that reads as "free".
   */
  costs: {
    currency: string;
    discovery: Maybe;
    extraction: Maybe;
    compute: Maybe;
    total: Maybe;
    asOf: string | null;
    note: string | null;
    byDay: CostDay[];
    perClaim: Maybe;
    perBooking: Maybe;
    capUsd: Maybe;
    capUsedPct: Maybe;
    computeRunRateMonthly: Maybe;
  };
  catalog: { total: Maybe; claimed: Maybe; unclaimed: Maybe; reachable: Maybe; asOf: string | null };
  funnel: { reachable: Maybe; emailed: Maybe; claimed: Maybe; listed: Maybe; booked: Maybe };
};

export type MetricsResult =
  | { ok: true; data: AdminMetrics }
  | { ok: false; notFound: true; error?: undefined }
  | { ok: false; notFound: false; error: string };

/**
 * Dev-only mock. `?mock=<state>` on /admin renders the page from a fixture instead of the API, so every state
 * (loading, error, empty, populated, a null figure, not-an-admin) can be looked at before the endpoint exists.
 * `import.meta.env.DEV` is replaced by `false` in a production build, so the fixture module is never bundled.
 */
const DEV = !!import.meta.env?.DEV;

export function mockName(): string | null {
  if (typeof window === "undefined" || !DEV) return null;
  return new URLSearchParams(window.location.search).get("mock");
}

export const RANGES = [30, 90, 365] as const;
export type Range = (typeof RANGES)[number];

/** The session this browser already holds, if it has one. The admin page reuses the operator sign-in's storage. */
export function adminSessionEmail(): string | null {
  return loadApiSession()?.email || null;
}

/**
 * The site and the API deploy separately, so this page can be newer than the service it is reading. An API that
 * predates the costs block is not an error and must not blank the whole page: the block is filled in as all
 * nulls with a note that says which side is behind, which is the same honesty rule every other figure follows.
 */
export function withCosts(data: AdminMetrics): AdminMetrics {
  if (data.costs && Array.isArray(data.costs.byDay)) return data;
  return {
    ...data,
    costs: {
      currency: "usd",
      discovery: null,
      extraction: null,
      compute: null,
      total: null,
      asOf: null,
      note: "This API build does not report costs yet, so nothing here is known. It is not a claim that nothing was spent.",
      byDay: [],
      perClaim: null,
      perBooking: null,
      capUsd: null,
      capUsedPct: null,
      computeRunRateMonthly: null,
    },
  };
}

export async function fetchAdminMetrics(days: number, signal?: AbortSignal): Promise<MetricsResult> {
  // `DEV &&` first so a production build folds the branch away and never emits the fixture as a chunk.
  const mock = DEV ? mockName() : null;
  if (DEV && mock) {
    const { mockResult } = await import("../components/admin/mockMetrics");
    const r = await mockResult(mock, days);
    // Through the same filler as a real answer, so a fixture can never hand the page a shape the API would not.
    return r.ok ? { ok: true, data: withCosts(r.data) } : r;
  }
  const session = loadApiSession();
  if (!API_URL) return { ok: false, notFound: false, error: "This build has no API configured, so there is nothing to read." };
  if (!session) return { ok: false, notFound: true };
  try {
    const res = await fetch(`${API_URL}/admin/metrics?days=${encodeURIComponent(String(days))}`, {
      headers: { "x-session": session.token },
      signal: signal ?? AbortSignal.timeout(20000),
    });
    // 404 is also the answer for "you are not an admin", which is the point: the page cannot tell the two apart
    // and neither can a visitor. 401 means the session ran out; that is worth saying, since signing in fixes it.
    if (res.status === 404) return { ok: false, notFound: true };
    if (res.status === 401 || res.status === 403) return { ok: false, notFound: false, error: "This sign-in is no longer valid. Sign in again." };
    if (!res.ok) return { ok: false, notFound: false, error: `The API answered ${res.status}.` };
    const data = (await res.json()) as AdminMetrics;
    if (!data || typeof data !== "object" || !Array.isArray(data.outreach?.byDay)) {
      return { ok: false, notFound: false, error: "The API answered with something this page does not understand." };
    }
    return { ok: true, data: withCosts(data) };
  } catch (e) {
    const msg = (e as Error).name === "TimeoutError" ? "The API did not answer in time." : "Could not reach the API.";
    return { ok: false, notFound: false, error: msg };
  }
}
