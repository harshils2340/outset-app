/**
 * Where a guest goes when a screen has faulted.
 *
 * Every listing this app draws is prose, hours, prices and photos crawled from somebody else's website, and
 * the screen the guest is on is named by the hash: `#o=<id>` is the link in a share, in an outreach email and
 * in the address bar while a listing is open. So the one screen most likely to fault is also the one a plain
 * reload lands back on, and a reader that throws on that shop's own words throws again on the way back in.
 * Pressing the only button on the crash screen would then look like it did nothing at all.
 *
 * Dropping the hash and reloading answers both halves: a fault that was a one-off race or a half-loaded
 * catalog goes away with the reload, and one that is really in a particular shop's record lands the guest on
 * the home with the rest of the catalog to browse rather than back on the screen that broke. Nothing stored is
 * touched: the bookings, the wishlist and an operator's own profile all live in localStorage and are still
 * there afterwards.
 */

/** The same page with no hash, which is the app's own home. A URL that carries none is returned unchanged. */
export function restartHref(href: string): string {
  const at = String(href).indexOf("#");
  return at === -1 ? String(href) : String(href).slice(0, at);
}

/**
 * Leave the screen that faulted.
 *
 * `location.replace` to the same page without its fragment is a same-document navigation, so the browser
 * fetches nothing and the broken tree stays on screen: driven in a real Chromium, pressing the button that
 * way left the guest on the crash screen with the hash still in the bar. `history.replaceState` changes the
 * document's URL there and then, so the `reload` after it rebuilds the app on the clean one. A page that
 * carried no hash is simply reloaded.
 */
export function restart(win: {
  location: { href: string; reload: () => void };
  history: { replaceState: (state: unknown, title: string, url: string) => void };
}): void {
  const next = restartHref(win.location.href);
  if (next !== win.location.href) win.history.replaceState(null, "", next);
  win.location.reload();
}
