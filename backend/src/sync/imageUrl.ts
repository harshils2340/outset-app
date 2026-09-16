/**
 * The published address of a stored image. Shared by the catalog build and by the photo work list, because the
 * photo screen judges images by the address the site publishes, so anything that looks a verdict up has to ask
 * with the same address.
 */

/**
 * A machine nobody but the developer can reach. A crawled page can carry one: solidcore's own site links
 * `http://localhost:3000/solidcore-studios.webp`, which shipped as the cover of all fifteen of their studios,
 * and a guest's browser asked their own machine for it and got nothing.
 */
const PRIVATE_HOST =
  /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|169\.254(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|\[?::1\]?|[^.]+\.(?:local|internal|localdomain|lan|test|invalid|example))$/i;

/**
 * What a registrar shows when the business let its domain lapse, or never built the site. It is the only image
 * on the page, so it wins the cover slot: 43 listings led with HugeDomains' own "this domain is for sale"
 * banner, a go kart track and a brewery among them, and seven more with Squarespace's parking wallpaper.
 * `bat.bing.com` and `atom.com` story cards are a parking page's tracking pixel and its for-sale card.
 */
const PARKED_HOST =
  /(^|\.)(?:hugedomains|sedoparking|sedo|afternic|bodis|parkingcrew|cashparking|domainmarket|brandbucket|squadhelp|atom|gname|sitecdn)\.com$|^bat\.bing\.com$/i;
const PARKED_PATH = /\/parking-page\/|coming[-_+%\s]?soon|under[-_+%\s]?construction|under[-_+%\s]?suspension/i;

/** Wix lazy-load placeholders are 34px blurred stubs. Ask for the full image instead; tiny variants from other hosts are dropped. */
export function fullSize(u: string): string | undefined {
  if (!u) return undefined;
  if (!publishableImage(u)) return undefined;
  const wix = u.match(/^(https?:\/\/static\.wixstatic\.com\/media\/[^/]+?)(?:\/v1\/|$)/);
  if (wix) return wix[1] + "/v1/fill/w_1600,h_1000,al_c,q_85/" + wix[1].split("/media/")[1].replace(/%7E/gi, "~");
  if (/[?&/](w|width)[=_]\d{1,2}\b|[?&/](h|height)[=_]\d{1,2}\b|blur_\d|\/w_1?\d{2},h_\d{2}\b/.test(u)) return undefined;
  return u;
}

/**
 * False for an address no guest can load, and for a registrar's own artwork on a domain that is parked or
 * unbuilt. The crawl refuses these as it reads a page, and the sync refuses them again, because the ones
 * already stored as facts are only cleared by a rule that runs when the catalog is written.
 */
export function publishableImage(u: string): boolean {
  if (!u) return false;
  let host: string;
  try {
    host = new URL(u).hostname;
  } catch {
    return false;
  }
  if (PRIVATE_HOST.test(host) || PARKED_HOST.test(host)) return false;
  return !PARKED_PATH.test(u);
}

/** Verdicts the photo screen records for an image that must not be published. */
export const REJECTED_KIND = /^(?:graphic|map|document|dead)$/;
