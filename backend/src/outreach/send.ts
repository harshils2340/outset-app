import { db, nowIso } from "../db/client.ts";
import { sendMail } from "../lib/mail.ts";
import { catalogId, composeOutreach } from "./drafts.ts";
import { recordSend } from "../lib/outreachLog.ts";
import { emailHash, loadSuppression, mailPostal, unsubPageUrl } from "../lib/unsub.ts";
import { outreachBlockers } from "./guards.ts";

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
  const suppression = await loadSuppression();
  const blocked = suppression.hashes;
  // Printed before the sample send too, because a sample to yourself is where these are meant to be caught.
  const blockers = outreachBlockers({
    claimSecret: process.env.CLAIM_SECRET || "",
    mailFrom: process.env.MAIL_FROM || "",
    postal: mailPostal(),
    unsubUrl: unsubPageUrl("owner@example.com"),
    suppression,
  });
  for (const b of blockers) console.error("outreach: " + b);
  if (opts.to) {
    // A sample is still a commercial email landing in somebody's inbox, so the list covers it too.
    if (blocked.has(emailHash(opts.to.trim().toLowerCase()))) {
      console.error("sample not sent: " + opts.to + " is on the unsubscribe list");
      return out;
    }
    // Same eligibility and ordering as the real batch below, so a --to= sample shows the email an owner
    // would actually get, in the actual order they'd actually get it - not a test-only shortcut. This used
    // to always prefer a cajunencounters.com match, a testing convenience from earlier tonight that stopped
    // being honest the moment this became "what is the real first send."
    const op = db
      .prepare(
        `SELECT o.* FROM operators o
         WHERE o.origin NOT IN ('demo', 'test') AND o.email LIKE '%@%' AND o.claim_status = 'unclaimed'
           AND (o.category_id IS NULL OR o.category_id NOT IN ('museum','themepark','waterpark','aquarium','zoo'))
           AND o.domain NOT LIKE '%.org' AND o.domain NOT LIKE '%.gov' AND o.domain NOT LIKE '%.edu'
           AND (o.review_count IS NULL OR o.review_count <= 20000)
           AND EXISTS (SELECT 1 FROM facts f WHERE f.operator_id = o.id AND f.fact_key = 'cover')
           AND (SELECT COUNT(*) FROM facts f WHERE f.operator_id = o.id AND f.fact_key = 'photo') >= 3
           AND (SELECT COUNT(*) FROM offerings f WHERE f.operator_id = o.id AND f.price_cents IS NOT NULL) >= 1
           AND (o.review_count >= 5 OR (SELECT COUNT(*) FROM facts f WHERE f.operator_id = o.id AND f.fact_key = 'review') >= 1)
         ORDER BY o.review_count DESC NULLS LAST
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
  if (!opts.dry && blockers.length) return out;
  let sql = `SELECT d.id, d.to_email, o.domain, o.name, o.email, o.city, o.region, o.metro_id, o.website, o.completeness, o.origin, o.calendar_vendor
       FROM outreach_drafts d JOIN operators o ON o.id = d.operator_id
       WHERE d.status = 'draft' AND d.kind = 'listing' AND d.to_email IS NOT NULL AND d.to_email LIKE '%@%' AND o.claim_status = 'unclaimed'
         AND NOT EXISTS (SELECT 1 FROM outreach_drafts s WHERE s.to_email = d.to_email AND s.status = 'sent' AND s.kind = 'listing')
         -- Museums, theme parks, waterparks, aquariums and zoos are large, professionally-run institutions,
         -- not the small local operators this pitch is written for; category_id still missed real ones filed
         -- under an ordinary-looking category (the Gateway Arch under "cruise", the Museum of Flight under
         -- "heli"), so .org/.gov/.edu is the next cut - a for-profit local activity business is essentially
         -- always a .com. The review_count cap is a backstop for everything that still slips through: a real
         -- business can plausibly reach the high five figures, but ordering by review_count DESC with no cap
         -- put Disney Springs, the 9/11 Memorial and Kennedy Space Center at the top of a real run tonight
         -- (22 September 2026).
         AND (o.category_id IS NULL OR o.category_id NOT IN ('museum','themepark','waterpark','aquarium','zoo'))
         AND o.domain NOT LIKE '%.org' AND o.domain NOT LIKE '%.gov' AND o.domain NOT LIKE '%.edu'
         AND (o.review_count IS NULL OR o.review_count <= 20000)
         -- The same "good" bar outreach-list.mts already scores by: a cover photo, 3 or more photos, at
         -- least one priced service, and real reviews. Andretti Indoor Karting sailed through every filter
         -- above (a real small operator, a sane review count) and still went out with no photos at all,
         -- because none of them checked for that. This is the fix: if the page has nothing to show, the
         -- pitch has nothing to prove itself with, and it doesn't go out until enrichment gives it one.
         AND EXISTS (SELECT 1 FROM facts f WHERE f.operator_id = o.id AND f.fact_key = 'cover')
         AND (SELECT COUNT(*) FROM facts f WHERE f.operator_id = o.id AND f.fact_key = 'photo') >= 3
         AND (SELECT COUNT(*) FROM offerings f WHERE f.operator_id = o.id AND f.price_cents IS NOT NULL) >= 1
         AND (o.review_count >= 5 OR (SELECT COUNT(*) FROM facts f WHERE f.operator_id = o.id AND f.fact_key = 'review') >= 1)`;
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
      const at = nowIso();
      db.prepare("UPDATE outreach_drafts SET status = 'sent', subject = ?, body = ?, created_at = ? WHERE id = ?").run(copy.subject, copy.body, at, r.id);
      // The SQLite row above is on this machine only; the API host cannot see it. Postgres is where the count
      // of what outreach has done has to live. Never throws: the email has already gone out either way.
      await recordSend({ email: to, listing: catalogId(r.domain), at });
      out.sent++;
    } else {
      db.prepare("UPDATE outreach_drafts SET status = 'failed' WHERE id = ?").run(r.id);
      out.failed++;
      console.error(to + ": " + res.error);
      if (/no mail key/.test(res.error || "")) break;
    }
    // A real person sending individual emails does not fire one every 600ms: that cadence is itself a bulk-
    // mail signal, on top of everything else this file already avoids (no tracking pixel, no List-Unsubscribe
    // header, Gmail SMTP over Resend for exactly this reason). 90 to 300 seconds, randomized so the gaps
    // themselves don't look automated, spreads a 20-email first day over roughly half an hour to an hour and
    // a half - long enough to see an early reply land before the rest of the batch goes out.
    await new Promise((x) => setTimeout(x, 90_000 + Math.random() * 210_000));
  }
  return out;
}
