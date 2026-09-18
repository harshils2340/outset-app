import { test } from "node:test";
import assert from "node:assert/strict";

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Set before auth.ts loads, so claimSecret() never writes backend/data/claim-secret.txt from a test run.
process.env.CLAIM_SECRET ||= "metrics-test-secret";
// A throwaway public/ so the catalog reader is exercised against a fixture and never the real 23 MB catalog.
// store.ts fixes its directory at import time, so this has to be set before the imports below.
const STORE = mkdtempSync(join(tmpdir(), "outset-metrics-"));
process.env.STORE_DIR = STORE;

const { clampDays, clearCatalogCache, collectMetrics, dayRange, fillDays, makeMetrics, pgDeps, shortName, summarizeBookings } = await import("../metrics.ts");
const { signSession } = await import("../auth.ts");
type MetricsDeps = import("../metrics.ts").MetricsDeps;
type BookingGroup = import("../metrics.ts").BookingGroup;

const NOW = new Date("2026-09-18T12:00:00Z");

function group(g: Partial<BookingGroup>): BookingGroup {
  return { status: "accepted", pay: "captured", payout: "scheduled", currency: "usd", n: 1, total: 0, fee: 0, payoutAmount: 0, ...g };
}

/** Every dependency answers empty; a test overrides only the ones it is about. */
function deps(over: Partial<MetricsDeps> = {}): MetricsDeps {
  return {
    outreachTotals: async () => ({ sent: 0, bounced: 0, complained: 0 }),
    outreachDays: async () => [],
    suppression: async () => ({ suppressed: 0, unsubscribed: 0 }),
    claimTotals: async () => ({ claimed: 0, published: 0 }),
    claimDays: async () => [],
    recentClaims: async () => [],
    bookingGroups: async () => [],
    bookingDays: async () => [],
    recentBookings: async () => [],
    bookedListings: async () => 0,
    catalog: async () => ({ total: null, reachable: null, asOf: null, note: null }),
    ...over,
  };
}

/* ---------- money ---------- */

test("gross counts captured payments only, and fee plus operator net add back up to it", () => {
  const s = summarizeBookings([
    group({ status: "accepted", pay: "captured", total: 150, fee: 15, payout: "scheduled", payoutAmount: 135 }),
    group({ status: "new", pay: "authorized", total: 200, fee: 20, payout: "none" }),
    group({ status: "completed", pay: "captured", total: 99.994, fee: 9.999, payout: "paid", payoutAmount: 90 }),
  ]);
  assert.equal(s.money.gross, 249.99);
  assert.equal(s.money.captured, 249.99);
  assert.equal(s.money.authorized, 200);
  assert.equal(s.money.fee, 25);
  assert.equal(s.money.operatorNet, 224.99);
  assert.equal(Math.round((s.money.fee + s.money.operatorNet) * 100) / 100, s.money.gross);
  assert.deepEqual(s.money.payouts, { scheduled: 135, paid: 90, reversed: 0 });
});

test("a released hold is not a refund, and a released capture is", () => {
  const s = summarizeBookings([
    // Declined before capture: the money was never taken.
    group({ status: "declined", pay: "released", payout: "none", total: 80 }),
    // Captured, then refunded: the operator's share was taken back too.
    group({ status: "cancelled", pay: "released", payout: "reversed", total: 120, payoutAmount: 108 }),
    // Captured, then refunded before the payout went out.
    group({ status: "cancelled", pay: "released", payout: "cancelled", total: 60 }),
  ]);
  assert.equal(s.money.refunded, 180);
  assert.equal(s.money.gross, 0);
  assert.equal(s.money.payouts.reversed, 108);
});

test("counts land under their own status and the total is every booking", () => {
  const s = summarizeBookings([
    group({ status: "new", n: 3, pay: "authorized" }),
    group({ status: "accepted", n: 2 }),
    group({ status: "noshow", n: 1 }),
  ]);
  assert.equal(s.total, 6);
  assert.equal(s.byStatus.new, 3);
  assert.equal(s.byStatus.accepted, 2);
  assert.equal(s.byStatus.noshow, 1);
  // The statuses nothing happened in are still present as zeros, so the page never has to guess a key.
  assert.equal(s.byStatus.completed, 0);
  assert.equal(s.byStatus.cancelled, 0);
  assert.equal(s.byStatus.declined, 0);
  assert.equal(s.byStatus.pending, 0);
});

test("the busiest currency is the one reported", () => {
  const s = summarizeBookings([group({ currency: "usd", n: 2 }), group({ currency: "cad", n: 5 })]);
  assert.equal(s.money.currency, "cad");
  assert.equal(summarizeBookings([]).money.currency, "usd");
});

/* ---------- the window ---------- */

test("days clamps to 1..365 and falls back to 90", () => {
  assert.equal(clampDays(undefined), 90);
  assert.equal(clampDays("not a number"), 90);
  assert.equal(clampDays("30"), 30);
  assert.equal(clampDays("0"), 1);
  assert.equal(clampDays("-12"), 1);
  assert.equal(clampDays("100000"), 365);
  assert.equal(clampDays("7.9"), 7);
});

test("the day range is ascending, ends today and has one entry per day", () => {
  const range = dayRange(3, NOW);
  assert.deepEqual(range, ["2026-09-16", "2026-09-17", "2026-09-18"]);
  assert.equal(dayRange(365, NOW).length, 365);
});

test("fillDays puts a zero on every day nothing happened", () => {
  const out = fillDays(dayRange(3, NOW), [{ day: "2026-09-17", sent: 4 }], (day) => ({ day, sent: 0 }));
  assert.deepEqual(out, [
    { day: "2026-09-16", sent: 0 },
    { day: "2026-09-17", sent: 4 },
    { day: "2026-09-18", sent: 0 },
  ]);
});

/* ---------- the whole payload ---------- */

test("every series is filled, in range, and ascending", async () => {
  const m = await collectMetrics(
    deps({
      outreachDays: async () => [{ day: "2026-09-17", sent: 2, bounced: 1 }],
      claimDays: async () => [{ day: "2026-09-18", claimed: 3 }],
      bookingDays: async () => [{ day: "2026-09-16", booked: 2, gross: 300, fee: 30 }],
    }),
    3,
    NOW,
  );
  assert.equal(m.days, 3);
  assert.equal(m.generatedAt, NOW.toISOString());
  for (const series of [m.outreach.byDay, m.claims.byDay, m.bookings.byDay, m.money.byDay]) {
    assert.equal(series.length, 3);
    assert.deepEqual(
      series.map((d) => d.day),
      ["2026-09-16", "2026-09-17", "2026-09-18"],
    );
  }
  assert.deepEqual(m.outreach.byDay[0], { day: "2026-09-16", sent: 0, bounced: 0 });
  assert.equal(m.claims.claimedInRange, 3);
  assert.equal(m.bookings.inRange, 2);
  assert.deepEqual(m.bookings.byDay[0], { day: "2026-09-16", booked: 2, gross: 300 });
  assert.deepEqual(m.money.byDay[0], { day: "2026-09-16", gross: 300, fee: 30 });
});

test("a booking window asked for in days does not change the lifetime totals", async () => {
  const m = await collectMetrics(
    deps({
      bookingGroups: async () => [group({ n: 5, total: 500, fee: 50 })],
      bookingDays: async () => [{ day: "2026-09-18", booked: 1, gross: 100, fee: 10 }],
    }),
    2,
    NOW,
  );
  assert.equal(m.bookings.total, 5);
  assert.equal(m.bookings.inRange, 1);
  assert.equal(m.money.gross, 500);
});

test("an unreadable catalog is null with a note, never a zero", async () => {
  const m = await collectMetrics(
    deps({
      claimTotals: async () => ({ claimed: 4, published: 3 }),
      catalog: async () => ({ total: null, reachable: null, asOf: null, note: "public/catalog-lite.json is not readable here" }),
    }),
    7,
    NOW,
  );
  assert.equal(m.catalog.total, null);
  assert.equal(m.catalog.unclaimed, null);
  assert.equal(m.catalog.reachable, null);
  assert.equal(m.funnel.reachable, null);
  assert.match(m.catalog.note || "", /catalog/);
  // What is known is still reported.
  assert.equal(m.catalog.claimed, 4);
});

test("unclaimed is the catalog minus the claims, and the funnel reads across the two stores", async () => {
  const m = await collectMetrics(
    deps({
      catalog: async () => ({ total: 1000, reachable: 400, asOf: "2026-09-18T21:28:05.301Z", note: null }),
      claimTotals: async () => ({ claimed: 12, published: 9 }),
      outreachTotals: async () => ({ sent: 250, bounced: 7, complained: 1 }),
      bookedListings: async () => 5,
    }),
    30,
    NOW,
  );
  assert.equal(m.catalog.unclaimed, 988);
  assert.deepEqual(m.funnel, { reachable: 400, emailed: 250, claimed: 12, listed: 9, booked: 5 });
  assert.equal(m.outreach.bounced, 7);
  assert.equal(m.outreach.complained, 1);
});

test("a guest is shown by first name and an initial, never in full", () => {
  assert.equal(shortName("Christina Delacroix"), "Christina D.");
  assert.equal(shortName("  Ann  "), "Ann");
  assert.equal(shortName(""), "");
  assert.equal(shortName(null), "");
});

/* ---------- the gate ---------- */

const app = makeMetrics(deps());

function session(email: string, exp = Date.now() + 60_000): string {
  return signSession({ ids: [], email, exp });
}

test("no session and no key is 404, never 403", async () => {
  process.env.ADMIN_EMAILS = "harshils2340@gmail.com";
  process.env.ADMIN_KEY = "metrics-admin-key";
  const res = await app.request("/admin/metrics");
  assert.equal(res.status, 404);
});

test("a session for an address that is not on the list is 404", async () => {
  process.env.ADMIN_EMAILS = "harshils2340@gmail.com";
  const res = await app.request("/admin/metrics", { headers: { "x-session": session("someone@else.com") } });
  assert.equal(res.status, 404);
});

test("an allowlisted session is 200", async () => {
  process.env.ADMIN_EMAILS = " Harshils2340@Gmail.com , other@outset.com ";
  const res = await app.request("/admin/metrics", { headers: { "x-session": session("harshils2340@gmail.com") } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { days: number };
  assert.equal(body.days, 90);
});

test("the admin key is 200, and a wrong key is 404", async () => {
  process.env.ADMIN_EMAILS = "";
  process.env.ADMIN_KEY = "metrics-admin-key";
  assert.equal((await app.request("/admin/metrics?days=7", { headers: { "x-admin-key": "metrics-admin-key" } })).status, 200);
  assert.equal((await app.request("/admin/metrics", { headers: { "x-admin-key": "metrics-admin-keZ" } })).status, 404);
  assert.equal((await app.request("/admin/metrics", { headers: { "x-admin-key": "short" } })).status, 404);
});

test("an empty ADMIN_EMAILS closes the session door", async () => {
  process.env.ADMIN_EMAILS = "";
  const res = await app.request("/admin/metrics", { headers: { "x-session": session("harshils2340@gmail.com") } });
  assert.equal(res.status, 404);
});

test("an expired session is 404", async () => {
  process.env.ADMIN_EMAILS = "harshils2340@gmail.com";
  const res = await app.request("/admin/metrics", { headers: { "x-session": session("harshils2340@gmail.com", Date.now() - 1000) } });
  assert.equal(res.status, 404);
});

test("the days query reaches the payload", async () => {
  process.env.ADMIN_KEY = "metrics-admin-key";
  const res = await app.request("/admin/metrics?days=400", { headers: { "x-admin-key": "metrics-admin-key" } });
  const body = (await res.json()) as { days: number; outreach: { byDay: unknown[] } };
  assert.equal(body.days, 365);
  assert.equal(body.outreach.byDay.length, 365);
});

/* ---------- the catalog files ---------- */

function writeCatalog(operators: { id: string }[], generatedAt = "2026-09-18T21:28:05.028Z"): void {
  writeFileSync(join(STORE, "catalog.json"), JSON.stringify({ generatedAt, operators, contacts: {} }));
}

test("the catalog total is the published catalog, and reachable is the part of it we hold an address for", async () => {
  writeCatalog([{ id: "o-one-com" }, { id: "o-two-com" }, { id: "o-three-com" }]);
  writeFileSync(
    join(STORE, "claim-index.json"),
    JSON.stringify({
      "o-one-com": { d: ["one.com"], k: "aaa", h: "i...@one.com" },
      "o-two-com": { d: ["two.com"] },
      "o-three-com": { d: ["three.com"], k: "bbb" },
      // In the operator database but not published in the catalog: not a business anyone can claim yet, so it
      // must not inflate the top of the funnel.
      "o-unpublished-com": { d: ["unpublished.com"], k: "ccc" },
    }),
  );
  clearCatalogCache();
  const catalog = await pgDeps.catalog();
  assert.equal(catalog.total, 3);
  assert.equal(catalog.reachable, 2);
  assert.equal(catalog.asOf, "2026-09-18T21:28:05.028Z");
  assert.equal(catalog.note, null);
});

test("ids that straddle a read chunk are still counted", async () => {
  // Far past the 1 MB chunk the reader streams in, so an id lands across a boundary.
  writeCatalog(Array.from({ length: 30000 }, (_, i) => ({ id: "o-shop-" + i + "-com", blurb: "x".repeat(40) }) as { id: string }));
  clearCatalogCache();
  assert.equal((await pgDeps.catalog()).total, 30000);
});

test("no catalog file means null and a note, not a count from the 2,200-listing shard", async () => {
  rmSync(join(STORE, "catalog.json"));
  writeFileSync(join(STORE, "catalog-lite.json"), JSON.stringify({ generatedAt: "2026-09-18T21:28:05.301Z", operators: [{ id: "o-one-com" }] }));
  clearCatalogCache();
  const catalog = await pgDeps.catalog();
  assert.equal(catalog.total, null);
  assert.equal(catalog.reachable, null);
  // The timestamp is still worth having, and the note says why the counts are missing.
  assert.equal(catalog.asOf, "2026-09-18T21:28:05.301Z");
  assert.match(catalog.note || "", /catalog\.json is not in this checkout/);
  assert.match(catalog.note || "", /reachable needs the catalog ids/);
});

test.after(() => rmSync(STORE, { recursive: true, force: true }));
