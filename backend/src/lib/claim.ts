import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Signed claim links. The email carries a token only the recipient has; the public listing file carries
 * a SHA-256 of that token. The static site can verify a link without any server or password.
 * The secret lives in backend/data/claim-secret.txt and is never committed.
 */

const here = dirname(fileURLToPath(import.meta.url));
const secretPath = join(here, "../../data/claim-secret.txt");

export function claimSecret(): string {
  if (process.env.CLAIM_SECRET) return process.env.CLAIM_SECRET.trim();
  if (existsSync(secretPath)) return readFileSync(secretPath, "utf8").trim();
  mkdirSync(dirname(secretPath), { recursive: true });
  const s = randomBytes(32).toString("hex");
  writeFileSync(secretPath, s + "\n");
  return s;
}

/** The token that goes in the email link: #claim=<catalog id>&k=<token>. */
export function claimToken(catalogId: string): string {
  return createHmac("sha256", claimSecret()).update(catalogId).digest("base64url").slice(0, 22);
}

/** What the public listing file carries so the app can check a token. */
export function claimKeyHash(catalogId: string): string {
  return createHash("sha256").update(claimToken(catalogId)).digest("hex");
}

/* ---------- expiring links ----------
 *
 * claimToken above is a pure function of the listing id: it never changes and never expires, so a link
 * that leaks once (a forwarded email, a screenshot, a shared inbox) can claim that listing forever, and
 * every owner who asks for a link gets the identical token. That is acceptable for the handful of links
 * sent by hand and not acceptable for a mailing.
 *
 * A v2 token carries its own expiry and is signed over id AND expiry, so it cannot be extended by editing
 * the link. The static claimKey in the catalog cannot check it, because that hash was baked at sync time
 * and a v2 token changes with its expiry. So v2 is verified by the API instead, which has the secret, and
 * the app trades it for an ordinary session. Legacy tokens keep working so links already sent still land.
 */

const V2 = "v2.";

/** How long a freshly minted claim link stays good. Cold outreach is slow, so this is generous. */
export function claimLinkDays(): number {
  const n = Number(process.env.CLAIM_LINK_DAYS || 30);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

function v2Signature(catalogId: string, expMs: number): string {
  return createHmac("sha256", claimSecret()).update(catalogId + "|" + expMs).digest("base64url").slice(0, 22);
}

/** An expiring token for a link: v2.<expiry base36>.<signature>. */
export function claimTokenV2(catalogId: string, days = claimLinkDays()): string {
  const exp = Date.now() + days * 86400000;
  return V2 + exp.toString(36) + "." + v2Signature(catalogId, exp);
}

export type ClaimCheck = { ok: true; kind: "v2" | "legacy"; exp?: number } | { ok: false; reason: "malformed" | "expired" | "signature" };

/**
 * Check a token from a claim link against one listing. Accepts a v2 token that is correctly signed and
 * still in date, or a legacy static token. Comparison is length-safe and constant time.
 */
export function verifyClaimToken(catalogId: string, token: string): ClaimCheck {
  const t = (token || "").trim();
  if (!t || t.length > 200) return { ok: false, reason: "malformed" };

  if (t.startsWith(V2)) {
    const [, expPart, sig] = t.split(".");
    if (!expPart || !sig) return { ok: false, reason: "malformed" };
    const exp = parseInt(expPart, 36);
    if (!Number.isFinite(exp)) return { ok: false, reason: "malformed" };
    // Check the signature before the clock, so an expired link cannot be told apart from a forged one
    // by timing alone, and so a tampered expiry is rejected as a bad signature rather than a stale link.
    const want = Buffer.from(v2Signature(catalogId, exp));
    const got = Buffer.from(sig);
    if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, reason: "signature" };
    if (exp < Date.now()) return { ok: false, reason: "expired" };
    return { ok: true, kind: "v2", exp };
  }

  const want = Buffer.from(claimToken(catalogId));
  const got = Buffer.from(t);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, reason: "signature" };
  return { ok: true, kind: "legacy" };
}
