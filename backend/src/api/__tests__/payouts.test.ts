import { test } from "node:test";
import assert from "node:assert/strict";

// Set before auth.ts is loaded, so claimSecret() never writes backend/data/claim-secret.txt from a test run.
process.env.CLAIM_SECRET ||= "payouts-test-secret";
const { ledgerOf, runPayouts } = await import("../payouts.ts");
type PayoutBooking = import("../payouts.ts").PayoutBooking;
type PayoutDeps = import("../payouts.ts").PayoutDeps;

type Profile = Parameters<PayoutDeps["updateProfile"]>[1];

const NOW = new Date("2026-09-16T12:00:00Z");

function booking(code: string, payout: Partial<NonNullable<PayoutBooking["payout"]>> & { amount: number; currency: string }, extra: Partial<PayoutBooking> = {}): PayoutBooking {
  return {
    code,
    listing: "o-shop",
    date: "2026-09-10",
    slot: "10:00",
    qty: 2,
    service: "Tour",
    variant: "",
    addons: [],
    total: 100,
    guest: { name: "Ann", phone: "", email: "" },
    status: "completed",
    created: "2026-09-01T00:00:00Z",
    payment: { session: "cs_1", intent: "pi_1", state: "captured", charge: "ch_1" },
    ...extra,
    payout: { state: "scheduled", releaseOn: "2026-09-11", ...payout },
  } as PayoutBooking;
}

/** A store and a Stripe that remember what they were asked, so a test can read the transfer parameters back. */
function fake(list: PayoutBooking[], o: { rate?: number; settledCurrency?: string; failStateWrite?: boolean } = {}) {
  const bookings = new Map(list.map((b) => [b.code, b]));
  const transfers: { code: string; amount: number; currency: string }[] = [];
  let profile: Profile = { id: "o-shop", claimedAt: "", updatedAt: "", owner: { name: "", email: "", phone: "" }, published: true, patch: {}, payout: { account: "acct_1", enabled: true, detailsSubmitted: true, updatedAt: "" } } as unknown as Profile;
  let stateWrites = 0;
  const deps: PayoutDeps = {
    stripeEnabled: () => true,
    listingsWithPayouts: async () => ["o-shop"],
    getProfile: async () => profile,
    updateProfile: async (_id, _initial, fn) => (profile = fn(profile)),
    listBookings: async () => [...bookings.values()],
    updateBooking: async (_id, code, fn) => {
      const cur = bookings.get(code)!;
      const next = fn(cur);
      if (o.failStateWrite && next.payout?.state === "paid") {
        stateWrites++;
        throw new Error("db: connection reset");
      }
      bookings.set(code, next);
      return next;
    },
    chargeOf: async () => "ch_1",
    settlementOf: async () => ({ currency: o.settledCurrency || "cad", rate: o.rate ?? 1 }),
    transferForBooking: async (t) => {
      // Stripe replays an idempotent request only when its parameters match the first one.
      const first = transfers.find((x) => x.code === t.code);
      if (first && (first.amount !== t.amount || first.currency !== t.currency)) throw new Error("stripe: Keys for idempotent requests can only be used with the same parameters");
      transfers.push({ code: t.code, amount: t.amount, currency: t.currency });
      return "tr_" + t.code;
    },
  };
  return { deps, transfers, bookings, get profile() { return profile; }, get stateWrites() { return stateWrites; }, setRate: (r: number) => { o.rate = r; }, allowStateWrite: () => { o.failStateWrite = false; } };
}

/**
 * A transfer is keyed by the booking code so a rerun cannot pay twice. The amount used to be recomputed from
 * the charge's exchange rate on each attempt, so when the transfer went through but the state write failed,
 * the retry on the next run sent a different amount under the same key and Stripe refused it forever.
 */
test("a retried transfer reuses the amount and currency of the first attempt even when the rate moved", async () => {
  const s = fake([booking("WK-1001", { amount: 10000, currency: "usd" })], { rate: 1.35, settledCurrency: "cad", failStateWrite: true });
  const first = await runPayouts(NOW, s.deps);
  assert.equal(first.paid, 0);
  assert.equal(first.failed.length, 1);
  assert.deepEqual(s.transfers, [{ code: "WK-1001", amount: 13500, currency: "cad" }]);
  // The first attempt wrote the transfer parameters down before calling Stripe.
  assert.equal(s.bookings.get("WK-1001")!.payout!.transferAmount, 13500);
  assert.equal(s.bookings.get("WK-1001")!.payout!.transferCurrency, "cad");
  assert.equal(s.bookings.get("WK-1001")!.payout!.state, "scheduled");

  s.setRate(1.41);
  s.allowStateWrite();
  const second = await runPayouts(NOW, s.deps);
  assert.equal(second.failed.length, 0, JSON.stringify(second.failed));
  assert.equal(second.paid, 1);
  assert.deepEqual(second.amount, { cad: 13500 });
  assert.equal(s.transfers.length, 2);
  assert.deepEqual(s.transfers[1], { code: "WK-1001", amount: 13500, currency: "cad" });
  assert.equal(s.bookings.get("WK-1001")!.payout!.state, "paid");
  assert.equal(s.bookings.get("WK-1001")!.payout!.transfer, "tr_WK-1001");
  assert.equal(s.profile.payout!.lastCycle != null, true);
});

test("a booking with no snapshot yet is priced from the charge's settlement once, and that stays", async () => {
  const s = fake([booking("WK-1002", { amount: 5000, currency: "usd" })], { rate: 1.2, settledCurrency: "cad" });
  const r = await runPayouts(NOW, s.deps);
  assert.equal(r.paid, 1);
  assert.deepEqual(s.transfers, [{ code: "WK-1002", amount: 6000, currency: "cad" }]);
  assert.equal(s.bookings.get("WK-1002")!.payout!.transferAmount, 6000);
  assert.equal(s.bookings.get("WK-1002")!.payout!.transferCurrency, "cad");
});

/**
 * The ledger used to add every booking into one number under the first booking's currency: a shop with a
 * USD and a CAD booking showed their sum as if it were one currency.
 */
test("the ledger keeps one total per currency and never mixes them", () => {
  const list = [
    booking("A", { amount: 10000, currency: "usd", state: "scheduled", releaseOn: "2026-09-11" }),
    booking("B", { amount: 7000, currency: "cad", state: "scheduled", releaseOn: "2026-09-11" }),
    booking("C", { amount: 2500, currency: "usd", state: "scheduled", releaseOn: "2026-12-01" }),
    booking("D", { amount: 4000, currency: "usd", state: "paid", paidAt: "2026-09-07T00:00:00Z" }),
    booking("E", { amount: 900, currency: "CAD", state: "paid", paidAt: "2026-09-07T00:00:00Z" }),
    booking("F", { amount: 100, currency: "usd", state: "cancelled" }),
  ];
  const l = ledgerOf(list, { account: "acct_1", enabled: true, detailsSubmitted: true, updatedAt: "" }, NOW);
  assert.equal(l.currency, "usd");
  assert.equal(l.nextAmount, 10000);
  assert.equal(l.upcoming, 2500);
  assert.equal(l.paidTotal, 4000);
  assert.deepEqual(l.totals, [
    { currency: "usd", nextAmount: 10000, upcoming: 2500, paidTotal: 4000 },
    { currency: "cad", nextAmount: 7000, upcoming: 0, paidTotal: 900 },
  ]);
  assert.equal(l.history.length, 6);
  assert.equal(l.history.find((h) => h.code === "E")!.currency, "cad");
});

test("a listing with no payouts yet reports empty totals, not NaN", () => {
  const l = ledgerOf([], { account: "acct_1", enabled: true, detailsSubmitted: true, updatedAt: "" }, NOW);
  assert.equal(l.currency, "");
  assert.equal(l.nextAmount, 0);
  assert.deepEqual(l.totals, []);
  assert.deepEqual(l.history, []);
});
