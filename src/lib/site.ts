import { placeName } from "./listingDerive";

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
  return SITE + "/activities#o=" + id;
}

export function claimUrl(id: string, token: string): string {
  return SITE + "/operators#claim=" + id + "&k=" + token;
}

export function removeUrl(id: string): string {
  return SITE + "/activities#remove=" + id;
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

/**
 * The tab title for an open listing, or the site's own when no listing is open.
 *
 * The place is spelled out, the way the listing page under this title, the review-and-pay sheet and the confirm
 * screen all spell it: 2,943 listings publish a state or province code with no town in front of it, so a tab, a
 * bookmark and a shared link all read "Ace Kayaks in MD · Outset" for them.
 */
export function pageTitle(item: { title?: string; area?: string } | null): string {
  const name = (item?.title || "").trim();
  if (!name) return DEFAULT_TITLE;
  const area = placeName((item?.area || "").trim());
  return name + (area ? " in " + area : "") + " · Outset";
}

/**
 * What the tab, the bookmark and the history entry call the operator dashboard.
 *
 * `pageTitle` gave every guest screen its own name and the operator side was left on the site's default, so an
 * owner with the dashboard open in a tab read "Book things to do near you · Outset", a bookmark of their own
 * dashboard was filed under the guest marketplace, and two tabs (their listing and their dashboard) were two
 * identical entries in the history. The business is named when the catalog has it, the same way the listing
 * title names it, and the word "dashboard" keeps the two tabs apart.
 */
export function dashboardTitle(item: { title?: string } | null): string {
  const name = (item?.title || "").trim();
  return (name ? name + " dashboard" : "Operator dashboard") + " · Outset";
}
