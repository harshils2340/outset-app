import { useCallback, useEffect, useState } from "react";
import {
  createGuestWallet,
  fetchGuestWallet,
  hasApi,
  loadWalletId,
  patchGuestWallet,
  readyGuestWallet,
  revokeGuestWallet,
  setupGuestWallet,
  type GuestWallet,
} from "./api";
import { loadGuest } from "./storage";

/**
 * Guest wallet on this device: a saved Stripe card, a spend cap, and whether Otto may use it.
 * Otto never sees the number. The guest types it once on Stripe.
 */

// Otto's autonomous-pay feature isn't ready for guests yet: `import.meta.env.DEV` compiles to `false` in a
// production build, so every Otto surface (CTA copy, the wallet card, the #safe demo) disappears from what
// a visitor downloads, while it stays visible in a local dev build to keep working on it.
export const OTTO_LIVE = !!import.meta.env?.DEV;

/** The eligibility rule alone: whether this wallet, as saved, could cover the total. Does not check OTTO_LIVE. */
export function ottoCanPay(w: GuestWallet | null, total: number | null | undefined): boolean {
  if (!w || !w.ready || !w.otto || total == null || !Number.isFinite(total) || total < 1) return false;
  return Math.round(total * 100) <= Math.round(w.maxDollars * 100);
}

/** What the UI should actually act on: eligible, and the feature is live in this build. */
export function ottoActive(w: GuestWallet | null, total: number | null | undefined): boolean {
  return OTTO_LIVE && ottoCanPay(w, total);
}

export function useWallet(): { wallet: GuestWallet | null; loading: boolean; refresh: () => Promise<void> } {
  const [wallet, setWallet] = useState<GuestWallet | null>(null);
  const [loading, setLoading] = useState(!!loadWalletId());
  const refresh = useCallback(async () => {
    if (!hasApi()) {
      setWallet(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const w = await fetchGuestWallet();
    setWallet(w);
    setLoading(false);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { wallet, loading, refresh };
}

export async function addCardOnStripe(): Promise<string | null> {
  if (!hasApi()) return null;
  if (!loadWalletId()) await createGuestWallet();
  return setupGuestWallet(loadGuest().email);
}

export async function finishCardSetup(): Promise<GuestWallet | null> {
  return readyGuestWallet();
}

export async function setWalletLimit(dollars: number): Promise<GuestWallet | null> {
  return patchGuestWallet({ maxDollars: dollars });
}

export async function setOttoOn(on: boolean): Promise<GuestWallet | null> {
  return patchGuestWallet({ otto: on });
}

export async function removeSavedCard(): Promise<GuestWallet | null> {
  return revokeGuestWallet();
}
