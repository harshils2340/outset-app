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

async function call<T>(path: string, body?: Record<string, string | number | undefined>): Promise<T> {
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

export type Checkout = { id: string; url: string; paymentIntent: string | null };

/** A hosted payment page. Amount in dollars; the card is only authorized until capture(). */
export async function createCheckout(o: { code: string; listing: string; title: string; description: string; amount: number; email?: string; successUrl: string; cancelUrl: string }): Promise<Checkout> {
  const cents = Math.round(o.amount * 100);
  const s = await call<{ id: string; url: string; payment_intent: string | null }>("checkout/sessions", {
    mode: "payment",
    "line_items[0][quantity]": 1,
    "line_items[0][price_data][currency]": process.env.STRIPE_CURRENCY || "usd",
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
  const r = await call<{ status: string }>("payment_intents/" + encodeURIComponent(intentId) + "/capture", {});
  return r.status === "succeeded";
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
  if (Math.abs(Date.now() / 1000 - Number(t)) > 600) return false;
  const want = createHmac("sha256", secret).update(t + "." + payload).digest("hex");
  return want.length === v1.length && timingSafeEqual(Buffer.from(want), Buffer.from(v1));
}
