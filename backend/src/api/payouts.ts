import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { ID, jsonBody, mayEdit, rateLimit } from "./auth.ts";
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

/**
 * The transfer a booking's payout goes out as, fixed on the first attempt. Stripe's idempotency key is the
 * booking code, and a retry under the same key with a different amount is refused outright ("Keys for
 * idempotent requests can only be used with the same parameters"). The amount used to be recomputed from the
 * charge's exchange rate on every run, so a booking whose transfer succeeded but whose state write failed
 * could never be marked paid once the rate moved.
 */
type TransferSnapshot = { transferAmount?: number; transferCurrency?: string };
type BookingPayout = NonNullable<StoredBooking["payout"]> & TransferSnapshot;
export type PayoutBooking = Omit<StoredBooking, "payout"> & { payout?: BookingPayout };

/** What the payout run reads and writes, so a test can hand it a fake store and a fake Stripe. */
export type PayoutDeps = {
  stripeEnabled: () => boolean;
  listingsWithPayouts: () => Promise<string[]>;
  getProfile: (id: string) => Promise<ProfileWithPayout | null>;
  updateProfile: (id: string, initial: ProfileWithPayout, fn: (cur: ProfileWithPayout) => ProfileWithPayout) => Promise<ProfileWithPayout>;
  listBookings: (id: string) => Promise<PayoutBooking[]>;
  updateBooking: (id: string, code: string, fn: (cur: PayoutBooking) => PayoutBooking) => Promise<PayoutBooking | null>;
  chargeOf: typeof chargeOf;
  settlementOf: typeof settlementOf;
  transferForBooking: typeof transferForBooking;
};
const realDeps: PayoutDeps = {
  stripeEnabled,
  listingsWithPayouts,
  getProfile: (id) => getProfile<ProfileWithPayout>(id),
  updateProfile: (id, initial, fn) => updateProfile<ProfileWithPayout>(id, initial, fn),
  listBookings: (id) => listBookings<PayoutBooking>(id),
  updateBooking: (id, code, fn) => updateBooking<PayoutBooking>(id, code, fn),
  chargeOf,
  settlementOf,
  transferForBooking,
};

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
  return ledgerOf(await listBookings<StoredBooking>(id), payout, now);
}

export type LedgerTotals = { currency: string; nextAmount: number; upcoming: number; paidTotal: number };

/**
 * One total per currency. A listing whose guests paid in both USD and CAD (a charge that settled in the
 * platform's currency, a listing that moved) used to have every amount added into one number under the first
 * booking's currency. The top-level fields are the listing's main currency (the one with the most bookings);
 * `totals` carries every currency, and the page shows the others beside it.
 */
export function ledgerOf(list: StoredBooking[], payout: Payout, now = new Date()) {
  const interval = payout.interval || "weekly";
  const next = cycleStart(cycleOf(now, interval) + (payout.lastCycle === cycleOf(now, interval) ? 1 : 0), interval);
  // A cycle pays on its Monday, and a run any later day of that cycle still pays, so once this cycle's Monday
  // has gone by the next payout is the next run, not a date in the past. The page used to say "Next payout ·
  // Monday, September 14" on the 15th and file money the next run would send under "later pay days".
  const today = now.toISOString().slice(0, 10);
  const nextDay = [next.toISOString().slice(0, 10), today].sort().at(-1)!;
  const byCurrency = new Map<string, LedgerTotals & { count: number }>();
  const history: { code: string; date: string; amount: number; currency: string; state: string; paidAt?: string }[] = [];
  for (const b of list) {
    if (!b.payout) continue;
    const cur = (b.payout.currency || "").toLowerCase();
    let t = byCurrency.get(cur);
    if (!t) byCurrency.set(cur, (t = { currency: cur, nextAmount: 0, upcoming: 0, paidTotal: 0, count: 0 }));
    t.count++;
    if (b.payout.state === "scheduled") {
      if (b.payout.releaseOn <= nextDay) t.nextAmount += b.payout.amount;
      else t.upcoming += b.payout.amount;
    }
    if (b.payout.state === "paid") t.paidTotal += b.payout.amount;
    history.push({ code: b.code, date: b.date, amount: b.payout.amount, currency: cur, state: b.payout.state, paidAt: b.payout.paidAt });
  }
  // Most bookings first, then alphabetical, so the main currency is stable from one read to the next.
  const totals: LedgerTotals[] = [...byCurrency.values()]
    .sort((a, b) => b.count - a.count || a.currency.localeCompare(b.currency))
    .map(({ currency, nextAmount, upcoming, paidTotal }) => ({ currency, nextAmount, upcoming, paidTotal }));
  const main = totals[0] || { currency: "", nextAmount: 0, upcoming: 0, paidTotal: 0 };
  return { currency: main.currency, nextPayoutOn: nextDay, nextAmount: main.nextAmount, upcoming: main.upcoming, paidTotal: main.paidTotal, totals, history: history.slice(0, 50) };
}

/** Weekly or every two weeks, both on Mondays. */
payouts.put("/payouts/:id/schedule", rateLimit(60, 60 * 60 * 1000), async (c) => {
  const id = String(c.req.param("id") ?? "");
  if (!ID.test(id) || !mayEdit(c, id)) return c.json({ error: "not allowed" }, 403);
  const body = await jsonBody<{ interval: string }>(c);
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
export async function runPayouts(now = new Date(), deps: PayoutDeps = realDeps): Promise<PayoutRun> {
  const out: PayoutRun = { listings: 0, paid: 0, amount: {}, skipped: [], failed: [] };
  if (!deps.stripeEnabled()) return out;
  const ids = await deps.listingsWithPayouts();
  const today = now.toISOString().slice(0, 10);
  for (const id of ids) {
    out.listings++;
    const rec = await deps.getProfile(id);
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
    const list = await deps.listBookings(id);
    const due = list.filter((b) => b.payout?.state === "scheduled" && b.payout.releaseOn <= today && b.payout.amount > 0 && ["accepted", "completed", "noshow"].includes(b.status));
    for (const b of due) {
      try {
        const charge = b.payment?.charge || (b.payment?.intent ? await deps.chargeOf(b.payment.intent) : null);
        // The transfer's amount and currency are fixed the first time this booking is attempted and reused on
        // every retry, because the idempotency key `transfer-<code>` (which is what stops a double pay when
        // the transfer went through but the state write did not) only replays under identical parameters.
        let amount = b.payout!.transferAmount;
        let currency = b.payout!.transferCurrency;
        if (amount == null || !currency) {
          // A transfer funded by a charge must be in the currency that charge settled in.
          const settled = charge ? await deps.settlementOf(charge) : { currency: b.payout!.currency, rate: 1 };
          amount = Math.round(b.payout!.amount * settled.rate);
          currency = settled.currency;
          const snap = { transferAmount: amount, transferCurrency: currency };
          await deps.updateBooking(id, b.code, (x) => ({ ...x, payout: { ...x.payout!, ...snap } }));
        }
        const transfer = await deps.transferForBooking({ code: b.code, listing: id, account: payout.account, amount, currency, charge });
        await deps.updateBooking(id, b.code, (x) => ({ ...x, payout: { ...x.payout!, state: "paid" as const, transfer, paidAt: now.toISOString(), cycle } }));
        out.paid++;
        out.amount[currency] = (out.amount[currency] || 0) + amount;
      } catch (e) {
        out.failed.push({ code: b.code, error: (e as Error).message.slice(0, 200) });
      }
    }
    if (due.length && !out.failed.some((f) => due.some((b) => b.code === f.code)))
      await deps.updateProfile(id, rec!, (cur) => ({ ...cur, payout: { ...cur.payout!, lastCycle: cycle } }));
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
payouts.post("/admin/payouts/run", rateLimit(10, 60 * 60 * 1000), async (c) => {
  // A plain !== short-circuits on the first wrong byte, and nothing capped the guesses.
  const key = process.env.ADMIN_KEY || "";
  const got = c.req.header("x-admin-key") || "";
  const same = !!key && got.length === key.length && timingSafeEqual(Buffer.from(got), Buffer.from(key));
  if (!same) return c.json({ error: "not found" }, 404);
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
        // Stripe refuses `transfers` on its own for a US account ("You cannot request the transfers capability
        // without the card_payments capability for accounts in US"), so the Payouts button used to fail with a
        // 502 for every US shop, which is most of the catalog. Both capabilities are valid in the US and Canada.
        // We still charge the guest on the platform and transfer the operator's share, so nothing else changes.
        "capabilities[transfers][requested]": "true",
        "capabilities[card_payments][requested]": "true",
        "metadata[listing]": id,
      });
      account = a.id;
      // The account id is written down the moment Stripe hands it over, before anything else that can fail.
      // It used to be saved last, after the payout-schedule call, so a failed write left an Express account
      // nobody referenced and the next click created a second one for the same shop. If the write fails once,
      // it is tried again from a fresh read; a profile that already got an account in between (a double click)
      // keeps that one.
      const withAccount = (cur: ProfileWithPayout): ProfileWithPayout =>
        cur.payout?.account ? cur : { ...cur, payout: { account: a.id, enabled: false, detailsSubmitted: false, updatedAt: new Date().toISOString() } };
      let saved: ProfileWithPayout;
      try {
        saved = await updateProfile<ProfileWithPayout>(id, rec, withAccount);
      } catch (e) {
        console.error(`[payouts] could not save account ${a.id} for ${id}, retrying: ${(e as Error).message}`);
        const fresh = (await getProfile<ProfileWithPayout>(id)) || rec;
        saved = await updateProfile<ProfileWithPayout>(id, fresh, withAccount);
      }
      account = saved.payout?.account || a.id;
      // Stripe sends whatever reaches the operator's balance to their bank the next business day; Outset decides
      // when money reaches the balance (their weekly or two-weekly pay day).
      await setAccountDailyPayouts(account).catch((e) => console.error(`[payouts] schedule for ${account}: ${(e as Error).message}`));
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
