/**
 * What a guest wallet is allowed to spend. The card itself lives on Stripe. These numbers are the
 * limits the guest set on their Profile, enforced here before any PaymentIntent is created.
 */

export const WALLET_DEFAULT_CENTS = 25_000;
export const WALLET_MIN_CENTS = 2_000;
export const WALLET_MAX_CENTS = 200_000;
export const WALLET_ID = /^[a-f0-9]{48}$/;

export type WalletSpend = {
  otto: boolean;
  paymentMethod: string | null;
  maxCents: number;
};

/** Dollars in, cents out, clamped to the range the Profile slider offers. */
export function walletLimitCents(dollars: unknown): number {
  const n = typeof dollars === "number" ? dollars : Number(dollars);
  if (!Number.isFinite(n)) return WALLET_DEFAULT_CENTS;
  const cents = Math.round(n * 100);
  return Math.min(WALLET_MAX_CENTS, Math.max(WALLET_MIN_CENTS, cents));
}

export function walletLimitDollars(cents: number): number {
  return Math.round(cents) / 100;
}

/**
 * True when Otto may hold this card for `totalDollars`. A missing method, Otto switched off, or a total
 * above the cap all fall through to the guest paying themselves on Stripe Checkout.
 */
export function agentMayCharge(w: WalletSpend, totalDollars: number): boolean {
  if (!w.otto || !w.paymentMethod) return false;
  if (!Number.isFinite(totalDollars) || totalDollars < 1) return false;
  return Math.round(totalDollars * 100) <= w.maxCents;
}
