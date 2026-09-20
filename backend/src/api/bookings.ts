import { Hono } from "hono";
import { ID, bodyText, jsonBody, mayEdit, rateLimit } from "./auth.ts";
import { readJson } from "../lib/store.ts";
import { getBooking, getProfile, getWallet, insertBookingChecked, listBookings, updateBooking, updateBookingChecked } from "../lib/repo.ts";
import type { StoredProfile } from "./profiles.ts";
import { capture, chargeSaved, createCheckout, releaseIntent, reverseTransfer, sessionStatus, stripeEnabled, verifyWebhook } from "../lib/stripe.ts";
import { agentMayCharge, WALLET_ID } from "../payments/wallet.ts";
import { attachWalletFromSession } from "./wallet.ts";
import { currencyForArea, priceBooking, releaseDate, splitBooking, type PricedOption, type Split } from "../payments/money.ts";
import { mailDecision, mailNewBooking } from "./bookingMail.ts";
import { slotOpen, weekOf, zoneOf } from "./openSlots.ts";
import { fmtWhen } from "../lib/emailTemplate.ts";
import { bookableRow } from "../../../src/lib/menuRow.ts";

/**
 * Bookings, one row each in Postgres. A guest's request is written here, the operator gets an email, and the
 * dashboard reads and decides through the same rows. Guests are told by email when the operator accepts or declines.
 */

export type StoredBooking = {
  code: string;
  listing: string;
  date: string;
  slot: string;
  qty: number;
  service: string;
  variant: string;
  addons: string[];
  total: number | null;
  guest: { name: string; phone: string; email: string };
  status: "pending" | "new" | "accepted" | "declined" | "completed" | "noshow" | "cancelled";
  created: string;
  decidedAt?: string;
  note?: string;
  /** The operator's price and the guest's service fee behind `total`, worked out from the listing at booking time. */
  pricing?: { subtotal: number; fee: number };
  /** Stripe: authorized at booking, captured on accept, released on decline. `session` is "wallet" when Otto held a saved card. */
  payment?: { session: string; intent: string | null; state: "authorized" | "captured" | "released" | "unpaid"; currency?: string; charge?: string | null; split?: Split; subtotal?: number; agent?: boolean };
  /**
   * The operator's share once the card is captured. "scheduled" waits for the day after the experience and the
   * operator's next pay day; "paid" carries the Stripe transfer; "reversed" means a refund took it back.
   */
  payout?: { state: "scheduled" | "paid" | "reversed" | "cancelled"; amount: number; currency: string; releaseOn: string; transfer?: string; paidAt?: string; cycle?: number };
};

/**
 * Card captured: record the split, schedule the operator's share, and remember the listing for the payout run.
 * Every capture in this file goes through here so no path takes money without owing the operator for it.
 */
export async function captureBooking(listing: string, code: string, intent: string): Promise<boolean> {
  const got = await capture(intent).catch((e) => {
    console.error(`[payments] capture failed for ${code}: ${(e as Error).message}`);
    return null;
  });
  if (!got?.ok) return false;
  await updateBooking<StoredBooking>(listing, code, (x) => {
    if (!x.payment) return x;
    const split = splitBooking(x.total || 0, x.payment.currency || "usd", x.payment.subtotal);
    return {
      ...x,
      payment: { ...x.payment, state: "captured" as const, charge: got.charge, split },
      payout: x.payout || { state: "scheduled" as const, amount: split.net, currency: split.currency, releaseOn: releaseDate(x.date).toISOString().slice(0, 10) },
    };
  });
  return true;
}

/**
 * Refund or release the guest, and take back the operator's share if it was already sent. Says which one
 * happened so the guest's email can say "refunded" or "the hold was released" rather than guessing.
 */
async function refundBooking(listing: string, b: StoredBooking): Promise<{ refunded: boolean; released: boolean }> {
  const out = { refunded: false, released: false };
  if (!b.payment?.intent) return out;
  if (b.payment.state === "authorized" || b.payment.state === "captured") {
    const ok = await releaseIntent(b.payment.intent).catch((e) => {
      console.error(`[payments] release failed for ${b.code}: ${(e as Error).message}`);
      return false;
    });
    if (ok) {
      if (b.payment.state === "captured") out.refunded = true;
      else out.released = true;
      await updateBooking<StoredBooking>(listing, b.code, (x) => ({ ...x, payment: { ...x.payment!, state: "released" as const } }));
    }
  }
  if (b.payout?.state === "paid" && b.payout.transfer) {
    const back = await reverseTransfer(b.payout.transfer, b.code).catch((e) => {
      console.error(`[payments] reversal failed for ${b.code}: ${(e as Error).message}`);
      return false;
    });
    if (back) await updateBooking<StoredBooking>(listing, b.code, (x) => ({ ...x, payout: { ...x.payout!, state: "reversed" as const } }));
  } else if (b.payout?.state === "scheduled") {
    await updateBooking<StoredBooking>(listing, b.code, (x) => ({ ...x, payout: { ...x.payout!, state: "cancelled" as const } }));
  }
  return out;
}

const SITE = process.env.SITE_URL || "https://onoutset.com/";
const STATUSES = ["new", "accepted", "declined", "completed", "noshow", "cancelled"];
/**
 * The shape every booking code has, the same one POST /bookings enforces. The routes that take a code in the
 * path did not check it, so a code with a NUL byte in it reached Postgres and came back as
 * `invalid byte sequence for encoding "UTF8"`: a 500 for what is only a bad link.
 */
const CODE = /^[A-Z0-9-]{4,16}$/;
const SUCCESS = (code: string, listing: string) => `${SITE}#paid=${code}&o=${listing}`;
const CANCEL = (listing: string) => `${SITE}#o=${listing}`;
/**
 * A real day on the calendar. "2027-02-30" parses and rolls forward to March 2, so without this the record
 * kept 2027-02-30 while every email said Tuesday, March 2: one booking, two days.
 */
const realDate = (s: string): boolean => {
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
// Strip control characters so nothing odd lands in an email or a JSON file. `bodyText` rather than `String`
// because `String({toString: 1})` throws, and that is ordinary JSON a request can carry.
const clean = (s: unknown, max: number) =>
  bodyText(s)
    .split("")
    .filter((ch) => ch.charCodeAt(0) >= 32)
    .join("")
    .trim()
    .slice(0, max);

const notifyNew = mailNewBooking;

export const bookings = new Hono();

/** Stripe calls this when the guest finishes checkout. Turns the pending row into a real request. */
bookings.post("/stripe/webhook", rateLimit(600, 60 * 60 * 1000), async (c) => {
  const raw = await c.req.text();
  if (!verifyWebhook(raw, c.req.header("stripe-signature"))) return c.json({ error: "bad signature" }, 400);
  // The signature has already passed, so this is Stripe, but a truncated body would otherwise throw and answer
  // 500, which tells Stripe to retry something that can never parse.
  let ev: { type: string; data: { object: { id: string; mode?: string; payment_intent?: string | null; metadata?: { code?: string; listing?: string; wallet?: string } } } };
  try {
    ev = JSON.parse(raw);
  } catch {
    console.error("[stripe] a signed webhook body did not parse");
    return c.json({ ok: true });
  }
  if (ev.type !== "checkout.session.completed" && ev.type !== "checkout.session.expired") return c.json({ ok: true });
  const s = ev.data.object;
  const wallet = String(s.metadata?.wallet || "").toLowerCase();
  if (ev.type === "checkout.session.completed" && (s.mode === "setup" || WALLET_ID.test(wallet))) {
    if (WALLET_ID.test(wallet)) await attachWalletFromSession(wallet, s.id).catch((e) => console.error("[stripe] wallet setup " + wallet + ": " + (e as Error).message));
    return c.json({ ok: true });
  }
  const code = String(s.metadata?.code || "").toUpperCase();
  const listing = String(s.metadata?.listing || "");
  if (!ID.test(listing) || !/^[A-Z0-9-]{4,16}$/.test(code)) return c.json({ ok: true });
  const profile = await getProfile<StoredProfile>(listing);
  const instant = !!(profile?.profile as { instantBook?: boolean } | null)?.instantBook;
  let authorized = false;
  const done = await updateBooking<StoredBooking>(listing, code, (x) => {
    if (x.status !== "pending") return x;
    if (ev.type === "checkout.session.expired") return { ...x, status: "cancelled" as const, payment: { ...(x.payment || { session: s.id, intent: null, state: "unpaid" as const }), state: "released" as const } };
    authorized = true;
    return { ...x, status: instant ? "accepted" : "new", payment: { ...x.payment, session: s.id, intent: s.payment_intent || x.payment?.intent || null, state: "authorized" } };
  });
  if (done && authorized) {
    const d = done;
    if (instant && d.payment?.intent) await captureBooking(listing, code, d.payment.intent);
    await notifyNew(d, profile);
  }
  return c.json({ ok: true });
});

/** The guest came back from Stripe before the webhook landed: confirm from the session directly. */
bookings.get("/bookings/paid/:listing/:code", rateLimit(60, 60 * 60 * 1000), async (c) => {
  const listing = String(c.req.param("listing") ?? "");
  const code = String(c.req.param("code") ?? "").toUpperCase();
  if (!ID.test(listing)) return c.json({ error: "bad listing" }, 400);
  if (!CODE.test(code)) return c.json({ error: "not found" }, 404);
  const b = await getBooking<StoredBooking>(listing, code);
  if (!b) return c.json({ error: "not found" }, 404);
  if (b.status === "pending" && b.payment?.session && stripeEnabled()) {
    const st = await sessionStatus(b.payment.session).catch(() => null);
    if (st?.paid) {
      const profile = await getProfile<StoredProfile>(listing);
      const instant = !!(profile?.profile as { instantBook?: boolean } | null)?.instantBook;
      let authorized = false;
      const done = await updateBooking<StoredBooking>(listing, code, (x) => {
        if (x.status !== "pending") return x;
        authorized = true;
        return { ...x, status: instant ? "accepted" : "new", payment: { ...x.payment!, intent: st.paymentIntent || x.payment!.intent, state: "authorized" } };
      });
      if (done && authorized) {
        const d = done;
        if (instant && d.payment?.intent) await captureBooking(listing, code, d.payment.intent);
        // The guest is on this request, back from Stripe and waiting for their confirmation. The webhook
        // path above keeps its await: nobody is waiting on that one and Stripe retries a failure.
        void notifyNew(d, profile).catch((e) => console.error(`[bookings] mail for ${code}: ${(e as Error).message}`));
        return c.json({ status: d.status, paid: true });
      }
    }
  }
  return c.json({ status: b.status, paid: b.payment?.state === "authorized" || b.payment?.state === "captured" });
});

bookings.post("/bookings", rateLimit(20, 60 * 60 * 1000), async (c) => {
  const b = (await c.req.json().catch(() => null)) as Partial<StoredBooking> | null;
  const listing = bodyText(b?.listing);
  if (!b || !ID.test(listing)) return c.json({ error: "bad listing" }, 400);
  const date = clean(b.date, 10);
  const slot = clean(b.slot, 5);
  const qty = Number(b.qty);
  const code = clean(b.code, 16).toUpperCase();
  const guest = { name: clean(b.guest?.name, 80), phone: clean(b.guest?.phone, 24).replace(/[^\d+() -]/g, ""), email: clean(b.guest?.email, 200).toLowerCase() };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !realDate(date)) return c.json({ error: "bad date" }, 400);
  if (Date.parse(date) < Date.now() - 86400000 || Date.parse(date) > Date.now() + 366 * 86400000) return c.json({ error: "date out of range" }, 400);
  // 24:00, 12:99 and 99:99 all passed a plain \d\d:\d\d and came back as 409 "that time is not open", which
  // reads to a guest like someone else took it. Bad input is 400.
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(slot)) return c.json({ error: "bad time" }, 400);
  if (!Number.isInteger(qty) || qty < 1 || qty > 60) return c.json({ error: "bad guest count" }, 400);
  if (!/^[A-Z0-9-]{4,16}$/.test(code)) return c.json({ error: "bad code" }, 400);
  if (guest.name.length < 2 || guest.phone.replace(/\D/g, "").length < 7) return c.json({ error: "name and mobile are required" }, 400);
  if (guest.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest.email)) return c.json({ error: "bad email" }, 400);
  const profile = await getProfile<StoredProfile>(listing);
  // The listing's own file: its menu and prices, and the proof that the listing exists at all. Before this,
  // a booking for any invented id was accepted, stored a row and alerted the founder to call a shop that was
  // never there. A store hiccup must not turn a real listing into a missing one, so only a clean read that
  // finds nothing refuses.
  type Detail = { title?: string; area?: string; options?: PricedOption[]; addons?: PricedOption[] };
  let detail: Detail | null = null;
  let listingKnown = true;
  try {
    detail = await readJson<Detail>(`o/${listing}.json`);
  } catch (e) {
    listingKnown = false;
    console.error(`[bookings] could not read the listing file for ${listing}: ${(e as Error).message}`);
  }
  if (listingKnown && !detail && !profile) return c.json({ error: "no such listing" }, 404);
  // The dashboard's Published and Accepting switches. The guest page hides the booking box for both, but the
  // page is not the only client, and before this a paused shop's API still took the booking and emailed them.
  const accepting = (profile?.patch as { accepting?: boolean } | undefined)?.accepting ?? (profile?.profile as { accepting?: boolean } | null)?.accepting;
  if (profile && (profile.published === false || accepting === false)) return c.json({ error: profile.published === false ? "This listing is hidden right now" : "This business is not taking bookings right now" }, 409);
  const instant = !!(profile?.profile as { instantBook?: boolean } | null)?.instantBook;
  // One time, one party. The guest page hides a time once it is taken, but the page is a snapshot and two guests
  // can be looking at the same one; this is the check that actually stops the second booking.
  const existing = await listBookings<StoredBooking>(listing);
  // The shop's own zone, so this agrees with the picker the guest just used. Without it a 1 PM Pacific slot is
  // read as 1 PM on the server and refused as being in the past. Its published week comes with it, for the same
  // reason: an unclaimed listing's picker offers only the times its own site is open for, so this takes only
  // those too, rather than accepting a 7 AM at a brewery that opens at four.
  const [zone, week] = await Promise.all([zoneOf(listing).catch(() => null), weekOf(listing).catch(() => null)]);
  const room = slotOpen((profile?.profile as Parameters<typeof slotOpen>[0]) || null, existing, date, slot, clean(b.service, 120), qty, new Date(), zone, week);
  if (!room.open) return c.json({ error: room.reason || "That time is not available", code: "slot_taken" }, 409);
  const rec: StoredBooking = {
    code,
    listing,
    date,
    slot,
    qty,
    service: clean(b.service, 120),
    variant: clean(b.variant, 80),
    addons: Array.isArray(b.addons) ? b.addons.slice(0, 10).map((a) => clean(a, 80)) : [],
    total: typeof b.total === "number" && Number.isFinite(b.total) ? Math.round(b.total * 100) / 100 : null,
    guest,
    status: instant ? "accepted" : "new",
    created: new Date().toISOString(),
  };
  // The price comes from the listing, never from the number the browser sent, and a claimed listing's own menu
  // wins. This used to run only when Stripe was on, so a pay-on-site guest could send any total: a $40 sail
  // reached the operator as "Your price $1.00, you receive $0.95" and the guest's email said $1 too.
  // A claimed shop's own menu is the menu, including when it is empty. The fallback used to turn on length, so
  // an operator who hid or deleted every service left the guest page with nothing to pick while the price still
  // came off the scraped file: with one priced row in that file, a booking with no service named was charged it
  // and the operator was emailed money for something they had taken off the menu.
  const patch = (profile?.patch || {}) as { options?: PricedOption[]; addons?: PricedOption[] };
  const own = (k: "options" | "addons") => !!profile?.patch && k in patch;
  // A dashboard record is stored as the device sends it, so `options` or `addons` can be anything at all. A
  // string has a length, so a menu of `"oops"` passed the emptiness check below and `priceBooking` then called
  // `.filter` on it: every booking for that shop answered 500 until somebody fixed the row by hand. Anything
  // that is not an array reads as an empty menu, so one bad write costs the shop its prices, not its bookings.
  const asList = (v: unknown): PricedOption[] => (Array.isArray(v) ? (v as PricedOption[]) : []);
  // The crawled menu carries rows that are the page's own headings, not the shop's services, and a museum's
  // "Past Exhibitions" came priced: $5 at o-anchoragemuseum-org, $3,000 at o-aahmsnj-org. The app stopped
  // offering them (`src/lib/menuRow.ts`), and the server prices from the same menu, so a request naming one
  // now has no price rather than that one. A shop's own published menu is their own words and is untouched.
  const menu = own("options") ? asList(patch.options) : asList(detail?.options).filter((o) => bookableRow(o.name, o.price));
  const extras = own("addons") ? asList(patch.addons) : asList(detail?.addons);
  const priced = menu.length ? priceBooking(menu, extras, rec.service, rec.variant, qty, rec.addons, rec.total) : null;
  if (priced && rec.total != null && Math.abs(priced.total - rec.total) > 0.5) console.warn(`[bookings] ${code}: browser total ${rec.total}, listing price ${priced.total}; charging the listing price`);
  // Once the listing has been read, its own menu is the only source of a price. This used to apply only when the
  // menu could price the booking, so a service the menu does not sell kept whatever the browser sent:
  // "Helicopter transfer, $5,000" reached the operator as "You receive $4,726.25" for something they do not
  // offer. A booking the menu cannot price has no price, which is what a "price on request" line means, and the
  // emails say so. Only a store the API could not read at all leaves the browser's number standing, because then
  // there is nothing better to go on and an outage must not lose a real booking's price.
  if (listingKnown) {
    if (!priced && rec.total != null) console.warn(`[bookings] ${code}: the listing does not price "${rec.service}"; stored with no price instead of the browser's ${rec.total}`);
    rec.total = priced ? priced.total : null;
    if (priced) rec.pricing = { subtotal: priced.subtotal, fee: priced.fee };
  }
  // `pay` used to come off the request body, so anyone could post "pay": false and get a confirmed booking with
  // no card: a free trip, the operator emailed "they pay you on the day", and the time consumed. Nothing in the
  // app ever sent it. Whether a card is taken is now decided here alone, from the listing's own price.
  const payNow = stripeEnabled() && !!priced && priced.total >= 1;
  if (payNow) {
    try {
      // Charge in the listing's own dollars. Every charge used to be in STRIPE_CURRENCY (cad), so a $213 tour in
      // Florida billed the guest 213 Canadian dollars.
      const currency = currencyForArea(detail?.area, process.env.STRIPE_CURRENCY || "usd");
      const walletToken = (c.req.header("x-wallet") || bodyText((b as { wallet?: unknown } | null)?.wallet)).trim().toLowerCase();
      if (WALLET_ID.test(walletToken)) {
        const w = await getWallet(walletToken);
        if (w && w.stripe_customer && agentMayCharge({ otto: w.otto, paymentMethod: w.payment_method, maxCents: w.max_cents }, rec.total!)) {
          try {
            const pi = await chargeSaved({ amount: rec.total!, currency, customer: w.stripe_customer, paymentMethod: w.payment_method!, code, listing });
            if (pi.status === "requires_capture" || pi.status === "succeeded") {
              rec.status = instant ? "accepted" : "new";
              rec.payment = { session: "wallet", intent: pi.id, state: "authorized", currency, subtotal: priced!.subtotal, agent: true };
              const stored = await insertBookingChecked(rec, (list) => slotOpen((profile?.profile as Parameters<typeof slotOpen>[0]) || null, list, date, slot, rec.service, qty, new Date(), zone, week).open);
              if (stored === "refused") {
                await releaseIntent(pi.id).catch((e) => console.error(`[bookings] ${code}: release after slot race: ` + (e as Error).message));
                return c.json({ error: "That time was just booked", code: "slot_taken" }, 409);
              }
              if (stored === "duplicate") {
                await releaseIntent(pi.id).catch((e) => console.error(`[bookings] ${code}: release after duplicate: ` + (e as Error).message));
                return c.json({ error: "duplicate code" }, 409);
              }
              if (instant) await captureBooking(listing, code, pi.id);
              void notifyNew(rec, profile, detail).catch((e) => console.error(`[bookings] mail for ${code}: ${(e as Error).message}`));
              return c.json({ ok: true, status: rec.status, code, charged: true });
            }
          } catch (e) {
            // SCA or a declined card: the guest pays this one themselves. The saved card stays for the next booking.
            console.warn(`[bookings] ${code}: Otto could not hold the saved card: ` + (e as Error).message);
          }
        }
      }
      const co = await createCheckout({
        code, listing, currency, title: clean((profile?.patch as { title?: string } | undefined)?.title, 120) || clean(detail?.title, 120) || listing,
        description: `${rec.service || "Booking"}${rec.variant ? " (" + rec.variant + ")" : ""} · ${fmtWhen(date, slot)} · ${qty} guest${qty === 1 ? "" : "s"}`,
        amount: rec.total!, email: guest.email || undefined, successUrl: SUCCESS(code, listing), cancelUrl: CANCEL(listing),
        // The app asks for the embedded form; an older page that does not gets the hosted page as before.
        embedded: (b as { embedded?: unknown } | null)?.embedded === true,
      });
      rec.status = "pending";
      rec.payment = { session: co.id, intent: co.paymentIntent, state: "unpaid", currency, subtotal: priced!.subtotal };
      // The pending row is stored before the guest is sent to Stripe: a Postgres insert takes milliseconds, and the
      // webhook that lands after payment has to find the row. The time was checked before the session was created;
      // it is checked once more under the listing's lock, and if a second guest won that one-second race the guest
      // is told so here instead of paying for a time that is gone (the unused session expires on its own).
      const stored = await insertBookingChecked(rec, (list) => slotOpen((profile?.profile as Parameters<typeof slotOpen>[0]) || null, list, date, slot, rec.service, qty, new Date(), zone, week).open);
      if (stored === "refused") {
        console.error(`[bookings] ${code}: ${date} ${slot} filled while the checkout session was being created`);
        return c.json({ error: "That time was just booked", code: "slot_taken" }, 409);
      }
      if (stored === "duplicate") return c.json({ error: "duplicate code" }, 409);
      return c.json({ ok: true, status: "pending", code, checkoutUrl: co.url || undefined, checkoutClientSecret: co.clientSecret || undefined });
    } catch (e) {
      // A priced booking never turns into a no-card request because Stripe hiccupped: that is a free trip the
      // operator is told "they pay you on the day" about. The guest is asked to try again instead.
      console.error(`[bookings] ${code}: stripe checkout failed: ` + (e as Error).message);
      return c.json({ error: "The payment form could not be started. Please try again in a moment." }, 502);
    }
  }
  const stored = await insertBookingChecked(rec, (list) => slotOpen((profile?.profile as Parameters<typeof slotOpen>[0]) || null, list, date, slot, rec.service, qty, new Date(), zone, week).open);
  if (stored === "duplicate") return c.json({ error: "duplicate code" }, 409);
  if (stored === "refused") return c.json({ error: "That time was just booked", code: "slot_taken" }, 409);
  // The guest waited on three emails before their confirmation screen appeared. Their booking is already
  // stored and the time already held, so the mail goes out behind the response. A failure is logged, and the
  // operator sees the booking in their dashboard either way.
  void notifyNew(rec, profile, detail).catch((e) => console.error(`[bookings] mail for ${code}: ${(e as Error).message}`));
  return c.json({ ok: true, status: rec.status, code });
});

bookings.get("/bookings/:listing", async (c) => {
  const id = String(c.req.param("listing") ?? "");
  if (!mayEdit(c, id)) return c.json({ error: "not allowed" }, 403);
  return c.json({ bookings: await listBookings<StoredBooking>(id) });
});

bookings.patch("/bookings/:listing/:code", rateLimit(300, 60 * 60 * 1000), async (c) => {
  const id = String(c.req.param("listing") ?? "");
  const code = String(c.req.param("code") ?? "").toUpperCase();
  if (!mayEdit(c, id)) return c.json({ error: "not allowed" }, 403);
  if (!CODE.test(code)) return c.json({ error: "not found" }, 404);
  const body = await jsonBody<{ status: StoredBooking["status"]; note: string }>(c);
  const status = body.status;
  if (!status || !STATUSES.includes(status)) return c.json({ error: "bad status" }, 400);
  const before = await getBooking<StoredBooking>(id, code);
  if (!before) return c.json({ error: "not found" }, 404);
  // A "pending" row is still mid-Stripe-checkout, not a real request yet: no card is captured, and the webhook
  // that turns it into one has not run. Deciding it here would leave that webhook's own guard
  // (`x.status !== "pending"`) finding the row already decided once the guest does pay, with no capture, no
  // payout ever scheduled, and a card nothing on this path releases.
  if (before.status === "pending") return c.json({ error: "This booking is still waiting on payment" }, 409);
  const [profile, zone] = await Promise.all([getProfile<StoredProfile>(id).catch(() => null), zoneOf(id).catch(() => null)]);
  // Reinstating a booking the operator already turned away is not a status change, it is a new booking: the
  // time may have gone to somebody else since, and the guest's card was released when it was refused. Both are
  // checked, and the decision written, under the listing's advisory lock: the same one a fresh booking takes,
  // so a reinstate racing a new guest into the same time cannot both win it, and two decide requests racing
  // each other cannot both capture, refund or email for the same change.
  let refused: "released" | "room" | null = null;
  let roomReason = "";
  let unchanged = false;
  const found = await updateBookingChecked<StoredBooking>(id, code, (cur, others) => {
    if (cur.status === status && !body.note) {
      unchanged = true;
      return cur;
    }
    if (status === "accepted" && (cur.status === "declined" || cur.status === "cancelled")) {
      if (cur.payment?.state === "released") {
        refused = "released";
        return "refused";
      }
      const room = slotOpen((profile?.profile as Parameters<typeof slotOpen>[0]) || null, others, cur.date, cur.slot, cur.service, cur.qty, new Date(), zone);
      if (!room.open) {
        refused = "room";
        roomReason = room.reason || "That time is no longer free";
        return "refused";
      }
    }
    return { ...cur, status, decidedAt: new Date().toISOString(), note: body.note ? clean(body.note, 300) : cur.note };
  });
  if (found === null) return c.json({ error: "not found" }, 404);
  if (found === "refused") {
    if (refused === "released") return c.json({ error: "That booking was refunded, so it cannot be confirmed again. Ask the guest to book a new time." }, 409);
    return c.json({ error: roomReason, code: "slot_taken" }, 409);
  }
  if (unchanged) return c.json({ ok: true, booking: found, unchanged: true });
  const f = found;
  let money = { refunded: false, released: false };
  if (f.payment?.intent && stripeEnabled()) {
    if (status === "accepted" && f.payment.state === "authorized") await captureBooking(id, code, f.payment.intent);
    if (status === "declined" || status === "cancelled") money = await refundBooking(id, f);
  }
  if (status === "accepted" || status === "declined" || status === "cancelled") {
    const latest = (await getBooking<StoredBooking>(id, code)) || f;
    await mailDecision(latest, profile, status, money);
  }
  return c.json({ ok: true, booking: f });
});
