import { useEffect, type RefObject } from "react";
import { DIALOG_STOPS, tabWrap } from "../../lib/dialog";

/**
 * The three things a dialog owes the page behind it, in one place: focus goes in and comes back, Tab stays
 * inside, and the page does not scroll under the scrim.
 *
 * The lock is on the root element as well as on `body`. `app.css` clips `html`'s overflow-x, which makes `html`
 * the element the viewport scrolls by, so `body { overflow: hidden }` on its own locks nothing at all: a wheel
 * over the photo lightbox rolled the listing 1,600 px underneath it, and closing the lightbox left the guest
 * somewhere else on the page. The card form learned this the hard way and nothing else was ever told.
 *
 * Focus moves in only when it is not already inside, so a dialog that autofocuses a field of its own (the Where
 * box) keeps it. Stops are read fresh on every Tab, because a dialog's contents change while it is open, and
 * measured by their rects rather than by `offsetParent`, which is null for everything inside a fixed scrim.
 */
export function useModal(box: RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    const prev = { root: root.style.overflow, body: document.body.style.overflow };
    root.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = box.current;
    if (node && !node.contains(document.activeElement)) {
      const first = node.querySelector<HTMLElement>(DIALOG_STOPS);
      (first || node).focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !box.current) return;
      const stops = [...box.current.querySelectorAll<HTMLElement>(DIALOG_STOPS)].filter((el) => el.getClientRects().length > 0);
      const to = tabWrap(stops.length, stops.indexOf(document.activeElement as HTMLElement), e.shiftKey);
      if (to == null) return;
      e.preventDefault();
      stops[to].focus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      root.style.overflow = prev.root;
      document.body.style.overflow = prev.body;
      // The page behind re-renders while a dialog is open, so whatever opened it may no longer be there.
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [active]);
}
