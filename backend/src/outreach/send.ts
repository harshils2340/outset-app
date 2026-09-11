import { db, nowIso } from "../db/client.ts";
import { sendMail } from "../lib/mail.ts";
import { emailHash, loadUnsubHashes, mailPostal, withOutreachFooter } from "../lib/unsub.ts";

/**
 * Sends the drafted claim emails. Caps per run, never sends twice to one address, skips anyone who
 * unsubscribed, and marks every row so a rerun continues where it stopped.
 * --dry prints instead of sending; --to sends one sample to an address.
 */
export async function sendOutreach(opts: {
  limit: number;
  dry: boolean;
  to?: string;
  metro?: string;
  country?: string;
}): Promise<{ sent: number; skipped: number; failed: number }> {
  const out = { sent: 0, skipped: 0, failed: 0 };
  const blocked = await loadUnsubHashes();
  if (opts.to) {
    const row = db
      .prepare("SELECT d.subject, d.body FROM outreach_drafts d JOIN operators o ON o.id = d.operator_id WHERE d.to_email IS NOT NULL ORDER BY o.review_count DESC LIMIT 1")
      .get() as { subject: string; body: string } | undefined;
    if (!row) return out;
    const text = withOutreachFooter(row.body, opts.to);
    const r = await sendMail({ to: opts.to, subject: "[sample] " + row.subject, text, replyTo: process.env.MAIL_REPLY_TO || undefined, commercial: true });
    console.log(r.sent ? "sample sent " + r.id : "sample not sent: " + r.error);
    return out;
  }
  if (!opts.dry && !mailPostal()) {
    console.error("Set MAIL_POSTAL to a real street address (CAN-SPAM / CASL) before sending to businesses.");
    return out;
  }
  const fromOk = /@onoutset\.com>/i.test(process.env.MAIL_FROM || "") || /@onoutset\.com$/i.test(process.env.MAIL_FROM || "");
  if (!opts.dry && !fromOk) {
    console.error("MAIL_FROM is still the Resend test address. Verify onoutset.com in Resend, then set MAIL_FROM to Outset <hello@onoutset.com>. Sends to businesses will 403 until you do.");
    return out;
  }
  let sql = `SELECT d.id, d.to_email, d.subject, d.body FROM outreach_drafts d JOIN operators o ON o.id = d.operator_id
       WHERE d.status = 'draft' AND d.to_email IS NOT NULL AND d.to_email LIKE '%@%' AND o.claim_status = 'unclaimed'
         AND NOT EXISTS (SELECT 1 FROM outreach_drafts s WHERE s.to_email = d.to_email AND s.status = 'sent')`;
  const args: (string | number)[] = [];
  if (opts.metro) {
    sql += " AND o.metro_id = ?";
    args.push(opts.metro);
  }
  if (opts.country) {
    sql += " AND o.country = ?";
    args.push(opts.country);
  }
  sql += " ORDER BY o.review_count DESC NULLS LAST LIMIT ?";
  args.push(opts.limit);
  const rows = db.prepare(sql).all(...args) as { id: string; to_email: string; subject: string; body: string }[];
  const seen = new Set<string>();
  for (const r of rows) {
    const to = r.to_email.trim().toLowerCase();
    if (seen.has(to) || /noreply|no-reply|donotreply|example\.com|sentry|wixpress|godaddy/.test(to) || blocked.has(emailHash(to))) {
      if (blocked.has(emailHash(to))) db.prepare("UPDATE outreach_drafts SET status = 'unsubscribed' WHERE id = ?").run(r.id);
      out.skipped++;
      continue;
    }
    seen.add(to);
    const text = withOutreachFooter(r.body, to);
    if (opts.dry) {
      console.log("would send to " + to + ": " + r.subject);
      out.sent++;
      continue;
    }
    const res = await sendMail({ to, subject: r.subject, text, replyTo: process.env.MAIL_REPLY_TO || undefined, commercial: true });
    if (res.sent) {
      db.prepare("UPDATE outreach_drafts SET status = 'sent', created_at = ? WHERE id = ?").run(nowIso(), r.id);
      out.sent++;
    } else {
      db.prepare("UPDATE outreach_drafts SET status = 'failed' WHERE id = ?").run(r.id);
      out.failed++;
      console.error(to + ": " + res.error);
      if (/no mail key/.test(res.error || "")) break;
    }
    await new Promise((x) => setTimeout(x, 600));
  }
  return out;
}
