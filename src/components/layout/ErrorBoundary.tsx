import { Component, type ErrorInfo, type ReactNode } from "react";

import { ICONS } from "../../data/icons";
import { restart } from "../../lib/crashRecovery";
import { Markup } from "../Markup";

/**
 * The one thing standing between a reader that throws and a white page.
 *
 * React unmounts the whole tree when a render throws and nothing catches it, so until this existed a single
 * bad character in one shop's own words took down the entire app: not the sentence, not the section, not the
 * listing, the window. The guest read a blank page with nothing on it to press, and the Trips tab holding the
 * booking they had already paid for went with it. Everything this app prints about 48,198 businesses is
 * crawled from their own websites, which is the one input nobody here writes, so the question was never
 * whether a reader could fault but what a guest would see when one did.
 *
 * It catches a throw from anywhere under it during render, in a lifecycle method or in a constructor, which is
 * every code path that draws a screen. It cannot catch one from an event handler or from inside a promise,
 * because React is not on the stack for those; those are the paths that already answer with a toast.
 *
 * The fault still reaches the console in full, with the component stack React hands over, because a crash
 * swallowed quietly is worse than the white page: that is the only record of it until this app reports errors
 * somewhere.
 */
type Props = {
  children: ReactNode;
  /** Which part of the app this is guarding, for the console line. Never shown to a guest. */
  where: string;
};

type State = { failed: boolean };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Not a mailbox, a name or a booking code: an exception and the components it came through. See the
    // masking rule the API keeps for its own logs in backend/src/api.
    console.error("Outset: a screen faulted in " + this.props.where, error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="empty" role="alert">
        <div className="glyph">
          <Markup html={ICONS.compass} />
        </div>
        <b>Something went wrong on this screen</b>
        <p>
          Nothing you have booked or saved is lost. Start again and the rest of Outset is still here.
        </p>
        <p style={{ marginTop: 16 }}>
          <button type="button" className="cta" onClick={() => restart(window)}>
            Start again
          </button>
        </p>
      </div>
    );
  }
}
