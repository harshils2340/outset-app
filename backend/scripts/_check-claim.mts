import "../src/env.ts";
import { query } from "../src/db/pg.ts";

/**
 * Read-only: what the production claim record for a listing actually holds. For checking a claim looks
 * right, or diagnosing one that doesn't, without needing OUTSET_TEST_CLAIM_EMAILS set on this host.
 *
 *   npx tsx scripts/_check-claim.mts o-cajunencounters-com
 */
const id = process.argv[2];
if (!id) {
  console.error("Usage: npx tsx scripts/_check-claim.mts <catalog-id>");
  process.exit(1);
}
const rows = await query("select id, owner_email, updated_at, doc from profiles where id = $1", [id]);
console.log("profiles:", JSON.stringify(rows, null, 2));
const emails = await query("select email_hash, listing, linked_at from profile_emails where listing = $1", [id]);
console.log("profile_emails:", JSON.stringify(emails, null, 2));
process.exit(0);
