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
