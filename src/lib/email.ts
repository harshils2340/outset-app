/**
 * The one reader of an email address a crawl found on an operator's own website.
 *
 * It decides three things at once, so all three agree: which address the claim index hashes and shows a
 * masked hint of, what the dashboard prefills as the inbox a shop's booking alerts go to, and what the sync
 * publishes as an operator's contact fact. Of the 14,746 listings with an address on file, 96 hold something
 * nobody could write to: 32 are still percent-encoded because the site hid the address from scrapers
 * (`%53ere%6eew%61%74%65rsp%6frts@o%75t%6c%6f%6f%6b.c%6fm`), 42 are a site template's placeholder inbox
 * ("info@mysite.com", "info@company.com"), and the rest carry markup, an IP address, a row of asterisks
 * masking the name, a zero-width space or a trailing dot or slash.
 *
 * That address is how an owner proves the listing is theirs, so a wrong one shuts them out of their own
 * business: for 12 of them the address we hold is at free mail, where the domain rule cannot vouch for them
 * either. It is also what the claim screen offers to write to, and it was offering "i...@********ng.com".
 */

/** Site builders' own template inboxes, and the addresses a documentation example leaves behind. */
const PLACEHOLDER_DOMAIN = /^(?:example\.(?:com|org|net)|domain\.com|your-?domain\.com|your-?company\.com|mysite\.com|mydomain\.com|company\.com|site\.com|website\.com|test\.com|sentry\.wixpress\.com|.+\.ingest\.sentry\.io)$/i;
const SHAPE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;
const INVISIBLE = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(31) + "​-‏  ﻿]", "g");

/**
 * The address as a person could write to it, or null when what was stored is not one.
 *
 * Percent-encoding is decoded, because that is the address the shop published, only hidden from robots. A
 * name the site masked with asterisks is not decodable and is not an address. Case is kept: the part before
 * the @ belongs to the mail host, not to us.
 */
export function contactEmail(raw: string | null | undefined): string | null {
  let e = (raw || "").replace(INVISIBLE, "").trim();
  if (!e) return null;
  e = e.replace(/^mailto:/i, "").replace(/^[<("']+|[>)"']+$/g, "").split(/[?&]/)[0];
  if (/%[0-9a-f]{2}/i.test(e)) {
    try {
      e = decodeURIComponent(e);
    } catch {
      return null;
    }
    e = e.replace(INVISIBLE, "").trim();
  }
  // A trailing sentence mark or path separator the crawl kept: "info@brevardzoo.org.", "info@skyjump.com/".
  e = e.replace(/[.,;:/\\]+$/, "").trim();
  if (!SHAPE.test(e)) return null;
  const domain = e.split("@")[1].toLowerCase();
  if (PLACEHOLDER_DOMAIN.test(domain)) return null;
  return e;
}
