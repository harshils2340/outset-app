import { useApp } from "../../state/AppProvider";

/**
 * The guest app's one notice channel. It is also the only thing said when a booking is refused on the phone:
 * the request sheet ignores what `confirmUnclaimed` hands back, so "That time was just booked. Pick another
 * time." arrives here and nowhere else, and the same goes for a link to a listing that has left the catalog.
 *
 * So this is a live region. It used to be a plain div, which meant the pill faded in at the bottom of the
 * screen and a guest using a screen reader was told nothing at all: the button went back from "Sending…" to
 * "Request to book" and the press read as having done nothing. The container is always mounted and the text
 * is what changes, which is the shape a live region has to have to be announced reliably.
 *
 * `polite` rather than `alert`: this pill also carries ordinary notices, and a guest who has just pressed a
 * button is idle, so polite is read out at once.
 */
export function Toast() {
  const { state } = useApp();
  return (
    <div className={"toast" + (state.toast ? " on" : "")} role="status" aria-live="polite">
      {state.toast}
    </div>
  );
}
