import { db, nowIso } from "../db/client.ts";
import { sendMail } from "../lib/mail.ts";
import { composeOutreach } from "./drafts.ts";
import { emailHash, loadUnsubHashes, mailPostal } from "../lib/unsub.ts";

type OpRow = {
  id: string;
  domain: string;
  name: string;
  email: string | null;
  city: string | null;
  region: string | null;
  metro_id: string | null;
  website: string | null;
  completeness: number;
  origin: string;
  calendar_vendor: string | null;
};

/**
 * Sends the drafted claim emails. Caps per run, never sends twice to one address, skips anyone who
 * unsubscribed, and writes the body at send time so old drafts cannot go out.
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
    const op = db
      .prepare(
        `SELECT o.* FROM operators o
         LEFT JOIN outreach_drafts d ON d.operator_id = o.id
         WHERE o.origin != 'demo' AND o.email LIKE '%@%'
         ORDER BY CASE WHEN o.domain LIKE '%cajun%' THEN 0 ELSE 1 END, o.review_count DESC NULLS LAST
         LIMIT 1`,
      )
      .get() as OpRow | undefined;
    if (!op) return out;
    const copy = composeOutreach(op, opts.to);
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
  if (!opts.dry && !mailPostal()) {
    console.error("Set MAIL_POSTAL to a PO box or mailbox (not a made-up street) before sending to businesses.");
    return out;
  }
  const fromOk = /@onoutset\.com>/i.test(process.env.MAIL_FROM || "") || /@onoutset\.com$/i.test(process.env.MAIL_FROM || "");
  if (!opts.dry && !fromOk) {
    console.error("MAIL_FROM is still the Resend test address. Set MAIL_FROM to Harshil <hello@onoutset.com>.");
    return out;
  }
  let sql = `SELECT d.id, d.to_email, o.domain, o.name, o.email, o.city, o.region, o.metro_id, o.website, o.completeness, o.origin, o.calendar_vendor
       FROM outreach_drafts d JOIN operators o ON o.id = d.operator_id
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
  const rows = db.prepare(sql).all(...args) as (OpRow & { id: string; to_email: string })[];
  const seen = new Set<string>();
  for (const r of rows) {
    const to = r.to_email.trim().toLowerCase();
    if (seen.has(to) || /noreply|no-reply|donotreply|example\.com|sentry|wixpress|godaddy/.test(to) || blocked.has(emailHash(to))) {
      if (blocked.has(emailHash(to))) db.prepare("UPDATE outreach_drafts SET status = 'unsubscribed' WHERE id = ?").run(r.id);
      out.skipped++;
      continue;
    }
    seen.add(to);
    const copy = composeOutreach(r, to);
    if (opts.dry) {
      console.log("would send to " + to + ": " + copy.subject);
      out.sent++;
      continue;
    }
    const res = await sendMail({ to, subject: copy.subject, text: copy.body, html: copy.html, replyTo: process.env.MAIL_REPLY_TO || undefined, commercial: true });
    if (res.sent) {
      db.prepare("UPDATE outreach_drafts SET status = 'sent', subject = ?, body = ?, created_at = ? WHERE id = ?").run(copy.subject, copy.body, nowIso(), r.id);
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
