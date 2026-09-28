import { db } from "../db/client.ts";
import { outreachAddress, ownerFirstName } from "./address.ts";

/**
 * The person behind the front desk. The owners crawl (src/enrich/owners.ts) keeps what an operator's own
 * About and Contact pages say about who runs the place, as facts: owner_email (a mailbox that looks like a
 * person, mike@ or mike.smith@ at their domain, or a personal gmail) and owner_name ("Jeff Rogers (owner)").
 * Harshil, 25 September 2026: write to the owner or the manager, the person who decides whether this is
 * relevant, not to booking@ or info@ whenever the site gives us a better door. So the draft picks its address
 * from every mailbox the crawl found, ranked by address.ts, and opens with the owner's first name when the
 * mailbox is theirs. The front desk stays the fallback; nothing here invents a person or an address.
 */

// Prepared on first use, not at import: a test that imports the send path against a fresh in-memory database
// has no facts table yet, and preparing here would kill the whole file before its first test ran.
let factsStmt: ReturnType<typeof db.prepare> | null = null;

export function ownerFacts(operatorId: string): { emails: string[]; names: string[] } {
  factsStmt ??= db.prepare("SELECT fact_key, fact_value FROM facts WHERE operator_id = ? AND fact_key IN ('owner_email', 'owner_name')");
  const rows = factsStmt.all(operatorId) as { fact_key: string; fact_value: string }[];
  const emails: string[] = [];
  const names: string[] = [];
  for (const r of rows) {
    const v = (r.fact_value || "").trim();
    if (!v) continue;
    if (r.fact_key === "owner_email") emails.push(v);
    else names.push(v);
  }
  return { emails, names };
}

/** The address a pitch to this operator goes to: the owner's own mailbox when the site named one, else the front desk. */
export function bestAddress(op: { id: string; email: string | null; domain: string }): string | null {
  return outreachAddress(op, ownerFacts(op.id).emails);
}

/** "Hi Ron," when the mailbox is Ron's, by the site's own word; "Hi," otherwise. Never a guessed name. */
export function greeting(op: { id: string }, to: string): string {
  const first = ownerFirstName(to, ownerFacts(op.id).names);
  return first ? "Hi " + first + "," : "Hi,";
}
