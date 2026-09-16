import { useEffect, useRef, useState } from "react";
import { apiConfig } from "../../lib/api";
import { useApp } from "../../state/AppProvider";
import { Mark } from "../layout/Mark";

/**
 * Stripe's checkout form inside the listing page: card, Apple Pay and Google Pay, with the guest never leaving
 * Outset. Stripe.js renders the form in its own frame, so no card number ever touches this app or the API; the
 * fee is the same as the hosted page. When the payment completes Stripe sends the tab to the return URL the API
 * set (#paid=<code>), which is the confirmation the hosted page always used. Close puts the listing back as it was;
 * the unpaid session expires on its own and the API's expiry webhook clears the pending row.
 */

type StripeCheckout = { mount: (el: HTMLElement) => void; destroy: () => void };
type StripeJs = (key: string) => { initEmbeddedCheckout: (o: { clientSecret: string }) => Promise<StripeCheckout> };
declare global {
  interface Window { Stripe?: StripeJs }
}

let stripeJs: Promise<StripeJs> | null = null;
function loadStripe(): Promise<StripeJs> {
  if (window.Stripe) return Promise.resolve(window.Stripe);
  if (!stripeJs) {
    stripeJs = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://js.stripe.com/v3/";
      s.async = true;
      s.onload = () => (window.Stripe ? resolve(window.Stripe) : reject(new Error("Stripe.js did not load")));
      s.onerror = () => reject(new Error("Stripe.js did not load"));
      document.head.appendChild(s);
    });
  }
  return stripeJs;
}

export function EmbeddedCheckout({ secret }: { secret: string }) {
  const { cancelCheckout } = useApp();
  const host = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let checkout: StripeCheckout | null = null;
    let gone = false;
    (async () => {
      try {
        const key = (await apiConfig()).stripePublishableKey;
        if (!key) throw new Error("Payments are not set up on this site yet.");
        const stripe = await loadStripe();
        checkout = await stripe(key).initEmbeddedCheckout({ clientSecret: secret });
        if (gone || !host.current) { checkout.destroy(); return; }
        checkout.mount(host.current);
        setReady(true);
      } catch (e) {
        setError((e as Error).message || "The payment form could not load.");
      }
    })();
    return () => {
      gone = true;
      checkout?.destroy();
    };
  }, [secret]);
  return (
    <div className="paycheckout" role="dialog" aria-modal="true" aria-label="Pay for your booking">
      <div className="paycheckoutbox">
        <div className="paycheckouthead">
          <Mark size={28} />
          <b>Secure payment</b>
          <button type="button" className="paycheckoutclose" onClick={cancelCheckout} aria-label="Close without paying">Close</button>
        </div>
        {error ? <p className="paycheckouterr">{error} You can try again from the booking box.</p> : null}
        {!ready && !error ? <p className="paycheckoutwait">Loading the card form…</p> : null}
        <div ref={host} className="paycheckoutform" />
        <small className="paycheckoutnote">Handled by Stripe. Your card is only held until the business confirms.</small>
      </div>
    </div>
  );
}
