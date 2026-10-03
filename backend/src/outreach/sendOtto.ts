import { db, nowIso } from "../db/client.ts";
import { sendMail, smtpIdentities } from "../lib/mail.ts";
import { draftOttoCopy, type OttoOp } from "./ottoDrafts.ts";
import { catalogId } from "./drafts.ts";
import { recordSend } from "../lib/outreachLog.ts";
import { emailHash, loadSuppression, mailPostal, unsubPageUrl } from "../lib/unsub.ts";
import { outreachBlockers, skipMark, UNREADABLE_ADDRESS, type SkipReason } from "./guards.ts";
import { isDeliverable } from "./deliverable.ts";
import { cooloffStart, noRecentSendSql } from "./spacing.ts";
import { recordTouch, touched } from "./touches.ts";
import { MAILBOX_ERROR, NETWORK_ERROR, dayStartIso, pickIdentity } from "./mailboxes.ts";

export { MAILBOX_ERROR, NETWORK_ERROR, dayStartIso, pickIdentity } from "./mailboxes.ts";

/**
 * Sends the drafted Otto (AI phone line) pitch. Mirrors send.ts's sendOutreach exactly, scoped to
 * kind = 'otto' so it runs alongside the listing campaign without either one starving or suppressing the
 * other. Both campaigns go out through the same Gmail identity (mail.ts), so the two ramp scripts
 * (outreach-ramp.mts, otto-ramp.mts) each check how much that account has already sent today, across BOTH
 * campaigns, before adding their own volume: the failure mode that matters is not "one campaign looks spammy
 * to a recipient", it is the one shared sending account getting rate-limited or suspended by Gmail.
 */
// Which mailbox a row went from, so each mailbox's daily count and warm-up are its own. Ensured here rather
// than only in migrate(), which the ramp scripts never call.
try {
  db.exec("ALTER TABLE outreach_drafts ADD COLUMN sent_via TEXT");
} catch {
  /* already there */
}

export async function sendOttoOutreach(opts: {
  limit: number;
  dry: boolean;
  to?: string;
  /** Sends allowed today per sending mailbox (address -> count), from otto-ramp.mts. Unset: the first mailbox alone, up to `limit`. */
  quota?: Record<string, number>;
}): Promise<{ sent: number; skipped: number; failed: number; retired: { mailbox: string; error: string }[] }> {
  const out = { sent: 0, skipped: 0, failed: 0, retired: [] as { mailbox: string; error: string }[] };
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
           AND phone IS NOT NULL AND phone != '' AND coalesce(family, '') != 'wellness'
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
  const rows = ottoQueue(opts.limit);
  // What every other sender has already done (touches.ts): a business the cloud run mailed this morning, or a
  // friend was handed, is not in this disk's table, so it is asked for here and marked as handed off locally.
  const elsewhere = await touched().catch((e) => {
    console.error("shared outreach record unavailable, relying on this disk alone: " + (e as Error).message);
    return { operators: new Set<string>(), emails: new Set<string>() };
  });
  const seen = new Set<string>();
  for (const r of rows) {
    const to = r.to_email.trim().toLowerCase();
    if (elsewhere.operators.has(r.opid) || elsewhere.emails.has(to)) {
      if (!opts.dry) db.prepare("UPDATE outreach_drafts SET status = 'handoff' WHERE id = ?").run(r.id);
      out.skipped++;
      continue;
    }
    // Same rule as the listing send, from the same place: a dry run leaves the queue as it found it.
    const mark = (reason: SkipReason) => {
      const status = skipMark(reason, opts.dry);
      if (status) db.prepare("UPDATE outreach_drafts SET status = ? WHERE id = ?").run(status, r.id);
      out.skipped++;
    };
    if (seen.has(to) || UNREADABLE_ADDRESS.test(to) || blocked.has(emailHash(to))) {
      mark(blocked.has(emailHash(to)) ? "unsubscribed" : seen.has(to) ? "in-batch" : "unreadable");
      continue;
    }
    seen.add(to);
    // A domain that takes no mail is left out of the batch rather than sent to and bounced: see deliverable.ts.
    if (!(await isDeliverable(to))) {
      mark("undeliverable");
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
    let via: string | undefined;
    if (opts.quota) {
      via = pickIdentity(opts.quota) ?? undefined;
      if (!via) {
        console.log("every mailbox has used its allowance for today");
        break;
      }
    }
    let res = await sendMail({ to, subject: copy.subject, text: copy.body, html: copy.html, replyTo: process.env.MAIL_REPLY_TO || undefined, commercial: true, via });
    for (let tries = 1; !res.sent && NETWORK_ERROR.test(res.error || "") && tries <= 3; tries++) {
      console.error((via || "mailbox") + ": network error, waiting 60 seconds and trying again (" + tries + " of 3): " + res.error);
      await new Promise((x) => setTimeout(x, 60_000));
      res = await sendMail({ to, subject: copy.subject, text: copy.body, html: copy.html, replyTo: process.env.MAIL_REPLY_TO || undefined, commercial: true, via });
    }
    if (res.sent) {
      const at = nowIso();
      db.prepare("UPDATE outreach_drafts SET status = 'sent', subject = ?, body = ?, created_at = ?, sent_via = ? WHERE id = ?").run(copy.subject, copy.body, at, res.via ?? via ?? smtpIdentities()[0]?.user ?? null, r.id);
      await recordSend({ email: to, listing: catalogId(r.domain), at });
      await recordTouch({ operatorId: r.opid, email: to, status: "sent", mailbox: res.via ?? via ?? smtpIdentities()[0]?.user ?? null, variant: copy.variant, at }).catch((e) => console.error("shared record: " + (e as Error).message));
      out.sent++;
      if (opts.quota && via) opts.quota[via] -= 1;
    } else if (opts.quota && via && MAILBOX_ERROR.test(res.error || "")) {
      // The mailbox failed, not the address: retire it for this run and leave the draft for the next mailbox.
      console.error(via + " retired for this run: " + res.error);
      opts.quota[via] = 0;
      out.retired.push({ mailbox: via, error: res.error || "" });
      continue;
    } else {
      db.prepare("UPDATE outreach_drafts SET status = 'failed' WHERE id = ?").run(r.id);
      await recordTouch({ operatorId: r.opid, email: to, status: "failed" }).catch(() => undefined);
      out.failed++;
      console.error(to + ": " + res.error);
      if (/no mail key/.test(res.error || "")) break;
    }
    // Same pacing as the listing send: 90 to 300 seconds between one mailbox's sends, randomized, so each
    // mailbox sends like a person. With several mailboxes taking turns the gap is shared between them, so each
    // still waits its full turn while the batch as a whole finishes in the day (150 mails at a full gap each
    // would run eight hours; three mailboxes interleaved, under three).
    const active = opts.quota ? Object.values(opts.quota).filter((n) => n > 0).length || 1 : 1;
    await new Promise((x) => setTimeout(x, (90_000 + Math.random() * 210_000) / active));
  }
  return out;
}


/** How many commercial emails (either campaign) this Gmail identity has already sent today, on the campaign's
 * own clock. Both ramp scripts read this before adding their own volume, so the combined total from one
 * mailbox stays under the safe ceiling even though the two campaigns run independently. */
export function sentToday(via?: string, firstMailbox?: string): number {
  if (!via) {
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM outreach_drafts WHERE status = 'sent' AND created_at >= ?")
      .get(dayStartIso()) as { n: number };
    return row.n;
  }
  // Rows sent before the mailbox was recorded carry no sent_via; they all went from the first mailbox.
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM outreach_drafts WHERE status = 'sent' AND created_at >= ? AND (sent_via = ? OR (sent_via IS NULL AND ?))")
    .get(dayStartIso(), via, via === firstMailbox ? 1 : 0) as { n: number };
  return row.n;
}

/**
 * The next `limit` Otto drafts in send order: the shared definition of "who gets this next", used by the
 * ramp's send loop above and by scripts/outreach-handoff.mts, so a hand-sent slice and the daily send never
 * disagree about who is in the queue. Already-sent and handed-off addresses are excluded here, not later.
 */
export function ottoQueue(limit: number): (OttoOp & { id: string; opid: string; to_email: string; website: string | null })[] {
  const sql = `SELECT d.id, d.to_email, o.id AS opid, o.domain, o.website, o.name, o.email, o.phone, o.city, o.region, o.calendar_vendor
       FROM outreach_drafts d JOIN operators o ON o.id = d.operator_id
       WHERE d.status = 'draft' AND d.kind = 'otto' AND d.to_email IS NOT NULL AND d.to_email LIKE '%@%' AND o.claim_status = 'unclaimed'
         -- This campaign's own sends bar the address for good; the listing pitch's bar it for a week. See
         -- spacing.ts: both campaigns go out from one personal Gmail and 2,038 operators are eligible for both.
         AND ${noRecentSendSql("otto")}
         -- 'handoff' (scripts/outreach-handoff.mts): exported for someone else to mail by hand, any kind, so
         -- neither campaign mails that address from here and the two pitches never land in the same week.
         AND NOT EXISTS (SELECT 1 FROM outreach_drafts h WHERE (h.to_email = d.to_email OR h.operator_id = d.operator_id) AND h.status IN ('handoff', 'replied'))
       ORDER BY o.completeness DESC NULLS LAST LIMIT ?`;
  // The cool-off start is the first bound parameter, in the order the clauses appear in the statement.
  return db.prepare(sql).all(cooloffStart(), limit) as (OttoOp & { id: string; opid: string; to_email: string; website: string | null })[];
}
