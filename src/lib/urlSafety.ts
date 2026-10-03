/**
 * Every URL the site puts into an href, an img/video src, or window.location starts life as crawled text, an
 * operator edit, or a catalog field: hostile input by the same rule as any rendered text. A `javascript:` link
 * executes the moment a guest clicks it (confirmed against a real browser, not just read off a spec), and an
 * unchecked redirect can send a guest anywhere while looking like it still belongs to the business. Only an
 * absolute http or https URL to a public host is ever safe to hand to the DOM.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "0.0.0.0", "::1", "[::1]", "::", "[::]"]);

function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if ([a, b, Number(m[3]), Number(m[4])].some((n) => n > 255)) return false;
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

/**
 * The IPv4 address written inside an IPv6 one, dotted, or null: the mapped range `::ffff:0:0/96` and the
 * deprecated compatible range `::/96`. An IPv4 address is still that address whichever it is spelled in, and
 * the browser connects to the same place. `new URL()` rewrites a dotted tail into hextets and compresses the
 * leading zero run, so `[::ffff:127.0.0.1]` arrives here as `::ffff:7f00:1`; the dotted form is read too, for
 * a caller that hands over a hostname of its own.
 */
function embeddedIPv4(inner: string): string | null {
  const dotted = /^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(inner);
  if (dotted) return dotted[1];
  const hex = /^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(inner);
  if (!hex) return null;
  const a = parseInt(hex[1], 16);
  const b = parseInt(hex[2], 16);
  return [a >> 8, a & 0xff, b >> 8, b & 0xff].join(".");
}

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(h)) return true;
  if (h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (isPrivateIPv4(h)) return true;
  if (h.startsWith("[")) {
    const inner = h.slice(1, -1);
    if (inner === "::1" || inner === "::") return true;
    // Loopback and the private ranges written as an IPv6 address, which is the spelling a URL actually
    // carries: fe80::/10 and fc00::/7 were refused and `[::ffff:7f00:1]` was not, so a crawled "website"
    // of http://[::ffff:127.0.0.1]:8080/ was a link a guest could click into their own machine.
    const v4 = embeddedIPv4(inner);
    if (v4) return isPrivateIPv4(v4);
    if (/^fe[89ab][0-9a-f]:/i.test(inner)) return true; // link-local fe80::/10
    if (/^f[cd][0-9a-f]{2}:/i.test(inner)) return true; // unique local fc00::/7
  }
  return false;
}

/**
 * True only for an absolute http/https URL to a public host. No base is ever supplied, so a protocol-relative
 * string ("//evil.com") fails to parse at all and is rejected rather than silently resolved against the page's
 * own origin. A scheme-relative "https:evil.com" does parse, because the URL parser forgives the missing
 * slashes on a special scheme, and it parses to `https://evil.com/`: an absolute URL to another host, which is
 * the same answer as writing it out, and never this page's origin.
 */
export function isPublicHttpUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (!u.hostname || isPrivateHost(u.hostname)) return false;
  return true;
}

/** The URL unchanged if it is safe to render, otherwise undefined so the caller can fall back or hide the link. */
export function safeHttpUrl(raw: string | null | undefined): string | undefined {
  return raw && isPublicHttpUrl(raw) ? raw : undefined;
}

/** True only for an absolute https URL on exactly this host (or a subdomain of it), for a redirect that must
 *  stay on a named service, such as sending a guest to Stripe. */
export function isHttpsUrlOnHost(raw: string | null | undefined, host: string): boolean {
  if (!raw) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  return u.protocol === "https:" && (u.hostname === host || u.hostname.endsWith("." + host));
}
