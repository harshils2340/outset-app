import { Hono } from "hono";
import { ID, mayEdit, rateLimit } from "./auth.ts";
import { sendMail } from "../lib/mail.ts";
import { readJson, updateJson } from "../lib/store.ts";
import type { StoredProfile } from "./profiles.ts";
import { captureIntent, createCheckout, releaseIntent, sessionStatus, stripeEnabled, verifyWebhook } from "../lib/stripe.ts";

/**
 * Bookings, stored per listing under public/bookings/. A guest's request is written here, the operator
 * gets an email, and the dashboard reads and decides through the same file. Guests are told by email
 * when the operator accepts or declines.
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
  /** Stripe: authorized at booking, captured on accept, released on decline. */
  payment?: { session: string; intent: string | null; state: "authorized" | "captured" | "released" | "unpaid" };
};

const SITE = process.env.SITE_URL || "https://harshils2340.github.io/outset-app/";
const STATUSES = ["new", "accepted", "declined", "completed", "noshow", "cancelled"];
const SUCCESS = (code: string, listing: string) => `${SITE}#paid=${code}&o=${listing}`;
const CANCEL = (listing: string) => `${SITE}#o=${listing}`;
const path = (id: string) => `bookings/${id}.json`;
// Strip control characters so nothing odd lands in an email or a JSON file.
const clean = (s: unknown, max: number) =>
  String(s ?? "")
    .split("")
    .filter((ch) => ch.charCodeAt(0) >= 32)
    .join("")
    .trim()
    .slice(0, max);

async function notifyNew(rec: StoredBooking, profile: StoredProfile | null): Promise<void> {
  const instant = rec.status === "accepted";
  const title = clean((profile?.patch as { title?: string } | undefined)?.title, 120) || rec.listing;
  const when = `${rec.date} at ${rec.slot}, ${rec.qty} guest${rec.qty === 1 ? "" : "s"}`;
  const paid = rec.payment?.state === "authorized" ? (instant ? "Paid $" + rec.total + " by card." : "Card held for $" + rec.total + ", charged when you accept.") : rec.total != null ? "Total: $" + rec.total + " (paid on site)" : "";
  if (profile?.owner.email) {
    await sendMail({
      to: profile.owner.email,
      subject: (instant ? "New booking " : "Booking request ") + rec.code + ": " + rec.guest.name + ", " + when,
      text: `${rec.guest.name} ${instant ? "booked" : "asked to book"} ${rec.service || title}${rec.variant ? " (" + rec.variant + ")" : ""}.\n\nWhen: ${when}\nGuest: ${rec.guest.name}, ${rec.guest.phone}${rec.guest.email ? ", " + rec.guest.email : ""}\n${paid ? paid + "\n" : ""}${rec.addons.length ? "Add-ons: " + rec.addons.join(", ") + "\n" : ""}\n${instant ? "It is confirmed. " : "Accept or decline in your dashboard: "}${SITE}operators\n\nCode ${rec.code}`,
      replyTo: rec.guest.email || undefined,
    });
  }
  if (rec.guest.email) {
    await sendMail({
      to: rec.guest.email,
      subject: (instant ? "You're booked: " : "Request sent: ") + title + ", " + when,
      text: `${instant ? "Your booking is confirmed." : "Your request is with " + title + ". You will get an email when they confirm" + (rec.payment ? "; your card is only charged then" : "") + "."}\n\n${rec.service || title}${rec.variant ? " (" + rec.variant + ")" : ""}\nWhen: ${when}\n${paid ? paid + "\n" : ""}Code ${rec.code}\n\nListing: ${SITE}#o=${rec.listing}`,
    });
  }
}

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
  const profile = await readJson<StoredProfile>(`profiles/${listing}.json`);
  const instant = !!(profile?.profile as { instantBook?: boolean } | null)?.instantBook;
  let done: StoredBooking | null = null;
  await updateJson<StoredBooking[]>(path(listing), [], (list) => list.map((x) => {
    if (x.code !== code || x.status !== "pending") return x;
    if (ev.type === "checkout.session.expired") return { ...x, status: "cancelled" as const, payment: { ...(x.payment || { session: s.id, intent: null, state: "unpaid" as const }), state: "released" as const } };
    done = { ...x, status: instant ? "accepted" : "new", payment: { session: s.id, intent: s.payment_intent || x.payment?.intent || null, state: "authorized" } };
    return done;
  }), `Booking ${code}: payment ${ev.type === "checkout.session.expired" ? "expired" : "authorized"}`);
  if (done) {
    const d = done as StoredBooking;
    if (instant && d.payment?.intent) {
      const ok = await captureIntent(d.payment.intent).catch(() => false);
      if (ok) await updateJson<StoredBooking[]>(path(listing), [], (list) => list.map((x) => (x.code === code ? { ...x, payment: { ...x.payment!, state: "captured" } } : x)), `Booking ${code}: captured`);
    }
    await notifyNew(d, profile);
  }
  return c.json({ ok: true });
});

/** The guest came back from Stripe before the webhook landed: confirm from the session directly. */
bookings.get("/bookings/paid/:listing/:code", rateLimit(60, 60 * 60 * 1000), async (c) => {
  const listing = String(c.req.param("listing") ?? "");
  const code = String(c.req.param("code") ?? "").toUpperCase();
  if (!ID.test(listing)) return c.json({ error: "bad listing" }, 400);
  const list = (await readJson<StoredBooking[]>(path(listing))) || [];
  const b = list.find((x) => x.code === code);
  if (!b) return c.json({ error: "not found" }, 404);
  if (b.status === "pending" && b.payment?.session && stripeEnabled()) {
    const st = await sessionStatus(b.payment.session).catch(() => null);
    if (st?.paid) {
      const profile = await readJson<StoredProfile>(`profiles/${listing}.json`);
      const instant = !!(profile?.profile as { instantBook?: boolean } | null)?.instantBook;
      let done: StoredBooking | null = null;
      await updateJson<StoredBooking[]>(path(listing), [], (l) => l.map((x) => {
        if (x.code !== code || x.status !== "pending") return x;
        done = { ...x, status: instant ? "accepted" : "new", payment: { ...x.payment!, intent: st.paymentIntent || x.payment!.intent, state: "authorized" } };
        return done;
      }), `Booking ${code}: payment authorized`);
      if (done) {
        const d = done as StoredBooking;
        if (instant && d.payment?.intent && (await captureIntent(d.payment.intent).catch(() => false)))
          await updateJson<StoredBooking[]>(path(listing), [], (l) => l.map((x) => (x.code === code ? { ...x, payment: { ...x.payment!, state: "captured" } } : x)), `Booking ${code}: captured`);
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return c.json({ error: "bad date" }, 400);
  if (Date.parse(date) < Date.now() - 86400000 || Date.parse(date) > Date.now() + 366 * 86400000) return c.json({ error: "date out of range" }, 400);
  if (!/^\d{2}:\d{2}$/.test(slot)) return c.json({ error: "bad time" }, 400);
  if (!Number.isInteger(qty) || qty < 1 || qty > 60) return c.json({ error: "bad guest count" }, 400);
  if (!/^[A-Z0-9-]{4,16}$/.test(code)) return c.json({ error: "bad code" }, 400);
  if (guest.name.length < 2 || guest.phone.replace(/\D/g, "").length < 7) return c.json({ error: "name and mobile are required" }, 400);
  if (guest.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest.email)) return c.json({ error: "bad email" }, 400);
  const listing = String(b.listing);
  const profile = await readJson<StoredProfile>(`profiles/${listing}.json`);
  const instant = !!(profile?.profile as { instantBook?: boolean } | null)?.instantBook;
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
  // With Stripe on and a price, the card is authorized first; the operator hears about it once it is.
  const payNow = stripeEnabled() && rec.total != null && rec.total >= 1 && b.pay !== false;
  if (payNow) {
    try {
      const co = await createCheckout({
        code, listing, title: clean((profile?.patch as { title?: string } | undefined)?.title, 120) || listing,
        description: `${rec.service || "Booking"}${rec.variant ? " (" + rec.variant + ")" : ""} · ${date} ${slot} · ${qty} guest${qty === 1 ? "" : "s"}`,
        amount: rec.total!, email: guest.email || undefined, successUrl: SUCCESS(code, listing), cancelUrl: CANCEL(listing),
      });
      rec.status = "pending";
      rec.payment = { session: co.id, intent: co.paymentIntent, state: "unpaid" };
      let dupPending = false;
      await updateJson<StoredBooking[]>(path(listing), [], (list) => {
        if (list.some((x) => x.code === code)) { dupPending = true; return list; }
        return [rec, ...list].slice(0, 2000);
      }, `Booking ${code} awaiting payment`);
      if (dupPending) return c.json({ error: "duplicate code" }, 409);
      return c.json({ ok: true, status: "pending", code, checkoutUrl: co.url });
    } catch (e) {
      console.error("stripe checkout failed, falling back to pay on site: " + (e as Error).message);
    }
  }
  let dup = false;
  await updateJson<StoredBooking[]>(
    path(listing),
    [],
    (list) => {
      if (list.some((x) => x.code === code)) {
        dup = true;
        return list;
      }
      return [rec, ...list].slice(0, 2000);
    },
    `Booking ${code} for ${listing}`,
  );
  if (dup) return c.json({ error: "duplicate code" }, 409);
  await notifyNew(rec, profile);
  return c.json({ ok: true, status: rec.status, code });
});

bookings.get("/bookings/:listing", async (c) => {
  const id = String(c.req.param("listing") ?? "");
  if (!mayEdit(c, id)) return c.json({ error: "not allowed" }, 403);
  return c.json({ bookings: (await readJson<StoredBooking[]>(path(id))) || [] });
});

bookings.patch("/bookings/:listing/:code", rateLimit(300, 60 * 60 * 1000), async (c) => {
  const id = String(c.req.param("listing") ?? "");
  const code = String(c.req.param("code") ?? "").toUpperCase();
  if (!mayEdit(c, id)) return c.json({ error: "not allowed" }, 403);
  const body = (await c.req.json().catch(() => ({}))) as { status?: StoredBooking["status"]; note?: string };
  const status = body.status;
  if (!status || !STATUSES.includes(status)) return c.json({ error: "bad status" }, 400);
  let found: StoredBooking | null = null;
  await updateJson<StoredBooking[]>(
    path(id),
    [],
    (list) =>
      list.map((x) => {
        if (x.code !== code) return x;
        found = { ...x, status, decidedAt: new Date().toISOString(), note: body.note ? clean(body.note, 300) : x.note };
        return found;
      }),
    `Booking ${code}: ${status}`,
  );
  if (!found) return c.json({ error: "not found" }, 404);
  const f = found as StoredBooking;
  if (f.payment?.intent && stripeEnabled()) {
    if (status === "accepted" && f.payment.state === "authorized" && (await captureIntent(f.payment.intent).catch(() => false)))
      await updateJson<StoredBooking[]>(path(id), [], (l) => l.map((x) => (x.code === code ? { ...x, payment: { ...x.payment!, state: "captured" } } : x)), `Booking ${code}: captured`);
    if ((status === "declined" || status === "cancelled") && (f.payment.state === "authorized" || f.payment.state === "captured") && (await releaseIntent(f.payment.intent).catch(() => false)))
      await updateJson<StoredBooking[]>(path(id), [], (l) => l.map((x) => (x.code === code ? { ...x, payment: { ...x.payment!, state: "released" } } : x)), `Booking ${code}: released`);
  }
  if (f.guest.email && (status === "accepted" || status === "declined")) {
    const profile = await readJson<StoredProfile>(`profiles/${id}.json`);
    const title = clean((profile?.patch as { title?: string } | undefined)?.title, 120) || id;
    await sendMail({
      to: f.guest.email,
      subject: (status === "accepted" ? "Confirmed: " : "Not available: ") + title + ", " + f.date + " at " + f.slot,
      text:
        status === "accepted"
          ? `${title} confirmed your booking for ${f.date} at ${f.slot}, ${f.qty} guest${f.qty === 1 ? "" : "s"}.\nCode ${f.code}. Show up 15 minutes early.${f.note ? "\n\nFrom the operator: " + f.note : ""}\n\nListing: ${SITE}#o=${id}`
          : `${title} cannot take your booking for ${f.date} at ${f.slot}.${f.note ? "\n\nFrom the operator: " + f.note : ""}\n\nPick another time: ${SITE}#o=${id}`,
    });
  }
  return c.json({ ok: true, booking: f });
});
