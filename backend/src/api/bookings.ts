import { Hono } from "hono";
import { ID, jsonBody, mayEdit, rateLimit } from "./auth.ts";
import { readJson } from "../lib/store.ts";
import { getBooking, getProfile, insertBookingChecked, listBookings, updateBooking } from "../lib/repo.ts";
import type { StoredProfile } from "./profiles.ts";
import { capture, createCheckout, releaseIntent, reverseTransfer, sessionStatus, stripeEnabled, verifyWebhook } from "../lib/stripe.ts";
import { currencyForArea, priceBooking, releaseDate, splitBooking, type PricedOption, type Split } from "../payments/money.ts";
import { mailDecision, mailNewBooking } from "./bookingMail.ts";
import { slotOpen } from "./openSlots.ts";
import { fmtWhen } from "../lib/emailTemplate.ts";

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
  /** Stripe: authorized at booking, captured on accept, released on decline. */
  payment?: { session: string; intent: string | null; state: "authorized" | "captured" | "released" | "unpaid"; currency?: string; charge?: string | null; split?: Split; subtotal?: number };
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
// Strip control characters so nothing odd lands in an email or a JSON file.
const clean = (s: unknown, max: number) =>
  String(s ?? "")
    .split("")
    .filter((ch) => ch.charCodeAt(0) >= 32)
    .join("")
    .trim()
    .slice(0, max);

const notifyNew = mailNewBooking;

export const bookings = new Hono();

/** Stripe calls this when the guest finishes checkout. Turns the pending row into a real request. */
bookings.post("/stripe/webhook", async (c) => {
  const raw = await c.req.text();
  if (!verifyWebhook(raw, c.req.header("stripe-signature"))) return c.json({ error: "bad signature" }, 400);
  const ev = JSON.parse(raw) as { type: string; data: { object: { id: string; payment_intent?: string | null; metadata?: { code?: string; listing?: string } } } };
  if (ev.type !== "checkout.session.completed" && ev.type !== "checkout.session.expired") return c.json({ ok: true });
  const s = ev.data.object;
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
        await notifyNew(d, profile);
        return c.json({ status: d.status, paid: true });
      }
    }
  }
  return c.json({ status: b.status, paid: b.payment?.state === "authorized" || b.payment?.state === "captured" });
});

bookings.post("/bookings", rateLimit(20, 60 * 60 * 1000), async (c) => {
  const b = (await c.req.json().catch(() => null)) as (Partial<StoredBooking> & { pay?: boolean }) | null;
  if (!b || !ID.test(String(b.listing))) return c.json({ error: "bad listing" }, 400);
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
  const listing = String(b.listing);
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
  const room = slotOpen((profile?.profile as Parameters<typeof slotOpen>[0]) || null, existing, date, slot, clean(b.service, 120), qty);
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
  const patch = (profile?.patch || {}) as { options?: PricedOption[]; addons?: PricedOption[] };
  const menu = patch.options?.length ? patch.options : detail?.options || [];
  const extras = patch.addons?.length ? patch.addons : detail?.addons || [];
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
  const payNow = stripeEnabled() && !!priced && priced.total >= 1 && b.pay !== false;
  if (payNow) {
    try {
      // Charge in the listing's own dollars. Every charge used to be in STRIPE_CURRENCY (cad), so a $213 tour in
      // Florida billed the guest 213 Canadian dollars.
      const currency = currencyForArea(detail?.area, process.env.STRIPE_CURRENCY || "usd");
      const co = await createCheckout({
        code, listing, currency, title: clean((profile?.patch as { title?: string } | undefined)?.title, 120) || clean(detail?.title, 120) || listing,
        description: `${rec.service || "Booking"}${rec.variant ? " (" + rec.variant + ")" : ""} · ${fmtWhen(date, slot)} · ${qty} guest${qty === 1 ? "" : "s"}`,
        amount: rec.total!, email: guest.email || undefined, successUrl: SUCCESS(code, listing), cancelUrl: CANCEL(listing),
      });
      rec.status = "pending";
      rec.payment = { session: co.id, intent: co.paymentIntent, state: "unpaid", currency, subtotal: priced!.subtotal };
      // The pending row is stored before the guest is sent to Stripe: a Postgres insert takes milliseconds, and the
      // webhook that lands after payment has to find the row. The time was checked before the session was created;
      // it is checked once more under the listing's lock, and if a second guest won that one-second race the guest
      // is told so here instead of paying for a time that is gone (the unused session expires on its own).
      const stored = await insertBookingChecked(rec, (list) => slotOpen((profile?.profile as Parameters<typeof slotOpen>[0]) || null, list, date, slot, rec.service, qty).open);
      if (stored === "refused") {
        console.error(`[bookings] ${code}: ${date} ${slot} filled while the checkout session was being created`);
        return c.json({ error: "That time was just booked", code: "slot_taken" }, 409);
      }
      if (stored === "duplicate") return c.json({ error: "duplicate code" }, 409);
      return c.json({ ok: true, status: "pending", code, checkoutUrl: co.url });
    } catch (e) {
      console.error("stripe checkout failed, falling back to pay on site: " + (e as Error).message);
    }
  }
  const stored = await insertBookingChecked(rec, (list) => slotOpen((profile?.profile as Parameters<typeof slotOpen>[0]) || null, list, date, slot, rec.service, qty).open);
  if (stored === "duplicate") return c.json({ error: "duplicate code" }, 409);
  if (stored === "refused") return c.json({ error: "That time was just booked", code: "slot_taken" }, 409);
  await notifyNew(rec, profile);
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
  const found = await updateBooking<StoredBooking>(id, code, (x) => ({ ...x, status, decidedAt: new Date().toISOString(), note: body.note ? clean(body.note, 300) : x.note }));
  if (!found) return c.json({ error: "not found" }, 404);
  const f = found;
  let money = { refunded: false, released: false };
  if (f.payment?.intent && stripeEnabled()) {
    if (status === "accepted" && f.payment.state === "authorized") await captureBooking(id, code, f.payment.intent);
    if (status === "declined" || status === "cancelled") money = await refundBooking(id, f);
  }
  if (status === "accepted" || status === "declined" || status === "cancelled") {
    const profile = await getProfile<StoredProfile>(id);
    const latest = (await getBooking<StoredBooking>(id, code)) || f;
    await mailDecision(latest, profile, status, money);
  }
  return c.json({ ok: true, booking: f });
});
