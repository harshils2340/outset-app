import "../src/env.ts";
import { db, nowIso } from "../src/db/client.ts";
import { collectBounces, suppressBounce } from "../src/outreach/bounceSweep.ts";

/**
 * The bounce sweep, from the laptop: every sending mailbox is read over IMAP (src/outreach/bounceSweep.ts),
 * each dead address is suppressed everywhere, and this disk's own draft for it is marked failed.
 *
 *   npx tsx scripts/bounces.mts            # the last 7 days
 *   npx tsx scripts/bounces.mts --days=30
 *   npx tsx scripts/bounces.mts --dry      # list, change nothing
 *
 * outreach-daily.sh runs this before the ramp, so yesterday's bounces are out of the queue before today's
 * batch. The cloud run (scripts/otto-cloud.mts) does the same sweep against the shared record.
 */
const arg = (k: string) => process.argv.find((a) => a.startsWith("--" + k + "="))?.split("=").slice(1).join("=");
const days = Number(arg("days") || 7);
const dry = process.argv.includes("--dry");

const bounces = await collectBounces(days);
const known = db.prepare("SELECT id, operator_id, status FROM outreach_drafts WHERE lower(to_email) = ?");
const fail = db.prepare("UPDATE outreach_drafts SET status = 'failed', created_at = ? WHERE id = ?");
let marked = 0;
for (const b of bounces) {
  const rows = known.all(b.email) as { id: string; operator_id: string; status: string }[];
  console.log(`${b.email}  (${rows.length ? rows.map((r) => r.status).join(",") : "not in the queue"})  via ${b.mailbox}: ${b.reason}`);
  if (dry) continue;
  await suppressBounce(b, [...new Set(rows.map((r) => r.operator_id))]);
  for (const r of rows) if (r.status !== "failed") fail.run(nowIso(), r.id);
  marked++;
}
console.log(dry ? `dry run: ${bounces.length} bounced address(es) found, nothing changed` : `bounces: ${marked} address(es) suppressed and marked failed`);
process.exit(0);
