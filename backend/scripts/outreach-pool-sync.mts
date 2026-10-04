import "../src/env.ts";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { db } from "../src/db/client.ts";
import { query, withTx } from "../src/db/pg.ts";
import { bestAddress, ownerFacts } from "../src/outreach/owner.ts";
import { ownerFirstName } from "../src/outreach/address.ts";
import { catalogId } from "../src/outreach/drafts.ts";
import { smtpIdentities } from "../src/lib/mail.ts";
import { ensureTouchTables, loadRamp, poolUpsertSql, recordTouch, saveRamp } from "../src/outreach/touches.ts";

/**
 * Publishes what the cloud sender needs from this laptop's catalog into Postgres (src/outreach/touches.ts):
 *
 *   1. outreach_pool: every Otto candidate, with the address the pitch should go to (the owner's own mailbox
 *      when the site names one, else the front desk, owner.ts) and the first name to open with. The same
 *      eligibility as the laptop's draft queue. Businesses that stopped qualifying are removed. A business
 *      the owners lookup (scripts/owners-pool.mts, on Render) found the owner for keeps that mailbox and name.
 *   2. outreach_sends: this disk's history (sent, failed, handoff, replied) so the cloud never mails a
 *      business the laptop or a friend already has. Idempotent.
 *   3. outreach_ramp: the warm-up state, seeded from data/outreach-otto-ramp.json the first time (or with
 *      --ramp, to overwrite), so each mailbox continues at its rung in the cloud instead of starting over.
 *
 *   npx tsx scripts/outreach-pool-sync.mts
 *   npx tsx scripts/outreach-pool-sync.mts --ramp
 *
 * outreach-daily.sh runs this every morning in place of the send once the cloud run owns sending: the laptop
 * stays the catalog and the owner-lookup engine, the cloud does the mailing, and a laptop that is asleep
 * only means the pool is a day older, not that nothing went out.
 */
const force = process.argv.includes("--ramp");
const started = new Date().toISOString();
await ensureTouchTables();

type Op = { id: string; domain: string; name: string; website: string | null; email: string | null; phone: string | null; city: string | null; region: string | null; calendar_vendor: string | null; completeness: number | null; family: string | null };
// Every family that takes bookings (Harshil, 3 October 2026: "anything booking related"). Opened past water on
// 30 September for a real reply-rate comparison across verticals.
const ops = db
  .prepare(
    `SELECT id, domain, name, website, email, phone, city, region, calendar_vendor, completeness, family FROM operators
      WHERE origin NOT IN ('demo', 'test') AND claim_status = 'unclaimed' AND email LIKE '%@%'
        AND phone IS NOT NULL AND phone != ''
        AND lower(name) NOT LIKE '%park%' AND lower(name) NOT LIKE '%county%' AND lower(name) NOT LIKE '%city of%'
        AND lower(name) NOT LIKE '%recreation%' AND lower(name) NOT LIKE '%district%' AND lower(name) NOT LIKE '%municipal%'
        AND domain NOT LIKE '%.gov' AND domain NOT LIKE '%.org' AND domain NOT LIKE '%.edu'`,
  )
  .all() as Op[];

type Row = [string, string, string, string, string | null, string, string | null, string | null, string | null, string | null, number | null, string | null, string | null];
const rows: Row[] = [];
for (const op of ops) {
  const to = bestAddress(op);
  if (!to) continue;
  const greet = ownerFirstName(to, ownerFacts(op.id).names);
  rows.push([op.id, catalogId(op.domain), op.domain, op.name, op.website, to, op.phone, op.city, op.region, op.calendar_vendor, op.completeness, greet, op.family]);
}

// A row the owners lookup (scripts/owners-pool.mts) found the owner for keeps that mailbox and greeting:
// poolUpsertSql leaves email, greet, desk_email and owner_source alone there and refreshes everything else.
await withTx(async (c) => {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await c.query(poolUpsertSql(chunk.length), chunk.flat());
  }
  await c.query("delete from outreach_pool where synced_at < $1::timestamptz", [started]);
});
const named = rows.filter((r) => r[11]).length;
const [kept] = await query<{ n: number }>("select count(*)::int as n from outreach_pool where owners_checked_at is not null and owner_source is not null");
console.log(`pool: ${rows.length} candidates published (${named} with an owner's first name), stale rows removed; ${kept?.n ?? 0} keep the owner the owners lookup found`);

// This disk's history, so the cloud never repeats it.
const first = smtpIdentities()[0]?.user || null;
const history = db
  .prepare("SELECT operator_id, lower(to_email) AS email, status, sent_via, created_at FROM outreach_drafts WHERE kind = 'otto' AND status IN ('sent', 'failed', 'handoff', 'replied') AND to_email LIKE '%@%'")
  .all() as { operator_id: string; email: string; status: "sent" | "failed" | "handoff" | "replied"; sent_via: string | null; created_at: string }[];
for (const h of history) await recordTouch({ operatorId: h.operator_id, email: h.email, status: h.status, mailbox: h.status === "sent" ? h.sent_via || first : null, at: h.created_at });
const counts = (await query<{ status: string; n: number }>("select status, count(*)::int as n from outreach_sends where kind = 'otto' group by 1 order by 1")).map((r) => r.status + " " + r.n).join(", ");
console.log(`history: ${history.length} local rows shared; shared record now holds ${counts}`);

// The warm-up state, once.
const statePath = join(dirname(process.env.OUTSET_DB_PATH || join(process.cwd(), "data", "outset.db")), "outreach-otto-ramp.json");
const have = await loadRamp("otto");
if ((force || !have) && existsSync(statePath)) {
  await saveRamp("otto", JSON.parse(readFileSync(statePath, "utf8")));
  console.log(`ramp: state seeded from ${statePath}`);
} else {
  console.log(have ? "ramp: cloud state already present, left as is (use --ramp to overwrite)" : "ramp: no local state file, cloud will start fresh");
}
process.exit(0);
