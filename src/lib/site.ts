/** Public guest origin. Listing, claim and remove links all use this. */
export const SITE = "https://onoutset.com";

/** The one support address, shown in the footer and on every legal page. */
export const HELP_EMAIL = "hello@onoutset.com";

/** The business postal address, one line, for the footer and the legal pages. */
export const POSTAL_ADDRESS = "Outset, 339 King St N, Waterloo, ON N2J 0C5, Canada";

/** The static pages every guest surface links to in its footer. */
export const LEGAL_LINKS = [
  { href: "/about.html", label: "About Outset" },
  { href: "/terms.html", label: "Terms" },
  { href: "/privacy.html", label: "Privacy" },
] as const;

export function listingUrl(id: string): string {
  return SITE + "/#o=" + id;
}

export function claimUrl(id: string, token: string): string {
  return SITE + "/#claim=" + id + "&k=" + token;
}

export function removeUrl(id: string): string {
  return SITE + "/#remove=" + id;
}

/**
 * What the browser tab, the bookmark, the history entry and a screen reader call the page.
 *
 * The app never set one, so every listing a guest opened read "Book things to do near you · Outset", the
 * title `index.html` ships: four listings open in four tabs were four identical tabs, a bookmark of a shop
 * was filed under the home page's name, and the history entry for a listing named no business at all. The
 * static `/l/` page for the same shop has always been titled by the business, so one listing had two names
 * depending on who fetched it. A hash route fires no page load either, so a screen reader moving from the
 * home to a listing was never told the page had changed.
 *
 * The format is the static page's own (`backend/src/sync/listingPages.ts`), so the two agree on every shop.
 */
export const DEFAULT_TITLE = "Book things to do near you · Outset";

/** The tab title for an open listing, or the site's own when no listing is open. */
export function pageTitle(item: { title?: string; area?: string } | null): string {
  const name = (item?.title || "").trim();
  if (!name) return DEFAULT_TITLE;
  const area = (item?.area || "").trim();
  return name + (area ? " in " + area : "") + " · Outset";
}
