/**
 * The admin view, for comparing a listing against the operator's own website.
 *
 * Guest pages never show an operator's website or where a listing came from (standing rule: guests see only what
 * they use). Harshil still needs that link to check a listing against the real site, so it is shown only in this
 * browser once admin is switched on. Visiting any page with `#admin` in the address toggles it: on the first visit
 * it turns on, on the next it turns off. `#o=<id>&admin` works on a listing link too. The token is removed from the
 * address after it is read, so a reload or a shared link does not flip it again.
 *
 * This is a view switch, not a permission: the website is public data already in the catalog (`src` on lite records,
 * `contact.domain` in detail files). Nothing private is behind it.
 */

const KEY = "outset.admin.v1";
const EVENT = "outset:admin";

let cached: boolean | null = null;

/** True when this browser has the admin view switched on. False whenever storage is unavailable. */
export function isAdmin(): boolean {
  if (cached != null) return cached;
  try {
    cached = typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "1";
  } catch {
    cached = false;
  }
  return cached;
}

function setAdmin(on: boolean): void {
  cached = on;
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: the flag lasts for this page only */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

/**
 * Reads `#admin` (alone, or as one `&`-separated part of the hash), flips the flag, and strips the token from the
 * address. Returns the flag after the check, whether or not the hash carried the token.
 */
export function toggleAdminFromHash(): boolean {
  if (typeof window === "undefined") return false;
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return isAdmin();
  const parts = hash.split("&");
  const rest = parts.filter((p) => p.toLowerCase() !== "admin");
  if (rest.length === parts.length) return isAdmin();
  setAdmin(!isAdmin());
  const next = rest.length ? "#" + rest.join("&") : "";
  window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search + next);
  return isAdmin();
}

/** Calls `fn` whenever the admin flag changes, in this tab or another. Returns the unsubscribe function. */
export function subscribeAdmin(fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    cached = null;
    fn();
  };
  window.addEventListener(EVENT, fn);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener("storage", onStorage);
  };
}

/** The operator's website as an https URL, or null for map pins and anything that is not a web domain. */
export function adminWebsite(item: { src?: string | null; contact?: { domain?: string | null; website?: string | null } | null }): string | null {
  const raw = (item.contact?.website || item.contact?.domain || item.src || "").trim();
  if (!raw) return null;
  let host = raw;
  try {
    host = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw).hostname;
  } catch {
    return null;
  }
  host = host.toLowerCase().replace(/\.$/, "");
  // "osm-node-13123988657" is a map pin id, not a domain.
  if (!/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(host) || /^osm-/.test(host)) return null;
  return "https://" + host + "/";
}

// Any page load or hash change carrying #admin flips the flag, wherever this module is first imported.
if (typeof window !== "undefined") {
  toggleAdminFromHash();
  window.addEventListener("hashchange", () => toggleAdminFromHash());
}
