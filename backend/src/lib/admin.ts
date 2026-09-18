import { timingSafeEqual } from "node:crypto";
import type { Context } from "hono";

/**
 * Who may read the internal metrics page.
 *
 * Two doors, because the page and the founder's terminal are not the same caller:
 *  - a signed session whose email is named in ADMIN_EMAILS (the browser signs in with an emailed code, so no
 *    secret is ever typed into a page or put in a URL), and
 *  - the x-admin-key header the rest of the internal tooling already uses, for curl.
 *
 * ADMIN_EMAILS is comma separated, lowercased and trimmed. Unset means nobody, which is the safe default for a
 * public host: a page that tracks money must not be readable because a variable was forgotten.
 */

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  const e = (email || "").trim().toLowerCase();
  if (!e) return false;
  return adminEmails().includes(e);
}

/** Constant-time, the same way the blanket admin gate in routes.ts compares. */
function keyMatches(got: string, key: string): boolean {
  if (!key || got.length !== key.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(key));
}

/**
 * The curl door: the same header and the same comparison the rest of the internal tooling uses.
 *
 * This module deliberately does not import the session helpers. auth.ts asks it whether an address is an admin
 * (so a sign-in code reaches an admin who has claimed no listing), and an import back the other way would make
 * that a cycle. The route puts the two halves together.
 */
export function hasAdminKey(c: Context): boolean {
  const key = (process.env.ADMIN_KEY || "").trim();
  return !!key && keyMatches(c.req.header("x-admin-key") || "", key);
}
