export function Pitch() {
  return (
    <div className="pitch">
      <div className="wordmark">
        <svg width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden="true">
          <rect width="30" height="30" rx="9" fill="#EE4E1B" />
          <path
            d="M6 20.5c2.6 0 2.6-2.2 5.2-2.2s2.6 2.2 5.2 2.2 2.6-2.2 5.2-2.2c1.3 0 1.9.55 2.4 1.1"
            stroke="#fff"
            strokeWidth="2.1"
            strokeLinecap="round"
          />
          <path d="M8.5 15.2 15 7.5l6.5 7.7z" fill="#fff" />
        </svg>
        <b>Outset</b>
      </div>
      <h1>
        Book the jump, the boat, the lane. <em>Skip the phone call.</em>
      </h1>
      <p>
        Every local experience worth doing, with live availability, instant confirmation, and an agent that answers for
        the operator around the clock.
      </p>
      <dl>
        <dt>The problem</dt>
        <dd>
          Skydives, jet skis, karting, escape rooms: the whole category still runs on <b>&quot;call for availability.&quot;</b> Half
          of inbound never gets a callback.
        </dd>
        <dt>The fix</dt>
        <dd>
          Operators publish real inventory. Guests see <b>open slots, not a phone number</b>, and book in about forty
          seconds.
        </dd>
        <dt>Try it</dt>
        <dd>
          Pick a date, grab a slot, confirm. Then open <b>Inbox</b> and ask the operator&apos;s agent anything.
        </dd>
      </dl>
    </div>
  );
}
