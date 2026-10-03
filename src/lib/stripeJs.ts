/**
 * Stripe.js, fetched once and shared.
 *
 * The card form is the last step of a booking, so a failure here is a booking lost. The first attempt used to be
 * the only one: the pending promise was kept whatever happened to it, so one blocked or dropped request, an ad
 * blocker, a captive portal, a flaky phone connection, a policy that did not name js.stripe.com, left every
 * later attempt awaiting that same rejection and failing instantly, while the screen said "you can try again".
 * A failure is forgotten instead, along with the script tag that failed, so the next attempt is a real one.
 */

export type StripeCheckout = { mount: (el: HTMLElement) => void; destroy: () => void };
export type StripeJs = (key: string) => { initEmbeddedCheckout: (o: { clientSecret: string }) => Promise<StripeCheckout> };

declare global {
  interface Window {
    Stripe?: StripeJs;
  }
}

export const STRIPE_JS = "https://js.stripe.com/v3/";

/**
 * How long the browser may spend fetching those 200 kB before this gives up on them.
 *
 * A script tag that is still fetching fires neither `onload` nor `onerror`, which is a third outcome and the
 * one nothing recovered from: `pending` held a promise that never settled, so the card dialog sat on "Loading
 * the card form..." with its skeleton for as long as the guest left it open, and no press of anything made a
 * second request. `warmCheckout` starts this as soon as the booking box is complete, so the press of "Book and
 * pay" minutes later joined that same stall rather than asking again. A stall is treated as the failure it is,
 * which puts the dialog's own words on the screen ("try again from the booking box") and makes the next press
 * a real request.
 */
export const STRIPE_JS_TIMEOUT_MS = 20000;

let pending: Promise<StripeJs> | null = null;

export function loadStripeJs(): Promise<StripeJs> {
  if (window.Stripe) return Promise.resolve(window.Stripe);
  if (pending) return pending;
  pending = new Promise<StripeJs>((resolve, reject) => {
    const s = document.createElement("script");
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stopClock = () => { if (timer) clearTimeout(timer); timer = null; };
    const fail = () => {
      stopClock();
      pending = null;
      s.remove();
      reject(new Error("The card form could not be loaded."));
    };
    s.src = STRIPE_JS;
    s.async = true;
    s.onload = () => { if (!window.Stripe) return fail(); stopClock(); resolve(window.Stripe); };
    s.onerror = fail;
    timer = setTimeout(fail, STRIPE_JS_TIMEOUT_MS);
    document.head.appendChild(s);
  });
  return pending;
}

/**
 * Fetch what the card form needs ahead of time: the page config (which carries the publishable key) and
 * Stripe.js itself, about 200 KB. Called when a booking box is complete, so "Book and pay" opens the form
 * without a download in the way. Safe to call often; each part loads once. Never throws.
 */
export function warmCheckout(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  void import("./api").then(({ apiConfig }) => apiConfig()).then((c) => { if (c.stripePublishableKey) void loadStripeJs().catch(() => undefined); }).catch(() => undefined);
}
