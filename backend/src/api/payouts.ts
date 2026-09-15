import { Hono } from "hono";
import { ID, mayEdit, rateLimit } from "./auth.ts";
import { readJson } from "../lib/store.ts";
import { getProfile, listBookings, listingsWithPayouts, updateBooking, updateProfile } from "../lib/repo.ts";
import { chargeOf, setAccountDailyPayouts, settlementOf, stripeEnabled, transferForBooking } from "../lib/stripe.ts";
import { currencyForArea, cycleOf, cycleStart, type Interval } from "../payments/money.ts";
import type { StoredBooking } from "./bookings.ts";
import type { StoredProfile } from "./profiles.ts";

/**
 * Operator payouts through Stripe Connect Express. The operator clicks once, Stripe collects identity and
 * bank details on its own hosted pages, and we only keep the account id and whether payouts are enabled.
 * With no Stripe key every route reports payouts as not switched on; nothing is faked.
 */

const KEY = () => process.env.STRIPE_SECRET_KEY || "";
const SITE = (process.env.SITE_URL || "https://onoutset.com/").replace(/\/?$/, "/");

function form(obj: Record<string, string | undefined>): string {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(String(v)))
    .join("&");
}

async function stripe<T>(path: string, body?: Record<string, string | undefined>): Promise<T> {
  const res = await fetch("https://api.stripe.com/v1/" + path, {
    method: body ? "POST" : "GET",
    headers: { authorization: "Bearer " + KEY(), "content-type": "application/x-www-form-urlencoded" },
    body: body ? form(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const j = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error("stripe: " + (j.error?.message || res.status));
  return j;
}

type Payout = {
  account: string;
  enabled: boolean;
  detailsSubmitted: boolean;
  updatedAt: string;
  /** How often the operator is paid. Weekly unless they chose every two weeks. */
  interval?: Interval;
  /** The last pay cycle that ran for this listing, so a cycle pays once however often the job runs. */
  lastCycle?: number;
};
type ProfileWithPayout = StoredProfile & { payout?: Payout };

export const payouts = new Hono();

payouts.get("/payouts/:id", async (c) => {
  const id = String(c.req.param("id") ?? "");
  if (!ID.test(id) || !mayEdit(c, id)) return c.json({ error: "not allowed" }, 403);
  if (!stripeEnabled()) return c.json({ available: false });
  const rec = await getProfile<ProfileWithPayout>(id);
  if (!rec?.payout) return c.json({ available: true, connected: false });
  // Refresh the flags from Stripe so a finished onboarding shows without a second click.
  try {
    const acct = await stripe<{ payouts_enabled: boolean; details_submitted: boolean }>("accounts/" + rec.payout.account);
    const payout: Payout = { ...rec.payout, enabled: acct.payouts_enabled, detailsSubmitted: acct.details_submitted, updatedAt: new Date().toISOString() };
    if (payout.enabled !== rec.payout.enabled || payout.detailsSubmitted !== rec.payout.detailsSubmitted)
      await updateProfile<ProfileWithPayout>(id, rec, (cur) => ({ ...cur, payout }));
    return c.json({ available: true, connected: true, enabled: payout.enabled, detailsSubmitted: payout.detailsSubmitted, interval: payout.interval || "weekly", ...(await ledger(id, payout)) });
  } catch {
    return c.json({ available: true, connected: true, enabled: rec.payout.enabled, detailsSubmitted: rec.payout.detailsSubmitted, interval: rec.payout.interval || "weekly", ...(await ledger(id, rec.payout)) });
  }
});

/** What the dashboard shows: money waiting on a trip date, what goes out on the next pay day, and what has been paid. */
async function ledger(id: string, payout: Payout, now = new Date()) {
  const list = await listBookings<StoredBooking>(id);
  const interval = payout.interval || "weekly";
  const next = cycleStart(cycleOf(now, interval) + (payout.lastCycle === cycleOf(now, interval) ? 1 : 0), interval);
  // A cycle pays on its Monday, and a run any later day of that cycle still pays, so once this cycle's Monday
  // has gone by the next payout is the next run, not a date in the past. The page used to say "Next payout ·
  // Monday, September 14" on the 15th and file money the next run would send under "later pay days".
  const today = now.toISOString().slice(0, 10);
  const nextDay = [next.toISOString().slice(0, 10), today].sort().at(-1)!;
  let upcoming = 0;
  let nextAmount = 0;
  let paid = 0;
  let currency = "";
  const history: { code: string; date: string; amount: number; currency: string; state: string; paidAt?: string }[] = [];
  for (const b of list) {
    if (!b.payout) continue;
    currency ||= b.payout.currency;
    if (b.payout.state === "scheduled") {
      if (b.payout.releaseOn <= nextDay) nextAmount += b.payout.amount;
      else upcoming += b.payout.amount;
    }
    if (b.payout.state === "paid") paid += b.payout.amount;
    history.push({ code: b.code, date: b.date, amount: b.payout.amount, currency: b.payout.currency, state: b.payout.state, paidAt: b.payout.paidAt });
  }
  return { currency, nextPayoutOn: nextDay, nextAmount, upcoming, paidTotal: paid, history: history.slice(0, 50) };
}

/** Weekly or every two weeks, both on Mondays. */
payouts.put("/payouts/:id/schedule", rateLimit(60, 60 * 60 * 1000), async (c) => {
  const id = String(c.req.param("id") ?? "");
  if (!ID.test(id) || !mayEdit(c, id)) return c.json({ error: "not allowed" }, 403);
  const body = (await c.req.json().catch(() => ({}))) as { interval?: string };
  if (body.interval !== "weekly" && body.interval !== "biweekly") return c.json({ error: "interval is weekly or biweekly" }, 400);
  const rec = await getProfile<ProfileWithPayout>(id);
  if (!rec?.payout) return c.json({ error: "set up payouts first" }, 404);
  const interval = body.interval as Interval;
  await updateProfile<ProfileWithPayout>(id, rec, (cur) => ({ ...cur, payout: { ...cur.payout!, interval, updatedAt: new Date().toISOString() } }));
  return c.json({ ok: true, interval });
});

export type PayoutRun = { listings: number; paid: number; amount: Record<string, number>; skipped: { listing: string; reason: string }[]; failed: { code: string; error: string }[] };

/**
 * Pay every operator what is due. A booking is due once its payout is scheduled, the day after the experience
 * has come, and the operator has finished Stripe onboarding; it goes out on the operator's pay day (Monday, every
 * week or every other week). Each booking is its own transfer keyed by its code, so running this twice, or on
 * two servers at once, cannot pay a booking twice. Money owed to a shop that has not connected a bank waits.
 */
export async function runPayouts(now = new Date()): Promise<PayoutRun> {
  const out: PayoutRun = { listings: 0, paid: 0, amount: {}, skipped: [], failed: [] };
  if (!stripeEnabled()) return out;
  const ids = await listingsWithPayouts();
  const today = now.toISOString().slice(0, 10);
  for (const id of ids) {
    out.listings++;
    const rec = await getProfile<ProfileWithPayout>(id);
    const payout = rec?.payout;
    if (!payout?.account) {
      out.skipped.push({ listing: id, reason: "no bank account connected" });
      continue;
    }
    if (!payout.enabled) {
      out.skipped.push({ listing: id, reason: "Stripe onboarding not finished" });
      continue;
    }
    const interval = payout.interval || "weekly";
    const cycle = cycleOf(now, interval);
    if (payout.lastCycle === cycle) {
      out.skipped.push({ listing: id, reason: "already paid this cycle" });
      continue;
    }
    const list = await listBookings<StoredBooking>(id);
    const due = list.filter((b) => b.payout?.state === "scheduled" && b.payout.releaseOn <= today && b.payout.amount > 0 && ["accepted", "completed", "noshow"].includes(b.status));
    for (const b of due) {
      try {
        const charge = b.payment?.charge || (b.payment?.intent ? await chargeOf(b.payment.intent) : null);
        // A transfer funded by a charge must be in the currency that charge settled in.
        const settled = charge ? await settlementOf(charge) : { currency: b.payout!.currency, rate: 1 };
        const amount = Math.round(b.payout!.amount * settled.rate);
        const transfer = await transferForBooking({ code: b.code, listing: id, account: payout.account, amount, currency: settled.currency, charge });
        await updateBooking<StoredBooking>(id, b.code, (x) => ({ ...x, payout: { ...x.payout!, state: "paid" as const, transfer, paidAt: now.toISOString(), cycle } }));
        out.paid++;
        out.amount[settled.currency] = (out.amount[settled.currency] || 0) + amount;
      } catch (e) {
        out.failed.push({ code: b.code, error: (e as Error).message.slice(0, 200) });
      }
    }
    if (due.length && !out.failed.some((f) => due.some((b) => b.code === f.code)))
      await updateProfile<ProfileWithPayout>(id, rec!, (cur) => ({ ...cur, payout: { ...cur.payout!, lastCycle: cycle } }));
  }
  return out;
}

let running: Promise<PayoutRun> | null = null;
/** One run at a time in this process. */
export function runPayoutsOnce(now = new Date()): Promise<PayoutRun> {
  running ||= runPayouts(now).finally(() => {
    running = null;
  });
  return running;
}

/** For the founder or a cron: POST with the admin key to pay out now. */
payouts.post("/admin/payouts/run", async (c) => {
  const key = process.env.ADMIN_KEY;
  if (!key || c.req.header("x-admin-key") !== key) return c.json({ error: "not found" }, 404);
  return c.json(await runPayoutsOnce());
});

/** Creates the Express account on first click and returns a hosted onboarding link; later clicks resume it. */
payouts.post("/payouts/:id/connect", rateLimit(20, 60 * 60 * 1000), async (c) => {
  const id = String(c.req.param("id") ?? "");
  if (!ID.test(id) || !mayEdit(c, id)) return c.json({ error: "not allowed" }, 403);
  if (!stripeEnabled()) return c.json({ error: "payouts are not switched on yet" }, 503);
  const rec = await getProfile<ProfileWithPayout>(id);
  if (!rec) return c.json({ error: "claim the listing first" }, 404);
  try {
    let account = rec.payout?.account;
    if (!account) {
      // Express accounts default to the platform's country (Canada); a Florida shop needs a US account and bank.
      const detail = await readJson<{ area?: string }>(`o/${id}.json`).catch(() => null);
      const a = await stripe<{ id: string }>("accounts", {
        type: "express",
        country: currencyForArea(detail?.area, "usd") === "cad" ? "CA" : "US",
        email: rec.owner.email || undefined,
        "business_profile[name]": String((rec.patch as { title?: string }).title || id).slice(0, 100),
        "business_profile[url]": SITE + "#o=" + id,
        "capabilities[transfers][requested]": "true",
        "metadata[listing]": id,
      });
      account = a.id;
      // Stripe sends whatever reaches the operator's balance to their bank the next business day; Outset decides
      // when money reaches the balance (their weekly or two-weekly pay day).
      await setAccountDailyPayouts(a.id).catch((e) => console.error(`[payouts] schedule for ${a.id}: ${(e as Error).message}`));
      await updateProfile<ProfileWithPayout>(id, rec, (cur) => ({ ...cur, payout: { account: a.id, enabled: false, detailsSubmitted: false, updatedAt: new Date().toISOString() } }));
    }
    const link = await stripe<{ url: string }>("account_links", {
      account,
      type: "account_onboarding",
      refresh_url: SITE + "operators#payouts",
      return_url: SITE + "operators#payouts",
    });
    return c.json({ url: link.url });
  } catch (e) {
    return c.json({ error: (e as Error).message.slice(0, 160) }, 502);
  }
});
