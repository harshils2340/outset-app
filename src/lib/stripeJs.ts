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

let pending: Promise<StripeJs> | null = null;

export function loadStripeJs(): Promise<StripeJs> {
  if (window.Stripe) return Promise.resolve(window.Stripe);
  if (pending) return pending;
  pending = new Promise<StripeJs>((resolve, reject) => {
    const s = document.createElement("script");
    const fail = () => {
      pending = null;
      s.remove();
      reject(new Error("The card form could not be loaded."));
    };
    s.src = STRIPE_JS;
    s.async = true;
    s.onload = () => (window.Stripe ? resolve(window.Stripe) : fail());
    s.onerror = fail;
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
