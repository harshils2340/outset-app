import assert from "node:assert/strict";
import test from "node:test";

/**
 * Stripe.js is fetched by the card form and shared. The pending promise used to be kept whatever became of it,
 * so one blocked or dropped request left every later attempt awaiting that same rejection and failing with no
 * request at all, under a message reading "You can try again from the booking box".
 */

type ScriptStub = { src: string; async: boolean; onload: null | (() => void); onerror: null | (() => void); remove: () => void };

/** A page with no Stripe.js on it yet, and a script tag whose load can be made to succeed or fail. */
function fakePage() {
  const added: ScriptStub[] = [];
  const win: { Stripe?: unknown } = {};
  const doc = {
    createElement: (): ScriptStub => ({ src: "", async: false, onload: null, onerror: null, remove() { added.splice(added.indexOf(this as ScriptStub), 1); } }),
    head: { appendChild: (s: ScriptStub) => added.push(s) },
  };
  (globalThis as { window?: unknown }).window = win;
  (globalThis as { document?: unknown }).document = doc;
  return { added, win };
}

test("a failed Stripe.js load is forgotten, so the next attempt is a real one", async () => {
  const { added, win } = fakePage();
  const { loadStripeJs, STRIPE_JS } = await import("../stripeJs");

  const first = loadStripeJs();
  assert.equal(added.length, 1, "one script tag");
  assert.equal(added[0].src, STRIPE_JS);
  added[0].onerror?.();
  await assert.rejects(first, /card form could not be loaded/);
  assert.equal(added.length, 0, "the script that failed does not stay on the page");

  // The guest presses again. Before the fix this awaited the same rejected promise and failed with no request.
  const second = loadStripeJs();
  assert.equal(added.length, 1, "a second attempt really goes and asks again");
  const stripe = (() => ({ initEmbeddedCheckout: async () => ({ mount() {}, destroy() {} }) })) as never;
  win.Stripe = stripe;
  added[0].onload?.();
  assert.equal(await second, stripe);

  // Loaded once, it is shared: a third caller asks for no script at all.
  const third = loadStripeJs();
  assert.equal(added.length, 1);
  assert.equal(await third, stripe);
});

test("a script that loads without leaving Stripe behind counts as a failure, not a hang", async () => {
  const { added } = fakePage();
  const { loadStripeJs } = await import("../stripeJs?again");
  const p = loadStripeJs();
  added[0].onload?.();
  await assert.rejects(p, /card form could not be loaded/);
  assert.equal(added.length, 0);
});

test("a request that never answers is a failure too, and the next press is a real request", async (t) => {
  // A script tag still fetching fires neither onload nor onerror. `warmCheckout` starts this request as the
  // booking box completes, so the press of "Book and pay" joined the same stall: the dialog sat on "Loading
  // the card form..." for as long as the guest left it open, whatever they pressed.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { added, win } = fakePage();
  const { loadStripeJs, STRIPE_JS_TIMEOUT_MS } = await import("../stripeJs?stall");

  const warm = loadStripeJs();
  assert.equal(added.length, 1, "the script is on the page and fetching");
  // One tick short of the deadline, nothing has happened: a slow connection is not a stall.
  t.mock.timers.tick(STRIPE_JS_TIMEOUT_MS - 1);
  assert.equal(added.length, 1);
  t.mock.timers.tick(1);
  await assert.rejects(warm, /card form could not be loaded/);
  assert.equal(added.length, 0, "the script that never answered does not stay on the page");

  const press = loadStripeJs();
  assert.equal(added.length, 1, "the guest's press really goes and asks again");
  const stripe = (() => ({ initEmbeddedCheckout: async () => ({ mount() {}, destroy() {} }) })) as never;
  win.Stripe = stripe;
  added[0].onload?.();
  assert.equal(await press, stripe);
});

test("the clock is stopped by a load that works, so nothing fails after the fact", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { added, win } = fakePage();
  const { loadStripeJs, STRIPE_JS_TIMEOUT_MS } = await import("../stripeJs?stopped");
  const p = loadStripeJs();
  const stripe = (() => ({ initEmbeddedCheckout: async () => ({ mount() {}, destroy() {} }) })) as never;
  win.Stripe = stripe;
  added[0].onload?.();
  assert.equal(await p, stripe);
  t.mock.timers.tick(STRIPE_JS_TIMEOUT_MS * 2);
  assert.equal(added.length, 1, "the loaded script is left where it is");
  assert.equal(await loadStripeJs(), stripe, "and it is still the shared answer");
});
