import { Mark } from "../layout/Mark";
import { WalletCard } from "../account/WalletCard";
import "../../styles/safebook.css";

/**
 * Demo of the two booking paths. Open at https://onoutset.com/#safe
 *
 * Human: guest picks a time and pays on Stripe Checkout, as today.
 * Agent: guest adds a card once on Profile, sets a limit, then Otto can hold that card.
 */

const HUMAN = [
  { n: "1", t: "Pick a time on the listing", d: "Same grid as today. Live slots when we can read them. Nothing invented." },
  { n: "2", t: "Pay on Stripe yourself", d: "Checkout holds the card. Otto never sees the number. The shop Accepts, then the charge goes through." },
];

const AGENT = [
  { n: "1", t: "Make an account, add a card once", d: "Stripe's page, not chat. Saved on your Profile with a limit you set." },
  { n: "2", t: "Otto books within that limit", d: "You still pick the time. Otto holds the saved card. Over the limit, you pay yourself." },
];

export function SafeBookDemo({ onClose, onOpenAccount }: { onClose: () => void; onOpenAccount?: () => void }) {
  return (
    <div className="sb" role="dialog" aria-labelledby="sb-title">
      <div className="sb-card">
        <header className="sb-top">
          <Mark size={28} />
          <div>
            <p className="sb-kicker">Demo</p>
            <h1 id="sb-title">You pay, or Otto pays within your limit</h1>
          </div>
          <button type="button" className="sb-x" onClick={onClose} aria-label="Close">
            Close
          </button>
        </header>

        <section className="sb-mode">
          <h2>You pay</h2>
          <ol className="sb-steps">
            {HUMAN.map((s) => (
              <li key={s.n}>
                <span className="sb-n">{s.n}</span>
                <div>
                  <b>{s.t}</b>
                  <p>{s.d}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="sb-mode">
          <h2>Otto pays, once you have said so</h2>
          <ol className="sb-steps">
            {AGENT.map((s) => (
              <li key={"a" + s.n}>
                <span className="sb-n">{s.n}</span>
                <div>
                  <b>{s.t}</b>
                  <p>{s.d}</p>
                </div>
              </li>
            ))}
          </ol>
          <WalletCard compact />
          {onOpenAccount ? (
            <p className="sb-link">
              <button type="button" className="sb-account" onClick={onOpenAccount}>
                Open Profile
              </button>
            </p>
          ) : null}
        </section>

        <p className="sb-note">
          Otto never sees a card number. The shop still Accepts unless Instant Book is on. Walk-ins still go to the dock.
        </p>
        <p className="sb-link">
          Share this page: <a href="https://onoutset.com/#safe">onoutset.com/#safe</a>
        </p>
      </div>
    </div>
  );
}
