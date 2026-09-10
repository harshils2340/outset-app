/** Public guest origin. Listing, claim and remove links all use this. */
export const SITE = "https://onoutset.com";

export function listingUrl(id: string): string {
  return SITE + "/#o=" + id;
}

export function claimUrl(id: string, token: string): string {
  return SITE + "/#claim=" + id + "&k=" + token;
}

export function removeUrl(id: string): string {
  return SITE + "/#remove=" + id;
}
