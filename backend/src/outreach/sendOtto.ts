import { db, nowIso } from "../db/client.ts";
import { sendMail } from "../lib/mail.ts";
import { draftOttoCopy, type OttoOp } from "./ottoDrafts.ts";
import { catalogId } from "./drafts.ts";
import { recordSend } from "../lib/outreachLog.ts";
import { emailHash, loadSuppression, mailPostal, unsubPageUrl } from "../lib/unsub.ts";
import { outreachBlockers } from "./guards.ts";
import { isDeliverable } from "./deliverable.ts";

/**
 * Sends the drafted Otto (AI phone line) pitch. Mirrors send.ts's sendOutreach exactly, scoped to
 * kind = 'otto' so it runs alongside the listing campaign without either one starving or suppressing the
 * other. Both campaigns go out through the same Gmail identity (mail.ts), so the two ramp scripts
 * (outreach-ramp.mts, otto-ramp.mts) each check how much that account has already sent today, across BOTH
 * campaigns, before adding their own volume: the failure mode that matters is not "one campaign looks spammy
 * to a recipient", it is the one shared sending account getting rate-limited or suspended by Gmail.
 */
export async function sendOttoOutreach(opts: {
  limit: number;
  dry: boolean;
  to?: string;
}): Promise<{ sent: number; skipped: number; failed: number }> {
  const out = { sent: 0, skipped: 0, failed: 0 };
  const suppression = await loadSuppression();
  const blocked = suppression.hashes;
  const blockers = outreachBlockers({
    claimSecret: process.env.CLAIM_SECRET || "",
    mailFrom: process.env.MAIL_FROM || "",
    postal: mailPostal(),
    unsubUrl: unsubPageUrl("owner@example.com"),
    suppression,
  });
  for (const b of blockers) console.error("otto outreach: " + b);
  if (opts.to) {
    if (blocked.has(emailHash(opts.to.trim().toLowerCase()))) {
      console.error("sample not sent: " + opts.to + " is on the unsubscribe list");
      return out;
    }
    const op = db
      .prepare(
        `SELECT * FROM operators
         WHERE origin NOT IN ('demo', 'test') AND claim_status = 'unclaimed' AND email LIKE '%@%'
           AND family = 'water' AND phone IS NOT NULL AND phone != ''
           AND lower(name) NOT LIKE '%park%' AND lower(name) NOT LIKE '%county%' AND lower(name) NOT LIKE '%city of%'
           AND lower(name) NOT LIKE '%recreation%' AND lower(name) NOT LIKE '%district%' AND lower(name) NOT LIKE '%municipal%'
           AND domain NOT LIKE '%.gov' AND domain NOT LIKE '%.org' AND domain NOT LIKE '%.edu'
         ORDER BY completeness DESC LIMIT 1`,
      )
      .get() as OttoOp | undefined;
    if (!op) return out;
    const copy = draftOttoCopy(op, opts.to);
    const r = await sendMail({
      to: opts.to,
      subject: copy.subject,
      text: copy.body,
      html: copy.html,
      replyTo: process.env.MAIL_REPLY_TO || undefined,
      commercial: true,
    });
    console.log(r.sent ? "sample sent " + r.id : "sample not sent: " + r.error);
    return out;
  }
  if (!opts.dry && blockers.length) return out;
  const sql = `SELECT d.id, d.to_email, o.id AS opid, o.domain, o.name, o.email, o.phone, o.city, o.region, o.calendar_vendor
       FROM outreach_drafts d JOIN operators o ON o.id = d.operator_id
       WHERE d.status = 'draft' AND d.kind = 'otto' AND d.to_email IS NOT NULL AND d.to_email LIKE '%@%' AND o.claim_status = 'unclaimed'
         AND NOT EXISTS (SELECT 1 FROM outreach_drafts s WHERE s.to_email = d.to_email AND s.status = 'sent' AND s.kind = 'otto')
       ORDER BY o.completeness DESC NULLS LAST LIMIT ?`;
  const rows = db.prepare(sql).all(opts.limit) as (OttoOp & { id: string; opid: string; to_email: string })[];
  const seen = new Set<string>();
  for (const r of rows) {
    const to = r.to_email.trim().toLowerCase();
    if (seen.has(to) || /noreply|no-reply|donotreply|example\.com|sentry|wixpress|godaddy/.test(to) || blocked.has(emailHash(to))) {
      if (blocked.has(emailHash(to))) db.prepare("UPDATE outreach_drafts SET status = 'unsubscribed' WHERE id = ?").run(r.id);
      out.skipped++;
      continue;
    }
    seen.add(to);
    // A domain that takes no mail is left out of the batch rather than sent to and bounced: see deliverable.ts.
    if (!(await isDeliverable(to))) {
      db.prepare("UPDATE outreach_drafts SET status = 'failed' WHERE id = ?").run(r.id);
      out.skipped++;
      console.log("skipped " + to + ": domain takes no mail");
      continue;
    }
    const op: OttoOp = { id: r.opid, domain: r.domain, name: r.name, email: r.email, phone: r.phone, city: r.city, region: r.region, calendar_vendor: r.calendar_vendor };
    const copy = draftOttoCopy(op, to);
    if (opts.dry) {
      console.log("would send to " + to + ": " + copy.subject);
      out.sent++;
      continue;
    }
    const res = await sendMail({ to, subject: copy.subject, text: copy.body, html: copy.html, replyTo: process.env.MAIL_REPLY_TO || undefined, commercial: true });
    if (res.sent) {
      const at = nowIso();
      db.prepare("UPDATE outreach_drafts SET status = 'sent', subject = ?, body = ?, created_at = ? WHERE id = ?").run(copy.subject, copy.body, at, r.id);
      await recordSend({ email: to, listing: catalogId(r.domain), at });
      out.sent++;
    } else {
      db.prepare("UPDATE outreach_drafts SET status = 'failed' WHERE id = ?").run(r.id);
      out.failed++;
      console.error(to + ": " + res.error);
      if (/no mail key/.test(res.error || "")) break;
    }
    // Same pacing as the listing send: 90 to 300 seconds, randomized, one real mailbox sending like a person.
    await new Promise((x) => setTimeout(x, 90_000 + Math.random() * 210_000));
  }
  return out;
}

/**
 * The instant the campaign's day began, as the UTC ISO string `created_at` is stored in. The day is the
 * campaign's own (PIPELINE_TZ, Toronto by default), not UTC: counted by UTC the day rolled over at 8 PM
 * Toronto time, so an evening run saw a fresh ceiling and could add a whole second batch to a day that had
 * already had one.
 */
export function dayStartIso(tz = process.env.PIPELINE_TZ || "America/Toronto", now = new Date()): string {
  const wall = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  const midnight = new Date(wall);
  midnight.setHours(0, 0, 0, 0);
  return new Date(midnight.getTime() + (now.getTime() - wall.getTime())).toISOString();
}

/** How many commercial emails (either campaign) this Gmail identity has already sent today, on the campaign's
 * own clock. Both ramp scripts read this before adding their own volume, so the combined total from one
 * mailbox stays under the safe ceiling even though the two campaigns run independently. */
export function sentToday(): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM outreach_drafts WHERE status = 'sent' AND created_at >= ?")
    .get(dayStartIso()) as { n: number };
  return row.n;
}
