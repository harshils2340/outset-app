import "../src/env.ts";
import { sendMail, smtpIdentities } from "../src/lib/mail.ts";
import { emailHash, loadSuppression, mailPostal, unsubPageUrl } from "../src/lib/unsub.ts";
import { outreachBlockers, UNREADABLE_ADDRESS } from "../src/outreach/guards.ts";
import { isDeliverable } from "../src/outreach/deliverable.ts";
import { draftOttoCopy } from "../src/outreach/ottoDrafts.ts";
import { recordSend } from "../src/lib/outreachLog.ts";
import { recordRun, rungFor, type RampState } from "../src/outreach/ramp.ts";
import { MAILBOX_ERROR, NETWORK_ERROR, dayStartIso, pickIdentity } from "../src/outreach/mailboxes.ts";
import { collectBounces, suppressBounce } from "../src/outreach/bounceSweep.ts";
import { loadRamp, poolCandidates, recordTouch, saveRamp, sentTodayByMailbox } from "../src/outreach/touches.ts";
import { todayIn } from "../src/lib/zone.ts";

/**
 * The Otto campaign's daily send, from the cloud (a Render cron, render.yaml `outset-otto`), with nothing on
 * a disk: candidates, history and warm-up state all in Postgres (src/outreach/touches.ts), published from the
 * laptop by scripts/outreach-pool-sync.mts. Harshil, 28 September 2026, after a launch on the laptop fired
 * before Wi-Fi was back and benched every mailbox: "have it so it sends via cloud, regardless it runs".
 *
 *   npx tsx scripts/otto-cloud.mts            # today's batch: bounces first, then the send
 *   npx tsx scripts/otto-cloud.mts --dry      # the plan and who would get mail, nothing sent or recorded
 *   npx tsx scripts/otto-cloud.mts --resume   # run again on a day that already ran, only what is still owed
 *
 * Same rules as the laptop ramp (scripts/otto-ramp.mts), the same copy (ottoDrafts.ts), the same mailboxes
 * (MAIL_SMTP_USER and _2 and up, each on its own warm-up and its own daily cap), the same pacing, the same
 * pre-send guards, the same bounce sweep before the batch. What differs is only where the state lives.
 */
const dry = process.argv.includes("--dry");
const resume = process.argv.includes("--resume");
const TZ = process.env.PIPELINE_TZ || "America/Toronto";
const RAMP = [10, 25, 35, 50];
const PER_MAILBOX = Math.min(50, Math.max(1, Number(process.env.OUTREACH_PER_MAILBOX || 50)));
type OttoState = RampState & { mailboxes?: Record<string, RampState> };

const suppression = await loadSuppression();
const blocked = suppression.hashes;
const blockers = outreachBlockers({
  claimSecret: process.env.CLAIM_SECRET || "",
  mailFrom: process.env.MAIL_FROM || "",
  postal: mailPostal(),
  unsubUrl: unsubPageUrl("owner@example.com"),
  suppression,
});
for (const b of blockers) console.error("otto-cloud: " + b);
if (blockers.length && !dry) {
  console.error("otto-cloud: nothing sent. Fix the above.");
  process.exit(1);
}
const ids = smtpIdentities();
if (!ids.length) {
  console.error("otto-cloud: no sending mailbox configured (MAIL_SMTP_USER / MAIL_SMTP_PASS)");
  process.exit(1);
}

// Yesterday's bounces out of the pool before today's batch.
if (!dry) {
  for (const b of await collectBounces(3)) {
    console.log(`bounce: ${b.email} via ${b.mailbox}: ${b.reason}`);
    await suppressBounce(b);
    blocked.add(emailHash(b.email));
  }
}

const today = todayIn(TZ);
const dayStart = dayStartIso(TZ);
const state: OttoState = (await loadRamp<OttoState>("otto")) || { firstDay: today, ranDays: [] };
if (state.ranDays.includes(today) && !dry && !resume) {
  console.log(`otto-cloud: already ran today (${today})`);
  process.exit(0);
}
const mailboxes = (state.mailboxes ||= {});
const before = await sentTodayByMailbox(dayStart);
const firstUser = ids[0].user;
const sentBy = (user: string, counts: Record<string, number>) => (counts[user] || 0) + (user === firstUser ? counts[""] || 0 : 0);

async function planToday(): Promise<{ limit: number; quota: Record<string, number> }> {
  const counts = await sentTodayByMailbox(dayStart);
  const quota: Record<string, number> = {};
  const lines: string[] = [];
  for (const id of ids) {
    const mb = (mailboxes[id.user] ||=
      id.user === firstUser
        ? { firstDay: state.firstDay, ranDays: [...state.ranDays], sentDays: state.sentDays ? [...state.sentDays] : undefined }
        : { firstDay: today, ranDays: [], sentDays: [] });
    const { day, limit: rung } = rungFor(mb, RAMP.map((r) => Math.min(r, PER_MAILBOX)), today);
    const already = sentBy(id.user, counts);
    // What today's allowance still has room for, not the whole allowance again: this is asked fresh every
    // round and again on a --resume, and each of those has to see what already went out this morning.
    quota[id.user] = Math.max(0, Math.min(rung, PER_MAILBOX) - already);
    lines.push(`${id.user}: day ${day}, rung ${rung}, ${already} sent today, up to ${quota[id.user]}`);
  }
  const limit = Object.values(quota).reduce((a, b) => a + b, 0);
  console.log(`otto-cloud: ${ids.length} mailbox(es), sending up to ${limit} today (${today} in ${TZ})\n  ` + lines.join("\n  "));
  return { limit, quota };
}

async function sendBatch(limit: number, quota: Record<string, number>): Promise<{ sent: number; skipped: number; failed: number; retired: { mailbox: string; error: string }[] }> {
  const out = { sent: 0, skipped: 0, failed: 0, retired: [] as { mailbox: string; error: string }[] };
  const rows = await poolCandidates(limit * 2);
  const seen = new Set<string>();
  for (const r of rows) {
    if (out.sent >= limit) break;
    const to = r.email.trim().toLowerCase();
    if (seen.has(to) || UNREADABLE_ADDRESS.test(to) || blocked.has(emailHash(to))) {
      out.skipped++;
      continue;
    }
    seen.add(to);
    if (!(await isDeliverable(to))) {
      console.log("skipped " + to + ": domain takes no mail");
      if (!dry) await recordTouch({ operatorId: r.operator_id, email: to, status: "failed" }).catch(() => undefined);
      out.skipped++;
      continue;
    }
    const op = { id: r.operator_id, domain: r.domain, name: r.name, email: r.email, phone: r.phone, city: r.city, region: r.region, calendar_vendor: r.calendar_vendor };
    const copy = draftOttoCopy(op, to, { greet: r.greet });
    if (dry) {
      console.log("would send to " + to + (r.greet ? " (Hi " + r.greet + ")" : "") + " [variant " + copy.variant + "]: " + copy.subject);
      out.sent++;
      continue;
    }
    const via = pickIdentity(quota);
    if (!via) {
      console.log("every mailbox has used its allowance for today");
      break;
    }
    const msg = { to, subject: copy.subject, text: copy.body, html: copy.html, replyTo: process.env.MAIL_REPLY_TO || undefined, commercial: true, via };
    let res = await sendMail(msg);
    for (let tries = 1; !res.sent && NETWORK_ERROR.test(res.error || "") && tries <= 3; tries++) {
      console.error(via + ": network error, waiting 60 seconds and trying again (" + tries + " of 3): " + res.error);
      await new Promise((x) => setTimeout(x, 60_000));
      res = await sendMail(msg);
    }
    if (res.sent) {
      const at = new Date().toISOString();
      await recordTouch({ operatorId: r.operator_id, email: to, status: "sent", mailbox: res.via ?? via, variant: copy.variant, at });
      await recordSend({ email: to, listing: r.catalog_id, at });
      out.sent++;
      quota[via] -= 1;
    } else if (MAILBOX_ERROR.test(res.error || "")) {
      console.error(via + " retired for this run: " + res.error);
      quota[via] = 0;
      out.retired.push({ mailbox: via, error: res.error || "" });
      continue;
    } else {
      await recordTouch({ operatorId: r.operator_id, email: to, status: "failed" }).catch(() => undefined);
      out.failed++;
      console.error(to + ": " + res.error);
    }
    // 90 to 300 seconds between one mailbox's sends, the gap shared between the mailboxes taking turns.
    const active = Object.values(quota).filter((n) => n > 0).length || 1;
    await new Promise((x) => setTimeout(x, (90_000 + Math.random() * 210_000) / active));
  }
  return out;
}

let sent = 0;
for (let round = 1; round <= 4; round++) {
  const { limit, quota } = await planToday();
  if (limit <= 0) {
    if (round === 1) console.log("otto-cloud: no headroom left today, sending nothing");
    break;
  }
  const result = await sendBatch(limit, quota);
  sent += result.sent;
  console.log(`otto-cloud: round ${round}: ${JSON.stringify({ sent: result.sent, skipped: result.skipped, failed: result.failed, retired: result.retired.map((r) => r.mailbox) })}`);
  if (dry || result.sent >= limit || !result.retired.some((r) => NETWORK_ERROR.test(r.error))) break;
  console.log("otto-cloud: network trouble, waiting 10 minutes before the next round");
  await new Promise((x) => setTimeout(x, 10 * 60_000));
}
if (dry) {
  console.log("otto-cloud: dry run, nothing sent, nothing recorded");
  process.exit(0);
}

// The day is recorded either way; the rung only moves on mail sent, for the campaign and for each mailbox.
const after = await sentTodayByMailbox(dayStart);
for (const id of ids) mailboxes[id.user] = recordRun(mailboxes[id.user], today, sentBy(id.user, after) - sentBy(id.user, before));
await saveRamp("otto", recordRun(state, today, sent));
console.log(`otto-cloud: done, ${sent} sent today`);
process.exit(0);
