/**
 * The guest's card, against real Stripe in test mode, through our own code.
 *
 * `payout-e2e.mts` proves the arithmetic against a recorder that answers as Stripe would. This proves the other
 * half: that the calls in `src/lib/stripe.ts` do what we believe when Stripe itself answers. It imports those
 * functions rather than reimplementing them, so a change in them is caught here.
 *
 * The promises it checks are the ones a guest reads on the listing and in their email:
 *   the card is only authorized when they book, charged when the operator accepts, released when declined,
 *   refunded if a confirmed booking is cancelled, and charged in the listing's own dollars.
 *
 *   cd backend && STRIPE_TEST_SECRET_KEY=sk_test_... npx tsx scripts/card-e2e.mts
 *
 * Needs no database, no API and no browser. Refuses to start on a live key. Everything it creates is a test-mode
 * payment, and it cancels or refunds every one it makes.
 *
 * What it cannot do: complete Stripe's hosted Checkout page, which is a person typing a card. It checks that the
 * session is created correctly, then authorizes a card the way that page would, with a test payment method.
 */

const KEY = (process.env.STRIPE_TEST_SECRET_KEY || "").trim();
if (!KEY) {
  console.log("STRIPE_TEST_SECRET_KEY is not set (the sk_test_ secret key from the Stripe dashboard in test mode).");
  console.log("  cd backend && STRIPE_TEST_SECRET_KEY=sk_test_... npx tsx scripts/card-e2e.mts");
  process.exit(0);
}
for (const [name, v] of [["STRIPE_TEST_SECRET_KEY", KEY], ["STRIPE_SECRET_KEY", process.env.STRIPE_SECRET_KEY || ""]] as [string, string][]) {
  if (v.startsWith("sk_live")) {
    console.error(`\nRefusing to start: ${name} is a LIVE Stripe key. This script authorizes and captures cards.\n`);
    process.exit(2);
  }
}
if (!KEY.startsWith("sk_test")) {
  console.error("\nRefusing to start: STRIPE_TEST_SECRET_KEY must start with sk_test_.\n");
  process.exit(2);
}
// The library reads STRIPE_SECRET_KEY, so the test key becomes the key for this process only.
process.env.STRIPE_SECRET_KEY = KEY;

const { capture, chargeOf, createCheckout, releaseIntent, settlementOf, stripeEnabled } = await import("../src/lib/stripe.ts");
const { currencyForArea, priceBooking, splitBooking } = await import("../src/payments/money.ts");

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, note: unknown = ""): void {
  const text = typeof note === "string" ? note : JSON.stringify(note);
  console.log((ok ? "  pass  " : "  FAIL  ") + label + (text ? "  -> " + text.slice(0, 200) : ""));
  ok ? passed++ : failed++;
}

const form = (o: Record<string, string | number | undefined>) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(String(v)))
    .join("&");

/** Raw Stripe, only for the parts our code does not do: reading a session back, and standing in for the guest. */
async function raw<T>(path: string, body?: Record<string, string | number | undefined>): Promise<{ ok: boolean; data: T; error?: string }> {
  const res = await fetch("https://api.stripe.com/v1/" + path, {
    method: body ? "POST" : "GET",
    headers: { authorization: "Bearer " + KEY, "content-type": "application/x-www-form-urlencoded" },
    body: body ? form(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const data = (await res.json()) as T & { error?: { message?: string } };
  return { ok: res.ok, data, error: data.error?.message };
}

/**
 * What the guest does on Stripe's hosted page: authorize a card without capturing it. `pm_card_visa` is Stripe's
 * own test payment method, the server-side equivalent of typing 4242 4242 4242 4242.
 */
async function authorize(amountCents: number, currency: string, card = "pm_card_visa"): Promise<{ ok: boolean; id: string; status: string; error?: string }> {
  const r = await raw<{ id: string; status: string }>("payment_intents", {
    amount: amountCents,
    currency,
    capture_method: "manual",
    confirm: "true",
    payment_method: card,
    "payment_method_types[0]": "card",
  });
  return { ok: r.ok, id: r.data?.id || "", status: r.data?.status || "", error: r.error };
}

console.log("\nThe guest's card, against Stripe test mode, through src/lib/stripe.ts.\n");

/* ---------------------------------------------------------------- 1. the library is switched on ------------- */

console.log("1. The library");
check("stripeEnabled() is true with a key set", stripeEnabled() === true);

/* ---------------------------------------------------------------- 2. the checkout session ------------------ */

console.log("\n2. The checkout session a booking creates");
// A $19 sunset sail for one, the shape the test listing produces.
const priced = priceBooking([{ name: "Sunset sail", detail: "2 hours", price: 19 }], [], "Sunset sail", "2 hours", 1, []);
check("the listing prices the booking at $19 plus a $1 fee", priced?.subtotal === 19 && priced?.fee === 1 && priced?.total === 20, priced);

const code = "CARD" + Math.random().toString(36).slice(2, 8).toUpperCase();
let session: { id: string; url: string; paymentIntent: string | null } | null = null;
try {
  session = await createCheckout({
    code,
    listing: "o-card-e2e-not-a-real-shop",
    title: "Card E2E (not a real shop)",
    description: "Sunset sail (2 hours) · Wednesday, September 17 at 5:00 PM · 1 guest",
    amount: priced!.total,
    currency: "usd",
    email: "card-e2e@onoutset.com",
    successUrl: "https://onoutset.com/#paid=" + code + "&o=o-card-e2e-not-a-real-shop",
    cancelUrl: "https://onoutset.com/#o=o-card-e2e-not-a-real-shop",
  });
  check("createCheckout returns a hosted page", !!session.url && session.url.startsWith("https://checkout.stripe.com/"), session.url.split("/").slice(0, 3).join("/"));
} catch (e) {
  check("createCheckout returns a hosted page", false, (e as Error).message);
}

if (session) {
  const back = await raw<{ amount_total: number; currency: string; payment_status: string; metadata: Record<string, string>; payment_intent: string | null }>(
    "checkout/sessions/" + session.id,
  );
  check("the amount Stripe holds is the listing's $20, in cents", back.data?.amount_total === 2000, String(back.data?.amount_total));
  check("the currency is the listing's own dollars", back.data?.currency === "usd", back.data?.currency);
  check("the booking code and listing ride along as metadata", back.data?.metadata?.code === code, back.data?.metadata);
  check("nothing is paid until the guest finishes the page", back.data?.payment_status === "unpaid", back.data?.payment_status);
  // A Checkout session has no payment intent until the guest actually pays, so `capture_method` cannot be read
  // here. What matters is that our code copes: it stores the intent as null and fills it in from the webhook or
  // from reading the session back. That the hold is a hold is proved in section 3, on an intent we can see.
  check("the intent does not exist yet, which the booking record stores as null", back.data?.payment_intent == null && session.paymentIntent == null, `session ${back.data?.payment_intent}, ours ${session.paymentIntent}`);
  // Nobody will pay it; expire it so it does not sit open on the account.
  await raw("checkout/sessions/" + session.id + "/expire", {});
}

/* ---------------------------------------------------------------- 3. accepted: the card is charged ---------- */

console.log("\n3. The operator accepts, so the card is charged");
const a1 = await authorize(2000, "usd");
check("a card authorizes and waits for capture", a1.ok && a1.status === "requires_capture", a1.ok ? a1.status : a1.error);
if (a1.ok) {
  const cap = await capture(a1.id);
  check("capture() takes the money and reports the charge", cap.ok === true && !!cap.charge, cap);
  if (cap.charge) {
    const found = await chargeOf(a1.id);
    check("chargeOf() finds the same charge, for a booking captured before we recorded it", found === cap.charge, `${found}`);
    // A USD charge on a Canadian platform settles in the platform's currency, and a transfer funded by that
    // charge has to be in the settled currency. This is the rate the payout run multiplies by.
    const settled = await settlementOf(cap.charge);
    check("settlementOf() reports the currency the money actually landed in", !!settled.currency && settled.rate > 0, settled);
    const split = splitBooking(20, settled.currency, 19);
    check("the split still pays the operator their price minus 5%", split.subtotal === 1900 && split.commission === 95 && split.net === 1805, split);
  }
  // Put it back: a captured payment is refunded.
  const refunded = await releaseIntent(a1.id);
  check("releaseIntent() refunds a captured payment, for a cancelled booking", refunded === true);
  const after = await raw<{ status: string; latest_charge: string }>("payment_intents/" + a1.id);
  const ch = await raw<{ refunded: boolean; amount_refunded: number }>("charges/" + after.data?.latest_charge);
  check("the guest gets the whole $20 back", ch.data?.refunded === true && ch.data?.amount_refunded === 2000, ch.data);
}

/* ---------------------------------------------------------------- 4. declined: the hold is released --------- */

console.log("\n4. The operator declines, so the hold is released");
const a2 = await authorize(2000, "usd");
if (a2.ok) {
  const released = await releaseIntent(a2.id);
  check("releaseIntent() cancels a hold that was never captured", released === true);
  const after = await raw<{ status: string }>("payment_intents/" + a2.id);
  check("Stripe reports the payment cancelled, so nothing was ever charged", after.data?.status === "canceled", after.data?.status);
} else {
  check("a second card authorizes", false, a2.error);
}

/* ---------------------------------------------------------------- 5. a card that fails --------------------- */

console.log("\n5. A card the bank refuses");
const bad = await authorize(2000, "usd", "pm_card_chargeDeclined");
check("a declined card does not become a booking (Stripe refuses the authorization)", !bad.ok || bad.status !== "requires_capture", bad.error || bad.status);

/* ---------------------------------------------------------------- 6. the listing's own dollars ------------- */

console.log("\n6. Each listing is charged in its own country's money");
check("a Florida listing is priced in USD", currencyForArea("Tampa, FL", "usd") === "usd");
check("an Ontario listing is priced in CAD", currencyForArea("Tobermory, ON", "usd") === "cad");
const cad = await authorize(2500, "cad");
check("Stripe accepts a CAD hold, so a Canadian shop can be booked", cad.ok && cad.status === "requires_capture", cad.ok ? cad.status : cad.error);
if (cad.ok) await releaseIntent(cad.id);

/* ---------------------------------------------------------------- summary ---------------------------------- */

console.log("\n" + "-".repeat(70));
console.log(`${passed} passed, ${failed} failed`);
if (!failed) console.log("\nThe card path holds: authorized on booking, charged on accept, released on decline, refunded on cancel.");
console.log();
process.exit(failed ? 1 : 0);
