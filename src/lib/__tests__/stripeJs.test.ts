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
