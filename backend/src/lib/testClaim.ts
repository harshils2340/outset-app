/**
 * TEST CLAIM BYPASS. Off by default. Testing only. Never enable this on the production API.
 *
 * The real rule is in claimIndex.ts: a listing may only be claimed from the email published on that
 * business's own website, or from an address at a domain the business owns. That rule is a product
 * promise and this file does not touch it.
 *
 * When (and only when) OUTSET_TEST_CLAIM_EMAILS is set, the addresses it names may:
 *   1. receive a claim link for ANY listing, skipping the website-email check, and
 *   2. release a listing again through POST /claims/:id/test-unclaim, so the flow can be re-run.
 *
 * With the variable unset or empty every function here returns false or an empty list, so the
 * request route takes exactly the same branch it took before this file existed.
 *
 * Set it like this, locally, in backend/.env or the shell:
 *   OUTSET_TEST_CLAIM_EMAILS=malharshah200428@gmail.com,harshils2340@gmail.com
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The addresses the bypass is switched on for. Empty when the variable is unset: the bypass is then off. */
export function testClaimEmails(): string[] {
  return (process.env.OUTSET_TEST_CLAIM_EMAILS || "")
    .split(/[,\s;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => EMAIL.test(s));
}

/** True when someone has deliberately switched the bypass on for at least one address. */
export function testClaimActive(): boolean {
  return testClaimEmails().length > 0;
}

/** True when this exact address is on the allowlist. False whenever the variable is unset. */
export function testClaimAllows(email: string): boolean {
  const em = (email || "").trim().toLowerCase();
  if (!EMAIL.test(em)) return false;
  return testClaimEmails().includes(em);
}

/** Loud on purpose. Every bypassed claim and unclaim leaves a line in the server log. */
export function logTestClaim(action: "claim" | "unclaim", email: string, id: string, ip: string): void {
  console.warn(`TEST CLAIM BYPASS: ${email} ${action === "claim" ? "claiming" : "unclaiming"} ${id} from ${ip} (OUTSET_TEST_CLAIM_EMAILS is set)`);
}
