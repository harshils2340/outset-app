import { useEffect, useState } from "react";
import { loadGuest } from "../../lib/storage";
import { addCardOnStripe, finishCardSetup, removeSavedCard, setOttoOn, setWalletLimit, useWallet } from "../../lib/wallet";
import { hasApi } from "../../lib/api";
import { money } from "../../lib/format";

/**
 * Add a card once, set a cap, switch Otto on. After that a booking at or under the cap holds the
 * saved card. Otto never sees the number: Stripe already has it.
 */
export function WalletCard({ compact }: { compact?: boolean }) {
  const { wallet, loading, refresh } = useWallet();
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [limit, setLimit] = useState(250);

  useEffect(() => {
    if (wallet) setLimit(wallet.maxDollars);
  }, [wallet]);

  useEffect(() => {
    if (!/^#wallet=ready/i.test(window.location.hash)) return;
    let alive = true;
    setBusy("Saving the card…");
    void finishCardSetup().then(async () => {
      if (!alive) return;
      await refresh();
      setBusy("");
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    });
    return () => {
      alive = false;
    };
  }, [refresh]);

  const addCard = async () => {
    setErr("");
    setBusy("Opening Stripe…");
    const url = await addCardOnStripe();
    if (!url) {
      setBusy("");
      setErr(hasApi() ? "Could not start card setup. Try again in a moment." : "Open onoutset.com to add a card. This local page is not wired to Stripe.");
      return;
    }
    window.location.assign(url);
  };

  const saveLimit = async (n: number) => {
    setLimit(n);
    const next = await setWalletLimit(n);
    if (next) await refresh();
  };

  const toggleOtto = async (on: boolean) => {
    await setOttoOn(on);
    await refresh();
  };

  const remove = async () => {
    setBusy("Removing…");
    await removeSavedCard();
    await refresh();
    setBusy("");
  };

  const ready = !!wallet?.ready;
  const guest = loadGuest();

  return (
    <section className={"walletcard" + (compact ? " compact" : "")}>
      <h3>Otto booking</h3>
      <p>
        Add a card once. Set a limit. After that Otto can hold it for bookings at or under that number. You still pick the time. Otto never sees the card.
      </p>
      {loading && !wallet ? <p className="walletmeta">Checking this device…</p> : null}
      {ready ? (
        <>
          <p className="walletmeta">
            {(wallet!.brand || "Card").replace(/^\w/, (c) => c.toUpperCase())} ending {wallet!.last4}
            {guest.email ? " · " + guest.email : ""}
          </p>
          <label className="walletrow">
            <span>Otto can book for me</span>
            <input type="checkbox" checked={wallet!.otto} onChange={(e) => void toggleOtto(e.target.checked)} />
          </label>
          <label className="walletlimit">
            <span>Up to {money(limit)} per booking</span>
            <input type="range" min={50} max={1000} step={25} value={limit} onChange={(e) => void saveLimit(Number(e.target.value))} />
          </label>
          <p className="wallethint">{wallet!.otto ? "Bookings at or under this hold the saved card. Over it, you pay on Stripe yourself." : "Otto is off. You pay on Stripe yourself."}</p>
          <button type="button" className="walletghost" onClick={() => void remove()} disabled={!!busy}>
            Remove card
          </button>
        </>
      ) : (
        <button type="button" className="walletadd" onClick={() => void addCard()} disabled={!!busy}>
          {busy || "Add a card on Stripe"}
        </button>
      )}
      {err ? <p className="walleterr">{err}</p> : null}
    </section>
  );
}
