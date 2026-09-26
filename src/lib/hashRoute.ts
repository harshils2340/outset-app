/**
 * What the address bar's hash asks the app for.
 *
 * `#o=<id>` is the link every listing's Share button writes, the link in an outreach email, and the URL the
 * app keeps in the bar while a listing is open, so a refresh lands on the same listing.
 *
 * The reason this is a module of its own rather than an inline regex: a fragment navigation fires `popstate`
 * BEFORE `hashchange` in Chrome (a same-document navigation queues both), so a link to a listing reaches the
 * back-button handler first and, left alone, reads as the guest pressing back.
 */

/**
 * A listing id as the catalog spells it. Every one of the 52,815 shipped ids is lower case, and every regex
 * that reads one out of the hash is case-insensitive, so a link whose id has been shouted somewhere along the
 * way names a real listing and used to resolve to nothing: the app dropped it in silence, and now that it says
 * something when a listing cannot be found it would say the wrong thing.
 */
export function listingId(raw: string): string {
  return raw.toLowerCase();
}

/** The listing a hash names, or null. Accepts a bare hash ("#o=x") or a whole URL. */
export function listingInHash(hashOrUrl: string): string | null {
  const at = hashOrUrl.indexOf("#");
  const hash = at === -1 ? "" : hashOrUrl.slice(at);
  const m = /^#o=([a-z0-9-]+)/i.exec(hash);
  return m ? listingId(m[1]) : null;
}

/**
 * True when a `popstate` at this URL is a link to a different listing rather than the back button, so the
 * handler that closes an open sheet on back must leave it alone and let `hashchange` open that listing.
 *
 * Which listing the hash names is the whole difference. Back out of a listing lands on a URL that carries no
 * hash at all, or on the app's own second entry for the same listing, so `openId` matching means back and the
 * sheet closes as it always did. A hash naming some other listing can only have come from a link.
 *
 * `known` keeps this to listings the catalog actually holds: a hash naming nothing is not a link to anywhere.
 */
export function hashOpensAnotherListing(hashOrUrl: string, openId: string | null, known: (id: string) => boolean): boolean {
  const id = listingInHash(hashOrUrl);
  return !!id && id !== openId && known(id);
}
