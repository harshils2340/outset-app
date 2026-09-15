import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stripe Checkout with a manual capture: the guest's card is authorized when they book, captured when the
 * operator accepts, released when they decline. Plain REST calls, no SDK. With no STRIPE_SECRET_KEY every
 * function reports "not configured" and bookings fall back to pay on site.
 */

const KEY = () => process.env.STRIPE_SECRET_KEY || "";
export const stripeEnabled = () => KEY().startsWith("sk_");

function form(obj: Record<string, string | number | undefined>): string {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(String(v)))
    .join("&");
}

async function call<T>(path: string, body?: Record<string, string | number | undefined>, idempotencyKey?: string): Promise<T> {
  const res = await fetch("https://api.stripe.com/v1/" + path, {
    method: body ? "POST" : "GET",
    // An idempotency key makes a retried transfer a no-op instead of paying an operator twice.
    headers: { authorization: "Bearer " + KEY(), "content-type": "application/x-www-form-urlencoded", ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) },
    body: body ? form(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const j = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error("stripe: " + (j.error?.message || res.status));
  return j;
}

export type Checkout = { id: string; url: string; paymentIntent: string | null };

/** A hosted payment page. Amount in dollars; the card is only authorized until capture(). */
export async function createCheckout(o: { code: string; listing: string; title: string; description: string; amount: number; currency: string; email?: string; successUrl: string; cancelUrl: string }): Promise<Checkout> {
  const cents = Math.round(o.amount * 100);
  const s = await call<{ id: string; url: string; payment_intent: string | null }>("checkout/sessions", {
    mode: "payment",
    "line_items[0][quantity]": 1,
    "line_items[0][price_data][currency]": o.currency,
    "line_items[0][price_data][unit_amount]": cents,
    "line_items[0][price_data][product_data][name]": o.title.slice(0, 120),
    "line_items[0][price_data][product_data][description]": o.description.slice(0, 250),
    "payment_intent_data[capture_method]": "manual",
    "payment_intent_data[description]": `Outset ${o.code} · ${o.title}`.slice(0, 200),
    "payment_intent_data[metadata][code]": o.code,
    "payment_intent_data[metadata][listing]": o.listing,
    "metadata[code]": o.code,
    "metadata[listing]": o.listing,
    customer_email: o.email || undefined,
    client_reference_id: o.code,
    success_url: o.successUrl,
    cancel_url: o.cancelUrl,
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
  });
  return { id: s.id, url: s.url, paymentIntent: s.payment_intent };
}

export async function sessionStatus(sessionId: string): Promise<{ paid: boolean; paymentIntent: string | null }> {
  const s = await call<{ payment_status: string; payment_intent: string | null }>("checkout/sessions/" + encodeURIComponent(sessionId));
  return { paid: s.payment_status === "paid" || s.payment_status === "no_payment_required", paymentIntent: s.payment_intent };
}

/** Operator accepted: take the money. */
export async function captureIntent(intentId: string): Promise<boolean> {
  return (await capture(intentId)).ok;
}

/** Capture and report the charge, which a later transfer uses as its source so it never waits on the balance. */
export async function capture(intentId: string): Promise<{ ok: boolean; charge: string | null }> {
  const r = await call<{ status: string; latest_charge: string | null }>("payment_intents/" + encodeURIComponent(intentId) + "/capture", {}, "capture-" + intentId);
  return { ok: r.status === "succeeded", charge: r.latest_charge };
}

/** The charge behind a captured intent, for bookings captured before the charge id was recorded. */
export async function chargeOf(intentId: string): Promise<string | null> {
  const r = await call<{ latest_charge: string | null }>("payment_intents/" + encodeURIComponent(intentId));
  return r.latest_charge;
}

/**
 * What a charge settled as in the platform's balance. A USD charge on a Canadian account without a USD bank
 * account settles in CAD, and a transfer funded by that charge has to be in the settled currency.
 */
export async function settlementOf(chargeId: string): Promise<{ currency: string; rate: number }> {
  const c = await call<{ currency: string; balance_transaction: { currency: string; exchange_rate: number | null } | string | null }>("charges/" + encodeURIComponent(chargeId) + "?expand[]=balance_transaction");
  const bt = c.balance_transaction;
  if (bt && typeof bt === "object") return { currency: bt.currency, rate: bt.exchange_rate || 1 };
  return { currency: c.currency, rate: 1 };
}

/** Pay an operator for one booking. Keyed by booking code, so a rerun cannot pay the same booking twice. */
export async function transferForBooking(o: { code: string; listing: string; account: string; amount: number; currency: string; charge: string | null }): Promise<string> {
  const t = await call<{ id: string }>(
    "transfers",
    {
      amount: o.amount,
      currency: o.currency,
      destination: o.account,
      source_transaction: o.charge || undefined,
      transfer_group: "booking-" + o.code,
      description: "Outset booking " + o.code,
      "metadata[code]": o.code,
      "metadata[listing]": o.listing,
    },
    "transfer-" + o.code,
  );
  return t.id;
}

/** Take a payout back when a paid booking is refunded. */
export async function reverseTransfer(transferId: string, code: string): Promise<boolean> {
  const r = await call<{ id: string }>("transfers/" + encodeURIComponent(transferId) + "/reversals", { "metadata[code]": code }, "reverse-" + transferId);
  return !!r.id;
}

/** The operator's bank payout cadence on Stripe's side: money that reaches their Stripe balance goes to the bank daily. */
export async function setAccountDailyPayouts(account: string): Promise<void> {
  await call("accounts/" + encodeURIComponent(account), { "settings[payouts][schedule][interval]": "daily" });
}

/** Operator declined, or the hold expired: release it. A captured payment is refunded instead. */
export async function releaseIntent(intentId: string): Promise<boolean> {
  const pi = await call<{ status: string }>("payment_intents/" + encodeURIComponent(intentId));
  if (pi.status === "requires_capture") {
    const r = await call<{ status: string }>("payment_intents/" + encodeURIComponent(intentId) + "/cancel", {});
    return r.status === "canceled";
  }
  if (pi.status === "succeeded") {
    const r = await call<{ status: string }>("refunds", { payment_intent: intentId });
    return r.status === "succeeded" || r.status === "pending";
  }
  return true;
}

/** Stripe-Signature check for webhooks (t=...,v1=...). */
export function verifyWebhook(payload: string, header: string | undefined): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  // Number("abc") is NaN and every comparison with NaN is false, so a non-numeric timestamp used to slip past
  // the freshness check. The HMAC covers t, so this was never forgeable, but the check should still mean what
  // it says.
  const at = Number(t);
  if (!Number.isFinite(at) || Math.abs(Date.now() / 1000 - at) > 600) return false;
  const want = createHmac("sha256", secret).update(t + "." + payload).digest("hex");
  return want.length === v1.length && timingSafeEqual(Buffer.from(want), Buffer.from(v1));
}
