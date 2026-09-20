import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { rateLimit, bodyText } from "./auth.ts";
import { getWallet, insertWallet, patchWallet } from "../lib/repo.ts";
import { cardBrandLast4, createCustomer, createSetupCheckout, setupSessionCard, stripeEnabled } from "../lib/stripe.ts";
import { WALLET_DEFAULT_CENTS, WALLET_ID, walletLimitCents, walletLimitDollars } from "../payments/wallet.ts";

/**
 * Guest wallet: one Stripe Customer, one saved card, a spend cap, and an Otto switch.
 *
 * The id is a random token stored in the browser. Knowing it is what lets this device add a card and
 * let Otto hold it. Otto never receives a PAN. The guest types the card on Stripe Checkout (setup mode).
 */

const SITE = process.env.SITE_URL || "https://onoutset.com/";
const SUCCESS = `${SITE.replace(/\/?$/, "/")}#wallet=ready`;
const CANCEL = `${SITE.replace(/\/?$/, "/")}#wallet`;

export const wallet = new Hono();

function walletId(c: { req: { header: (n: string) => string | undefined } }): string {
  return (c.req.header("x-wallet") || "").trim().toLowerCase();
}

function publicView(row: { payment_method: string | null; brand: string | null; last4: string | null; max_cents: number; otto: boolean }) {
  return {
    ready: !!row.payment_method && !!row.last4,
    brand: row.last4 ? row.brand || "card" : null,
    last4: row.last4,
    maxDollars: walletLimitDollars(row.max_cents || WALLET_DEFAULT_CENTS),
    otto: row.otto !== false,
  };
}

async function applySetup(id: string, sessionId: string): Promise<boolean> {
  const got = await setupSessionCard(sessionId);
  if (!got?.paymentMethod) return false;
  const card = await cardBrandLast4(got.paymentMethod);
  if (!card) return false;
  await patchWallet(id, {
    stripe_customer: got.customer,
    payment_method: got.paymentMethod,
    brand: card.brand,
    last4: card.last4,
  });
  return true;
}

wallet.post("/wallet", rateLimit(30, 60 * 60 * 1000), async (c) => {
  const id = randomBytes(24).toString("hex");
  await insertWallet(id);
  return c.json({ id, ...publicView({ payment_method: null, brand: null, last4: null, max_cents: WALLET_DEFAULT_CENTS, otto: true }) });
});

wallet.get("/wallet", rateLimit(120, 60 * 60 * 1000), async (c) => {
  const id = walletId(c);
  if (!WALLET_ID.test(id)) return c.json({ error: "no wallet" }, 404);
  const row = await getWallet(id);
  if (!row) return c.json({ error: "no wallet" }, 404);
  return c.json(publicView(row));
});

wallet.post("/wallet/setup", rateLimit(20, 60 * 60 * 1000), async (c) => {
  if (!stripeEnabled()) return c.json({ error: "Card setup is not on this host." }, 503);
  const id = walletId(c);
  if (!WALLET_ID.test(id)) return c.json({ error: "no wallet" }, 404);
  const row = await getWallet(id);
  if (!row) return c.json({ error: "no wallet" }, 404);
  const body = (await c.req.json().catch(() => null)) as { email?: unknown } | null;
  const email = bodyText(body?.email, "").trim().toLowerCase().slice(0, 200);
  const mail = email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : row.email || undefined;
  let customer = row.stripe_customer;
  if (!customer) {
    customer = await createCustomer({ email: mail, wallet: id });
    await patchWallet(id, { stripe_customer: customer, email: mail || row.email });
  }
  const session = await createSetupCheckout({ customer, wallet: id, successUrl: SUCCESS, cancelUrl: CANCEL });
  if (!session.url) return c.json({ error: "The card form could not be started." }, 502);
  await patchWallet(id, { setup_session: session.id, email: mail || row.email });
  return c.json({ url: session.url });
});

/** The guest is back from Stripe: pull the saved card off the setup session if the webhook has not landed yet. */
wallet.post("/wallet/ready", rateLimit(60, 60 * 60 * 1000), async (c) => {
  if (!stripeEnabled()) return c.json({ error: "Card setup is not on this host." }, 503);
  const id = walletId(c);
  if (!WALLET_ID.test(id)) return c.json({ error: "no wallet" }, 404);
  const row = await getWallet(id);
  if (!row) return c.json({ error: "no wallet" }, 404);
  if (row.payment_method && row.last4) return c.json(publicView(row));
  if (!row.setup_session) return c.json(publicView(row));
  try {
    await applySetup(id, row.setup_session);
  } catch (e) {
    console.error("[wallet] setup session " + row.setup_session + ": " + (e as Error).message);
  }
  const next = (await getWallet(id)) || row;
  return c.json(publicView(next));
});

wallet.patch("/wallet", rateLimit(60, 60 * 60 * 1000), async (c) => {
  const id = walletId(c);
  if (!WALLET_ID.test(id)) return c.json({ error: "no wallet" }, 404);
  const row = await getWallet(id);
  if (!row) return c.json({ error: "no wallet" }, 404);
  const body = (await c.req.json().catch(() => null)) as { maxDollars?: unknown; otto?: unknown } | null;
  const patch: { max_cents?: number; otto?: boolean } = {};
  if (body && "maxDollars" in body) patch.max_cents = walletLimitCents(body.maxDollars);
  if (body && "otto" in body) patch.otto = body.otto !== false;
  const next = await patchWallet(id, patch);
  return c.json(publicView(next || row));
});

wallet.delete("/wallet", rateLimit(20, 60 * 60 * 1000), async (c) => {
  const id = walletId(c);
  if (!WALLET_ID.test(id)) return c.json({ error: "no wallet" }, 404);
  const row = await getWallet(id);
  if (!row) return c.json({ error: "no wallet" }, 404);
  const next = await patchWallet(id, { payment_method: null, brand: null, last4: null, otto: false });
  return c.json(publicView(next || row));
});

/** Webhook helper: a setup Checkout session completed for this wallet. */
export async function attachWalletFromSession(wallet: string, sessionId: string): Promise<void> {
  if (!WALLET_ID.test(wallet)) return;
  const row = await getWallet(wallet);
  if (!row) return;
  await applySetup(wallet, sessionId);
}
