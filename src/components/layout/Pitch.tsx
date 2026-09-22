import { getCatalog } from "../../lib/catalog";
import { useApp } from "../../state/AppProvider";
import { METROS } from "../../data/metros";
import { Mark } from "./Mark";

export function Pitch() {
  useApp();
  const count = getCatalog().length;
  return (
    <div className="pitch">
      <div className="wordmark">
        <Mark size={32} />
        <b>Outset</b>
      </div>
      <h1>
        Book the jump. <em>Skip the call.</em>
      </h1>
      <p>Real operators across the US and Canada. Instant Book, facts from their own sites.</p>
      <div className="pitchstats">
        <div>
          <b>{count.toLocaleString()}</b>
          <span>operators</span>
        </div>
        <div>
          <b>{METROS.length}</b>
          <span>metros</span>
        </div>
        <div>
          <b>US + CA</b>
          <span>coverage</span>
        </div>
      </div>
      <p className="pitchfoot">
        Pick a slot and pay. Prices and rules come from each operator's own site.
      </p>
    </div>
  );
}
