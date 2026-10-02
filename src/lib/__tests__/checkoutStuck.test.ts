import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * The checkout splash, and the one way out of it a guest had: reloading the page.
 *
 * "Book and pay" on a shop that takes cards sends the booking to the API, which answers with a Stripe
 * Checkout URL, and the app sets `checkingOut` and calls `window.location.assign` on it. That assign is
 * asynchronous and can simply never land: the guest's connection drops between the API's answer and Stripe's
 * page, or a network blocks checkout.stripe.com. What is left on screen is `CheckoutSplash`, which is fixed
 * over the whole app and carries no control at all, over a booking the API already holds.
 *
 * Back did not help. The splash sits on top of whatever sheet the guest booked from, so `popstate` closed
 * that sheet and left `checkingOut` set, which is what draws the splash. `pageshow` was no use either: it
 * fires for a page restored from the back/forward cache, which is back FROM Stripe, not a navigation that
 * never happened.
 *
 * This suite reads the provider the way `listingLink.test.ts` does: it cannot mount it, and the rule is
 * worth nothing if the handler stops asking.
 */

const SRC = readFileSync(new URL("../../state/AppProvider.tsx", import.meta.url), "utf8");
const APP = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");

test("the splash really is the whole screen with nothing on it", () => {
  // The reason back has to work. If the splash ever grows a control of its own, this suite is about nothing.
  const at = APP.indexOf("function CheckoutSplash()");
  assert.ok(at > 0, "CheckoutSplash is gone; this suite needs rewriting");
  const body = APP.slice(at, APP.indexOf("\n}", at));
  assert.doesNotMatch(body, /<button/, "the splash has a control now: check whether back is still the only way out");
  assert.match(body, /Sending you to secure checkout/);
});

test("back takes the checkout splash down", () => {
  const at = SRC.indexOf("const onPop = () => {");
  assert.ok(at > 0, "AppProvider no longer defines onPop; this guard needs rewriting");
  const body = SRC.slice(at, SRC.indexOf('window.addEventListener("popstate"', at));
  assert.match(body, /stateRef\.current\.checkingOut/, "back no longer asks whether the checkout splash is up");
  assert.match(body, /dispatch\(\{ type: "checkoutDone" \}\)/, "back no longer cancels the checkout");
  // Asked before the overlay branch, which returns early once it has closed the sheet.
  const ask = body.indexOf("stateRef.current.checkingOut");
  const overlay = body.indexOf("if (overlayRef.current) {");
  assert.ok(ask > 0 && overlay > ask, "the splash has to be asked about before the overlay branch returns");
});

test("the splash is still what checkingOut draws, and checkoutDone is still what clears it", () => {
  assert.match(APP, /state\.checkingOut \? \(state\.checkoutSecret \? <EmbeddedCheckout/, "the splash is drawn from something else now");
  const at = SRC.indexOf('case "checkoutDone":');
  assert.ok(at > 0, "the checkoutDone action is gone");
  const body = SRC.slice(at, SRC.indexOf("case \"back\"", at));
  assert.match(body, /checkingOut: false, checkoutSecret: null/, "checkoutDone no longer clears the splash");
});

test("back from Stripe's own page is still covered separately", () => {
  // The two are siblings, not one fix: `pageshow` is a page coming back out of the back/forward cache.
  assert.match(SRC, /if \(e\.persisted\) dispatch\(\{ type: "checkoutDone" \}\);/, "the pageshow handler is gone");
});
