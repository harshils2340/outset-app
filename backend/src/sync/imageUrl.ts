import { isIP } from "node:net";
import { isBlockedAddress } from "../lib/safeFetch.ts";

/**
 * The published address of a stored image. Shared by the catalog build and by the photo work list, because the
 * photo screen judges images by the address the site publishes, so anything that looks a verdict up has to ask
 * with the same address.
 */

/**
 * A name nobody but the developer can reach. A crawled page can carry one: solidcore's own site links
 * `http://localhost:3000/solidcore-studios.webp`, which shipped as the cover of all fifteen of their studios,
 * and a guest's browser asked their own machine for it and got nothing.
 *
 * Names only. An address literal goes to `isBlockedAddress` in lib/safeFetch.ts, the guard the crawler already
 * uses, because this was the third copy of "is this host private" in the tree and the one still reading an
 * IPv4 address written inside an IPv6 one as a public host. `new URL()` rewrites the dotted tail into hextets,
 * so `http://[::ffff:127.0.0.1]/hero.jpg` arrives here as `::ffff:7f00:1` and the IPv4-compatible
 * `http://[::7f00:1]/hero.jpg` as itself: both matched nothing, shipped as a listing's cover, and a guest's
 * browser asked their own machine for the picture. The shared guard reads both spellings as the address they
 * are, and knows the unspecified address `::` besides, which the regex's own `::1` arm did not.
 */
const PRIVATE_NAME = /^(?:localhost|[^.]+\.(?:local|internal|localdomain|lan|test|invalid|example|localhost))$/i;

/** True for an address or a name a guest's browser could only resolve inside their own network. */
function privateHost(host: string): boolean {
  return isIP(host) ? isBlockedAddress(host) : PRIVATE_NAME.test(host);
}

/** wsrv.nl (images.weserv.nl) is a free image proxy we wrap trusted URLs through ourselves. A stored photo
 * address can already be one, when the operator's own site uses it as their CDN, and an unrecognized query
 * parameter there is not always harmless: `errorredirect` sends a guest's browser to an arbitrary URL of the
 * page author's choosing if the image fails to load, an open redirect riding a legitimate-looking image host.
 * Only the parameters this codebase's own wrapping ever sets are allowed through unexamined. */
const WSRV_HOST = /(^|\.)(?:wsrv\.nl|images\.weserv\.nl)$/i;
const WSRV_SAFE_PARAMS = new Set(["url", "w", "h", "fit", "output", "q", "il", "n", "dpr", "cs", "a", "blur", "sharp", "gam", "we"]);

/**
 * What a registrar shows when the business let its domain lapse, or never built the site. It is the only image
 * on the page, so it wins the cover slot: 43 listings led with HugeDomains' own "this domain is for sale"
 * banner, a go kart track and a brewery among them, and seven more with Squarespace's parking wallpaper.
 * `bat.bing.com` and `atom.com` story cards are a parking page's tracking pixel and its for-sale card.
 */
const PARKED_HOST =
  /(^|\.)(?:hugedomains|sedoparking|sedo|afternic|bodis|parkingcrew|cashparking|domainmarket|brandbucket|squadhelp|atom|gname|sitecdn)\.com$|^bat\.bing\.com$/i;
const PARKED_PATH = /\/parking-page\/|coming[-_+%\s]?soon|under[-_+%\s]?construction|under[-_+%\s]?suspension/i;

/**
 * An image request whose only job is to be fetched: an analytics beacon, a spam filter's receipt, a layout
 * spacer, a theme's placeholder. It is never a picture of a business, and it is usually one transparent pixel.
 * `bat.bing.com` above was the first of these found, one at a time; these are the rest, by what they have in
 * common. A host whose first label announces it counts (`pixel.wp.com`, `analytics.alpine.io`), a path filed
 * under one (`moderate15-v4.cleantalk.org/pixel/<hash>.gif`, `/collect/p.gif`), and the standard placeholder
 * file names. A solid colour is only taken as a spacer when it is a GIF, because a real photograph can be
 * called white.png and no real photograph is a GIF called white.gif.
 */
const PIXEL_HOST = /^(?:pixel|pixels|analytics|beacon|beacons|stats|telemetry|metrics|track|tracker|tracking)\./i;
/** A host that serves only some other company's own interface. `paypalobjects.com` is PayPal's button art, and
 *  a "Buy Now" button led six listings' heroes as their video. No photograph has ever come from one. */
const VENDOR_CHROME = /(^|\.)paypalobjects\.com$/i;
const PIXEL_PATH = /\/(?:pixel|pixels|collect|beacon|track|tracking|telemetry)\//i;
const PIXEL_NAME =
  /(?:^|\/)(?:spacer|cleardot|clear|blank|transparent|trans|holder|placeholder|waiting|loading|spinner|pixel|px|dot|1x1|hsts-pixel)\.(?:gif|png)$|(?:^|\/)(?:grey|gray|white)\.gif$/i;

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
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return false;
  }
  // Only ever a real fetch a guest's browser makes over the network: never `data:` (an inline blob with no
  // address a photo screen or the app's own image proxy could ask for), `blob:`, `javascript:` or a bare file path.
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (privateHost(host) || PARKED_HOST.test(host)) return false;
  if (PIXEL_HOST.test(host) || VENDOR_CHROME.test(host) || PIXEL_PATH.test(url.pathname) || PIXEL_NAME.test(url.pathname)) return false;
  if (WSRV_HOST.test(host)) {
    for (const key of url.searchParams.keys()) if (!WSRV_SAFE_PARAMS.has(key.toLowerCase())) return false;
  }
  return !PARKED_PATH.test(u);
}

/** Verdicts the photo screen records for an image that must not be published. */
export const REJECTED_KIND = /^(?:graphic|map|document|dead)$/;
