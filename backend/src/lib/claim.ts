import { createHash, createHmac, randomBytes } from "node:crypto";
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
