import { useEffect, useRef, useState } from "react";
import { apiConfig } from "../../lib/api";
import { loadStripeJs, type StripeCheckout } from "../../lib/stripeJs";
import { useApp } from "../../state/AppProvider";
import { Mark } from "../layout/Mark";

/**
 * Stripe's checkout form inside the listing page: card, Apple Pay and Google Pay, with the guest never leaving
 * Outset. Stripe.js renders the form in its own frame, so no card number ever touches this app or the API; the
 * fee is the same as the hosted page. When the payment completes Stripe sends the tab to the return URL the API
 * set (#paid=<code>), which is the confirmation the hosted page always used. Close puts the listing back as it was;
 * the unpaid session expires on its own and the API's expiry webhook clears the pending row.
 *
 * Speed: Stripe.js and the page config are fetched by warmCheckout() (lib/stripeJs) the moment a booking box is
 * complete, before "Book and pay" is pressed, so the only wait left when the session arrives is Stripe drawing
 * its form, behind a skeleton the shape of that form. The page behind the dialog stops scrolling while it is up.
 */

export function EmbeddedCheckout({ secret }: { secret: string }) {
  const { cancelCheckout } = useApp();
  const host = useRef<HTMLDivElement | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const closeBtn = useRef<HTMLButtonElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // `cancelCheckout` is rebuilt on every render of the provider, so it is read through a ref rather than put in
  // the effect's deps, where it would steal focus back to Close on every keystroke the guest types.
  const cancel = useRef(cancelCheckout);
  cancel.current = cancelCheckout;
  /**
   * It says aria-modal, so it has to behave like one. It did not: nothing moved focus into it, Escape did
   * nothing, and Tab walked straight out into the listing behind, card fields then chips then the whole feed,
   * on a dialog whose only way out is one button. Escape closes it, focus starts on Close, and Tab stays
   * inside. Stripe's own frame is one stop in that ring and keeps its own fields' order.
   */
  useEffect(() => {
    closeBtn.current?.focus();
    const FOCUSABLE = 'button:not([disabled]), iframe, a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const onKey = (e: KeyboardEvent) => {
      // Escape is stopped here, like the listing's own modals: the app's window-level Escape closes whatever
      // sheet is on top, and the listing is that sheet, so one Escape used to take down the form and the listing
      // under it, dropping the guest on the home page with the booking box gone.
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancel.current();
        return;
      }
      if (e.key !== "Tab" || !box.current) return;
      const stops = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!stops.length) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      const here = document.activeElement as HTMLElement | null;
      if (!e.shiftKey && here === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (here === first || !here || !box.current.contains(here))) {
        e.preventDefault();
        last.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    // The listing behind must not scroll under the form, on a wheel or a thumb. Locked on <html> as well as
    // <body>: app.css clips html's overflow-x, and once the root's overflow is not plain `visible` the viewport
    // scrolls by the root's values, not body's, so body alone left the page rolling under the form.
    const root = document.documentElement;
    const prev = { overflow: document.body.style.overflow, touch: document.body.style.touchAction, root: root.style.overflow };
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
    root.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prev.overflow;
      document.body.style.touchAction = prev.touch;
      root.style.overflow = prev.root;
    };
  }, []);
  useEffect(() => {
    let checkout: StripeCheckout | null = null;
    let gone = false;
    (async () => {
      try {
        const key = (await apiConfig()).stripePublishableKey;
        if (!key) throw new Error("Payments are not set up on this site yet.");
        const stripe = await loadStripeJs();
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
    <div className="paycheckout" role="dialog" aria-modal="true" aria-label="Pay for your booking" onClick={(e) => { if (e.target === e.currentTarget) cancelCheckout(); }}>
      <div className="paycheckoutbox" ref={box}>
        <div className="paycheckouthead">
          <Mark size={26} />
          <b>Secure payment</b>
          <button type="button" ref={closeBtn} className="paycheckoutclose" onClick={cancelCheckout} aria-label="Close without paying">Close</button>
        </div>
        <div className="paycheckoutbody">
          {/* Both of these replace the card form itself, so a screen reader has to be told rather than shown. */}
          {error ? <p className="paycheckouterr" role="alert">{error} You can try again from the booking box.</p> : null}
          {!ready && !error ? (
            <>
              <p className="paycheckoutwait" role="status">Loading the card form…</p>
              <div className="paycheckoutskel" aria-hidden="true">
                <span className="skel l" /><span className="skel m" /><span className="skel f" /><span className="skel f" /><span className="skel h" /><span className="skel btn" />
              </div>
            </>
          ) : null}
          <div ref={host} className={"paycheckoutform" + (ready ? " on" : "")} />
        </div>
        <small className="paycheckoutnote">Handled by Stripe. Your card is only held until the business confirms.</small>
      </div>
    </div>
  );
}
