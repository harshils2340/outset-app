import "../src/env.ts";
import { query } from "../src/db/pg.ts";

/**
 * Break-glass: put a listing back to genuinely unclaimed, for when a claim got recorded that should not
 * have been (an accidental test load, a wrong link). Mirrors what /claims/:id/test-unclaim does, without
 * needing OUTSET_TEST_CLAIM_EMAILS set on this host.
 *
 *   npx tsx scripts/_release-claim.mts o-cajunencounters-com
 */
const id = process.argv[2];
if (!id) {
  console.error("Usage: npx tsx scripts/_release-claim.mts <catalog-id>");
  process.exit(1);
}
const profiles = await query("delete from profiles where id = $1 returning id", [id]);
const emails = await query("delete from profile_emails where listing = $1 returning email_hash", [id]);
console.log("deleted profiles:", profiles.length, "deleted profile_emails:", emails.length);
process.exit(0);
