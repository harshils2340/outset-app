import { createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * End-to-end check of the money path, from a guest's booking to an operator's bank, with Stripe replaced by a
 * recorder. Nothing leaves the machine and no card is charged. It drives the real API routes and the real payout
 * run against a scratch Postgres branch (E2E_DATABASE_URL, never production: the run deletes and rewrites the
 * o-e2e-* listings) and a throwaway folder for the catalog files:
 *
 *   guest books a Florida tour -> checkout is in USD, not CAD
 *   Stripe reports the card held -> the operator is asked to accept
 *   operator accepts -> the card is captured, the split is recorded, the operator's share is scheduled
 *   payout run before the trip -> nothing is paid
 *   payout run on the pay day after the trip -> one transfer for exactly the operator's share
 *   payout run again the same cycle -> nothing more
 *   every two weeks -> the off week pays nothing, the on week pays
 *   a shop without a connected bank -> money waits, with the reason
 *   a paid booking cancelled -> guest refunded and the transfer reversed
 *
 *   E2E_DATABASE_URL=postgresql://... npx tsx scripts/payout-e2e.mts
 */

const store = mkdtempSync(join(tmpdir(), "outset-payout-e2e-"));
process.env.STORE_DIR = store;
if (!process.env.E2E_DATABASE_URL) {
  console.log("E2E_DATABASE_URL is not set; skipping the payout e2e (point it at a scratch Neon branch).");
  process.exit(0);
}
process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
process.env.STRIPE_SECRET_KEY = "sk_test_recorder";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_recorder";
process.env.CLAIM_SECRET = "e2e-claim-secret";
process.env.ADMIN_KEY = "e2e-admin";
process.env.BOOKING_ALERT_EMAIL = "";
delete process.env.GITHUB_TOKEN;
delete process.env.RESEND_API_KEY;
delete process.env.DATA_REPO;
delete process.env.STRIPE_CURRENCY;

type Call = { method: string; path: string; body: Record<string, string>; idem?: string };
const calls: Call[] = [];
// A USD charge on the Canadian platform settles in CAD at this rate unless SETTLE_USD is set.
let settleUsd = false;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith("https://api.stripe.com/v1/")) return realFetch(input, init);
  const path = url.slice("https://api.stripe.com/v1/".length);
  const body = Object.fromEntries(new URLSearchParams(String(init?.body || "")));
  const headers = (init?.headers || {}) as Record<string, string>;
  calls.push({ method: init?.method || "GET", path, body, idem: headers["idempotency-key"] });
  const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
  if (path === "checkout/sessions") return json({ id: "cs_" + body["metadata[code]"], url: "https://checkout.stripe.test/" + body["metadata[code]"], payment_intent: "pi_" + body["metadata[code]"] });
  if (/^payment_intents\/[^/]+\/capture$/.test(path)) return json({ status: "succeeded", latest_charge: "ch_" + path.split("/")[1] });
  if (/^payment_intents\/[^/]+\/cancel$/.test(path)) return json({ status: "canceled" });
  if (/^payment_intents\/[^/]+$/.test(path)) return json({ status: "succeeded", latest_charge: "ch_" + path.split("/")[1] });
  if (path.startsWith("charges/")) return json({ currency: "usd", balance_transaction: settleUsd ? { currency: "usd", exchange_rate: null } : { currency: "cad", exchange_rate: 1.36 } });
  if (path === "transfers") return json({ id: "tr_" + body["metadata[code]"] });
  if (/^transfers\/[^/]+\/reversals$/.test(path)) return json({ id: "trr_" + path.split("/")[1] });
  if (path === "refunds") return json({ status: "succeeded" });
  if (path.startsWith("accounts/")) return json({ id: path.split("/")[1], payouts_enabled: true, details_submitted: true });
  return new Response(JSON.stringify({ error: { message: "recorder has no answer for " + path } }), { status: 400 });
}) as typeof fetch;

const { app } = await import("../src/api/routes.ts");
const { signSession } = await import("../src/api/auth.ts");
const { runPayouts } = await import("../src/api/payouts.ts");
const { getBooking, getProfile, listBookings, listingsWithPayouts, putBooking, putProfile } = await import("../src/lib/repo.ts");
const { migratePg, query } = await import("../src/db/pg.ts");
await migratePg();
await query("delete from bookings where listing like 'o-e2e-%'");
await query("delete from profiles where id like 'o-e2e-%'");
type E2EProfile = Parameters<typeof putProfile>[0];
const { cycleOf, cycleStart, releaseDate } = await import("../src/payments/money.ts");

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log((ok ? "  pass  " : "  FAIL  ") + name + (ok || detail === undefined ? "" : "  -> " + JSON.stringify(detail)));
  if (!ok) failures++;
};

const FL = "o-e2e-tampa-tours";
const ON = "o-e2e-tobermory-boats";
mkdirSync(join(store, "o"), { recursive: true });
writeFileSync(join(store, "o", FL + ".json"), JSON.stringify({ id: FL, title: "Tampa Tours", area: "Tampa, FL", options: [{ name: "Dolphin tour", detail: "Adult", price: 102.5 }], addons: [] }));
writeFileSync(join(store, "o", ON + ".json"), JSON.stringify({ id: ON, title: "Tobermory Boats", area: "Tobermory, ON", options: [{ name: "Pontoon rental", detail: "Half day", price: 101, per: "/boat" }], addons: [] }));
const owner = { name: "Sam Owner", email: "sam@example.com", phone: "8135550100" };
await putProfile({ id: FL, claimedAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", owner, published: true, profile: { instantBook: false }, patch: { title: "Tampa Tours" }, payout: { account: "acct_fl", enabled: true, detailsSubmitted: true, updatedAt: "2026-09-01T00:00:00Z" } });
await putProfile({ id: ON, claimedAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", owner, published: true, profile: { instantBook: true }, patch: { title: "Tobermory Boats" } });

const session = (id: string) => signSession({ ids: [id], email: owner.email, exp: Date.now() + 3600_000 });
const webhook = async (type: string, code: string, listing: string) => {
  const payload = JSON.stringify({ type, data: { object: { id: "cs_" + code, payment_intent: "pi_" + code, metadata: { code, listing } } } });
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", "whsec_recorder").update(t + "." + payload).digest("hex");
  return app.request("/stripe/webhook", { method: "POST", body: payload, headers: { "stripe-signature": `t=${t},v1=${sig}` } });
};
const iso = (d: Date) => d.toISOString().slice(0, 10);
const trip = iso(new Date(Date.now() + 3 * 86400000));
const book = (listing: string, code: string, total: number, service = "Dolphin tour", variant = "Adult") =>
  // One time, one party: the booking route refuses a second booking at a time that is already taken, so each
  // booking here takes its own start time. This test is about the money, not the calendar.
  app.request("/bookings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ listing, code, date: trip, slot: ["09:00", "11:00", "13:00", "15:00", "17:00"][(Number(code.replace(/\D/g, "")) - 1) % 5], qty: 2, total, service, variant, guest: { name: "Guest One", phone: "4165550100", email: "guest@example.com" } }) });
const bookingOf = async (listing: string, code: string) => getBooking<{ code: string; status: string; payment?: { state: string; split?: { net: number; commission: number; guestFee: number; subtotal: number } }; payout?: { state: string; amount: number; currency: string; releaseOn: string; transfer?: string } } & { listing: string; date: string; created: string }>(listing, code);

console.log("\n1. Guest books a Florida tour for $213");
const r1 = (await (await book(FL, "E2E-001", 213)).json()) as { status: string; checkoutUrl?: string };
const co = calls.find((c) => c.path === "checkout/sessions");
check("checkout opens", !!r1.checkoutUrl, r1);
check("charged in USD, not CAD", co?.body["line_items[0][price_data][currency]"] === "usd", co?.body["line_items[0][price_data][currency]"]);
check("guest pays $213.00", co?.body["line_items[0][price_data][unit_amount]"] === "21300");
check("card is only held", co?.body["payment_intent_data[capture_method]"] === "manual");

console.log("\n2. Stripe confirms the hold");
await webhook("checkout.session.completed", "E2E-001", FL);
let b = await bookingOf(FL, "E2E-001");
check("request waits for the operator", b?.status === "new" && b.payment?.state === "authorized", b);
check("nothing captured yet", !calls.some((c) => c.path.endsWith("/capture")));

console.log("\n3. Operator accepts");
await app.request(`/bookings/${FL}/E2E-001`, { method: "PATCH", headers: { "content-type": "application/json", "x-session": session(FL) }, body: JSON.stringify({ status: "accepted" }) });
b = await bookingOf(FL, "E2E-001");
check("card captured", b?.payment?.state === "captured", b?.payment);
check("split: $205 price, $8 guest fee, $10.25 commission, $194.75 to the operator", b?.payment?.split?.subtotal === 20500 && b.payment.split.guestFee === 800 && b.payment.split.commission === 1025 && b.payment.split.net === 19475, b?.payment?.split);
check("operator's share scheduled for the day after the trip", b?.payout?.state === "scheduled" && b.payout.amount === 19475 && b.payout.releaseOn === iso(releaseDate(trip)), b?.payout);
check("listing is on the payout list", (await listingsWithPayouts()).includes(FL));

console.log("\n4. Payout run before the trip");
let run = await runPayouts(new Date());
check("nothing paid before the experience", run.paid === 0, run);

console.log("\n5. Payout run on the first pay day after the trip (weekly)");
const payday = cycleStart(cycleOf(releaseDate(trip), "weekly") + 1, "weekly");
run = await runPayouts(payday);
const tr = calls.filter((c) => c.path === "transfers");
check("one transfer", run.paid === 1 && tr.length === 1, run);
check("to the operator's Stripe account", tr[0]?.body.destination === "acct_fl");
check("funded by the booking's own charge", tr[0]?.body.source_transaction === "ch_pi_E2E-001");
check("$194.75 USD settled in CAD at 1.36 = 26486 cents CAD", tr[0]?.body.amount === "26486" && tr[0]?.body.currency === "cad", tr[0]?.body);
check("idempotency key per booking", tr[0]?.idem === "transfer-E2E-001");
b = await bookingOf(FL, "E2E-001");
check("booking marked paid", b?.payout?.state === "paid" && b.payout.transfer === "tr_E2E-001", b?.payout);

console.log("\n6. Payout run again in the same cycle");
run = await runPayouts(new Date(payday.getTime() + 2 * 86400000));
check("no second transfer", calls.filter((c) => c.path === "transfers").length === 1, run);

console.log("\n7. Every two weeks");
await putProfile({ ...(await getProfile<E2EProfile>(FL))!, payout: { account: "acct_fl", enabled: true, detailsSubmitted: true, updatedAt: "x", interval: "biweekly" } });
settleUsd = true;
await book(FL, "E2E-002", 213);
await webhook("checkout.session.completed", "E2E-002", FL);
await app.request(`/bookings/${FL}/E2E-002`, { method: "PATCH", headers: { "content-type": "application/json", "x-session": session(FL) }, body: JSON.stringify({ status: "accepted" }) });
const bi = cycleOf(releaseDate(trip), "biweekly") + 1;
const onDay = cycleStart(bi, "biweekly");
const offDay = new Date(onDay.getTime() - 7 * 86400000);
check("the off Monday is in the previous two-week cycle", cycleOf(offDay, "biweekly") === bi - 1);
run = await runPayouts(onDay);
const tr2 = calls.filter((c) => c.path === "transfers" && c.body["metadata[code]"] === "E2E-002");
check("pays on the two-week Monday", tr2.length === 1 && run.paid === 1, run);
check("USD-settled charge transfers $194.75 USD", tr2[0]?.body.amount === "19475" && tr2[0]?.body.currency === "usd", tr2[0]?.body);

console.log("\n8. A Canadian shop with no bank connected");
await book(ON, "E2E-003", 105, "Pontoon rental", "Half day");
const co3 = calls.filter((c) => c.path === "checkout/sessions").at(-1);
check("charged in CAD", co3?.body["line_items[0][price_data][currency]"] === "cad");
await webhook("checkout.session.completed", "E2E-003", ON);
const b3 = await bookingOf(ON, "E2E-003");
check("instant booking captured and scheduled", b3?.payment?.state === "captured" && b3.payout?.state === "scheduled" && b3.payout.currency === "cad", b3);
run = await runPayouts(cycleStart(cycleOf(releaseDate(trip), "weekly") + 1, "weekly"));
check("money waits with a reason", run.skipped.some((s) => s.listing === ON && /no bank/.test(s.reason)), run.skipped);
check("no transfer to a shop without an account", !calls.some((c) => c.path === "transfers" && c.body["metadata[code]"] === "E2E-003"));

console.log("\n9. A paid booking is cancelled");
await app.request(`/bookings/${FL}/E2E-001`, { method: "PATCH", headers: { "content-type": "application/json", "x-session": session(FL) }, body: JSON.stringify({ status: "cancelled" }) });
b = await bookingOf(FL, "E2E-001");
check("guest refunded", calls.some((c) => c.path === "refunds" && c.body.payment_intent === "pi_E2E-001") && b?.payment?.state === "released", b?.payment);
check("operator's transfer reversed", calls.some((c) => c.path === "transfers/tr_E2E-001/reversals") && b?.payout?.state === "reversed", b?.payout);

console.log("\n10. A guest edits the price in the request");
await book(FL, "E2E-004", 1);
const co4 = calls.filter((c) => c.path === "checkout/sessions").at(-1);
check("charged the listing's $213, not the $1 sent", co4?.body["metadata[code]"] === "E2E-004" && co4.body["line_items[0][price_data][unit_amount]"] === "21300", co4?.body);

console.log("\n10b. A page cached before the labels were cleaned");
await book(FL, "E2E-005", 213, "dolphin  TOUR", "adult.");
const co5 = calls.filter((c) => c.path === "checkout/sessions").at(-1);
check("still finds the $213 option", co5?.body["metadata[code]"] === "E2E-005" && co5.body["line_items[0][price_data][unit_amount]"] === "21300", co5?.body);

console.log("\n11. Payout dashboard numbers");
const st = (await (await app.request(`/payouts/${FL}`, { headers: { "x-session": session(FL) } })).json()) as { interval: string; paidTotal: number; history: unknown[] };
check("reports the schedule and history", st.interval === "biweekly" && Array.isArray(st.history) && st.history.length === 2, st);
const refused = await app.request(`/payouts/${FL}/schedule`, { method: "PUT", headers: { "content-type": "application/json", "x-session": session(ON) }, body: JSON.stringify({ interval: "weekly" }) });
check("another owner cannot change the schedule", refused.status === 403);

console.log("\n12. The pay day the dashboard shows");
{
  // A trip that was yesterday: its money is released today, so the very next run sends it. The page used to
  // read the cycle's Monday straight out, so on any day but Monday it named a pay day in the past and filed
  // the money under "later pay days" while the run would have paid it that same day.
  const LG = "o-e2e-ledger";
  const today = iso(new Date());
  writeFileSync(join(store, "o", LG + ".json"), JSON.stringify({ id: LG, title: "Ledger Shop", area: "Tampa, FL", options: [], addons: [] }));
  await putProfile({ id: LG, claimedAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", owner, published: true, profile: {}, patch: { title: "Ledger Shop" }, payout: { account: "acct_lg", enabled: true, detailsSubmitted: true, updatedAt: "2026-09-01T00:00:00Z" } } as E2EProfile);
  await putBooking({ code: "E2E-LED", listing: LG, date: iso(new Date(Date.now() - 86400000)), slot: "09:00", qty: 1, service: "Tour", variant: "", addons: [], total: 100, guest: { name: "Guest", phone: "4165550100", email: "guest@example.com" }, status: "accepted", created: new Date().toISOString(), payout: { state: "scheduled", amount: 9500, currency: "usd", releaseOn: today } });
  const led = (await (await app.request(`/payouts/${LG}`, { headers: { "x-session": session(LG) } })).json()) as { nextPayoutOn: string; nextAmount: number; upcoming: number };
  check("the next pay day is never a date that has gone by", led.nextPayoutOn >= today, led);
  check("money the next run will send is counted as going out, not as later", led.nextAmount === 9500 && led.upcoming === 0, led);
}

console.log("\n13. Bookings the API should refuse");
{
  const G = { name: "Odd Guest", phone: "4165550100", email: "odd@example.com" };
  const post = (o: Record<string, unknown>) =>
    app.request("/bookings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ listing: FL, date: trip, slot: "07:00", qty: 1, service: "Dolphin tour", variant: "Adult", total: 213, guest: G, ...o }) });
  const ghost = await post({ listing: "o-no-such-shop-anywhere", code: "E2E-GHOST" });
  check("a booking for a listing that does not exist is refused", ghost.status === 404, await ghost.json());
  check("and no booking was stored for it", (await listBookings("o-no-such-shop-anywhere")).length === 0);
  const feb30 = await post({ code: "E2E-FEB30", date: `${new Date().getFullYear() + 1}-02-30` });
  check("a day that is not on the calendar is refused", feb30.status === 400, await feb30.json());
  for (const slot of ["24:00", "12:99", "99:99"]) {
    const bad = await post({ code: "E2E-T" + slot.replace(":", ""), slot });
    check(`${slot} is bad input, not a taken slot`, bad.status === 400, await bad.json());
  }
}

console.log("\n14. A guest who pays on site");
{
  // With no Stripe key the server never priced the booking at all and kept whatever total the browser sent,
  // so the operator's email could promise them $0.95 for a $213 tour.
  const key = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = "";
  const r = await app.request("/bookings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ listing: FL, code: "E2E-SITE", date: trip, slot: "07:00", qty: 2, service: "Dolphin tour", variant: "Adult", total: 1, guest: { name: "Site Payer", phone: "4165550100", email: "site@example.com" } }) });
  process.env.STRIPE_SECRET_KEY = key;
  check("the booking is taken as pay on site", r.status === 200 && ((await r.json()) as { status: string }).status === "new");
  const b6 = await getBooking<{ code: string; listing: string; status: string; date: string; created: string; total: number; pricing?: { subtotal: number; fee: number } }>(FL, "E2E-SITE");
  check("priced from the listing at $213, not the $1 sent", b6?.total === 213 && b6.pricing?.subtotal === 205 && b6.pricing.fee === 8, b6);
}

console.log("\n15. A date in another year says which year");
{
  const { fmtDay } = await import("../src/lib/emailTemplate.ts");
  const now = new Date(2026, 11, 20);
  check("this year needs no year", fmtDay("2026-12-25", now) === "Friday, December 25", fmtDay("2026-12-25", now));
  check("next January carries its year", fmtDay("2027-01-03", now) === "Sunday, January 3, 2027", fmtDay("2027-01-03", now));
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll payout checks passed");
process.exit(failures ? 1 : 0);
