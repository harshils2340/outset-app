import "../src/env.ts";
import { sendMail, smtpIdentities } from "../src/lib/mail.ts";
import { emailHash, loadSuppression, mailPostal, unsubPageUrl } from "../src/lib/unsub.ts";
import { outreachBlockers, UNREADABLE_ADDRESS } from "../src/outreach/guards.ts";
import { isDeliverable } from "../src/outreach/deliverable.ts";
import { COPY_VERSION, draftOttoCopy } from "../src/outreach/ottoDrafts.ts";
import { recordSend } from "../src/lib/outreachLog.ts";
import { recordRun, rungFor, type RampState } from "../src/outreach/ramp.ts";
import { MAILBOX_ERROR, NETWORK_ERROR, dayStartIso, pickIdentity } from "../src/outreach/mailboxes.ts";
import { collectBounces, collectReplies, markReplied, suppressBounce } from "../src/outreach/bounceSweep.ts";
import { placementTest, placementVerdict } from "../src/outreach/placement.ts";
import {
  RESEND_KIND, loadRamp, mailedIndex, poolCandidates, recordTouch, repliedOperators, resendCandidates, saveRamp, sentTodayByMailbox, type PoolRow,
} from "../src/outreach/touches.ts";
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
type OttoState = RampState & {
  mailboxes?: Record<string, RampState>;
  /** The last inbox-placement check: when, against which copy, what Gmail did with it. */
  placement?: { day: string; version: string; summary: string; hold: boolean };
};
/** Placement is re-checked every other day (Harshil, 2 October 2026), and always after the copy changes. */
const PLACEMENT_EVERY_DAYS = 2;
const notifyTo = (process.env.OUTREACH_ALERT_TO || "harshils2340@gmail.com").trim();

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

/** A note to Harshil, sent from a second sending mailbox to his own (the cron has no other mail transport). */
async function notify(subject: string, text: string): Promise<void> {
  const via = (ids.find((i) => i.user.toLowerCase() !== notifyTo.toLowerCase()) || ids[0]).user;
  const res = await sendMail({ to: notifyTo, subject, text, commercial: true, via });
  if (!res.sent) console.error("otto-cloud: could not notify " + notifyTo + ": " + res.error);
}

// Replies before anything is sent. The copy promises 'Reply "no" and I won't email again', so a human reply
// from any business we mailed stops every further send to it, and Harshil gets each new one in his own inbox
// (two of the three sending inboxes are never read by a person).
if (!dry) {
  try {
    const known = await repliedOperators();
    const replies = await collectReplies(14, await mailedIndex());
    const fresh: string[] = [];
    for (const r of replies) {
      if (r.auto) { console.log(`auto-reply (not counted): ${r.from}: ${r.subject.slice(0, 80)}`); continue; }
      const isNew = r.operatorIds.some((id) => !known.has(id));
      await markReplied(r);
      for (const id of r.operatorIds) known.add(id);
      if (isNew) fresh.push(`${r.from} (to ${r.mailbox}, ${r.at.slice(0, 10)})\nSubject: ${r.subject}\n${r.snippet}\n`);
    }
    console.log(`otto-cloud: ${replies.filter((r) => !r.auto).length} human repl(ies) in 14 days, ${fresh.length} new`);
    if (fresh.length) await notify(`Otto: ${fresh.length} new repl${fresh.length === 1 ? "y" : "ies"} to the pitch`,
      "These businesses replied. Each one is now off every future send. Open the inbox named to answer.\n\n" + fresh.join("\n"));
  } catch (e) {
    console.error("otto-cloud: reply sweep failed, sending anyway (bounces and suppression still apply): " + (e as Error).message);
  }
}

const today = todayIn(TZ);
const dayStart = dayStartIso(TZ);
const state: OttoState = (await loadRamp<OttoState>("otto")) || { firstDay: today, ranDays: [] };
if (state.ranDays.includes(today) && !dry && !resume) {
  console.log(`otto-cloud: already ran today (${today})`);
  process.exit(0);
}

const asCopy = (r: PoolRow) => draftOttoCopy(
  { id: r.operator_id, domain: r.domain, name: r.name, email: r.email, phone: r.phone, city: r.city, region: r.region, calendar_vendor: r.calendar_vendor },
  r.email, { greet: r.greet });

// Inbox placement: is today's copy still landing in Gmail's Primary tab? Checked every other day and
// whenever the copy changes; a clear Promotions/Spam verdict holds the whole batch and tells Harshil, since
// sending 100 emails into Promotions is how 596 sends earned one reply (src/outreach/placement.ts).
const last = state.placement;
const daysSince = last ? Math.round((Date.parse(today) - Date.parse(last.day)) / 86_400_000) : Infinity;
if (!dry && (!last || last.version !== COPY_VERSION || daysSince >= PLACEMENT_EVERY_DAYS)) {
  const sample = (await poolCandidates(ids.length)).map(asCopy).map((c) => ({ subject: c.subject, text: c.body, html: c.html }));
  const results = await placementTest(sample, { replyTo: process.env.MAIL_REPLY_TO || undefined });
  const verdict = placementVerdict(results);
  for (const r of results) console.log(`placement: ${r.from} -> ${r.to}: ${r.placement}`);
  console.log(`otto-cloud: placement check for copy ${COPY_VERSION}: ${verdict.summary}${verdict.hold ? " - HOLDING TODAY'S BATCH" : ""}`);
  state.placement = { day: today, version: COPY_VERSION, summary: verdict.summary, hold: verdict.hold };
  if (verdict.hold) {
    await saveRamp("otto", state);
    await notify("Otto outreach held: Gmail is filing the pitch under Promotions/Spam",
      `Today's batch was not sent. The placement check sent copy ${COPY_VERSION} between the sending inboxes and Gmail filed it as: ${verdict.summary}.\n\n` +
      results.map((r) => `${r.from} -> ${r.to}: ${r.placement}`).join("\n") +
      "\n\nShorten the copy in backend/src/outreach/ottoDrafts.ts (fewer links, less sales language) and redeploy outset-otto. The next run re-checks before sending.");
    process.exit(0);
  }
} else if (last) {
  console.log(`otto-cloud: placement last checked ${last.day} (copy ${last.version}): ${last.summary}`);
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

async function sendBatch(limit: number, quota: Record<string, number>): Promise<{ sent: number; resent: number; skipped: number; failed: number; retired: { mailbox: string; error: string }[] }> {
  const out = { sent: 0, skipped: 0, failed: 0, resent: 0, retired: [] as { mailbox: string; error: string }[] };
  // Half of today's allowance goes to the resend (most recently mailed first) while it lasts, the rest to
  // businesses never mailed; alternating so a cut-short day still does some of each. Same daily cap.
  const resends = (await resendCandidates(Math.ceil(limit / 2) * 2, COPY_VERSION)).map((r) => ({ ...r, kind: RESEND_KIND }));
  const fresh = (await poolCandidates(limit * 2)).map((r) => ({ ...r, kind: "otto" }));
  const resendBudget = Math.min(Math.ceil(limit / 2), resends.length);
  const rows: (PoolRow & { kind: string })[] = [];
  for (let i = 0; i < Math.max(resends.length, fresh.length); i++) {
    if (i < resends.length && rows.filter((x) => x.kind === RESEND_KIND).length < resendBudget * 2) rows.push(resends[i]);
    if (i < fresh.length) rows.push(fresh[i]);
  }
  console.log(`otto-cloud: ${resends.length} resend candidate(s) (newest first), ${fresh.length} new; up to ${resendBudget} resends today`);
  const seen = new Set<string>();
  let resentToday = 0;
  for (const r of rows) {
    if (r.kind === RESEND_KIND && resentToday >= resendBudget) continue;
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
      console.log("would " + (r.kind === RESEND_KIND ? "RESEND to " : "send to ") + to + (r.greet ? " (Hi " + r.greet + ")" : "") + " [variant " + copy.variant + "]: " + copy.subject);
      out.sent++;
      if (r.kind === RESEND_KIND) { out.resent++; resentToday++; }
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
      await recordTouch({ operatorId: r.operator_id, email: to, status: "sent", mailbox: res.via ?? via, variant: copy.variant, at, kind: r.kind });
      await recordSend({ email: to, listing: r.catalog_id, at });
      out.sent++;
      if (r.kind === RESEND_KIND) { out.resent++; resentToday++; }
      quota[via] -= 1;
    } else if (MAILBOX_ERROR.test(res.error || "")) {
      console.error(via + " retired for this run: " + res.error);
      quota[via] = 0;
      out.retired.push({ mailbox: via, error: res.error || "" });
      continue;
    } else {
      await recordTouch({ operatorId: r.operator_id, email: to, status: "failed", kind: r.kind }).catch(() => undefined);
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
  console.log(`otto-cloud: round ${round}: ${JSON.stringify({ sent: result.sent, resent: result.resent, skipped: result.skipped, failed: result.failed, retired: result.retired.map((r) => r.mailbox) })}`);
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
