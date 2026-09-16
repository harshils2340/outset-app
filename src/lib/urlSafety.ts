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

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(h)) return true;
  if (h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (isPrivateIPv4(h)) return true;
  if (h.startsWith("[")) {
    const inner = h.slice(1, -1);
    if (inner === "::1" || inner === "::") return true;
    if (/^fe[89ab][0-9a-f]:/i.test(inner)) return true; // link-local fe80::/10
    if (/^f[cd][0-9a-f]{2}:/i.test(inner)) return true; // unique local fc00::/7
  }
  return false;
}

/**
 * True only for an absolute http/https URL to a public host. No base is ever supplied, so a protocol-relative
 * or scheme-relative string ("//evil.com", "https:evil.com") fails to parse as absolute and is rejected rather
 * than silently resolved against the page's own origin.
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
