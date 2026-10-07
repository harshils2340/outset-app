import "../src/env.ts";
import { sendMail, smtpIdentities } from "../src/lib/mail.ts";
import { emailHash, loadSuppression, mailPostal, unsubPageUrl } from "../src/lib/unsub.ts";
import { outreachBlockers, UNREADABLE_ADDRESS } from "../src/outreach/guards.ts";
import { isDeliverable, siteResolves } from "../src/outreach/deliverable.ts";
import { ARMS, COPY_LADDER, COPY_VERSION, armOf, draftOttoBump, draftOttoCopy, type CopyStyle } from "../src/outreach/ottoDrafts.ts";
import { recordSend } from "../src/lib/outreachLog.ts";
import { recordRun, rungFor, type RampState } from "../src/outreach/ramp.ts";
import { MAILBOX_ERROR, NETWORK_ERROR, dayStartIso, pickIdentity } from "../src/outreach/mailboxes.ts";
import { archiveBounceNotices, collectBounces, collectReplies, markRedirect, markReplied, suppressBounce } from "../src/outreach/bounceSweep.ts";
import { pickRung, placementMatrix, placementRead } from "../src/outreach/placement.ts";
import {
  BUMP_KIND, RESEND_KIND, armStats, bumpCandidates, handedOffOperators, loadRamp, mailedIndex, poolCandidates, recordTouch, repliedOperators, resendCandidates, saveRamp, sentTodayByMailbox, type PoolRow,
} from "../src/outreach/touches.ts";
import { SentThreads } from "../src/outreach/thread.ts";
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
  /** Days the A/B/C report has already gone to Harshil, so a re-run of the same day does not send it twice. */
  abcReported?: string[];
};
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
  const bounces = await collectBounces(3);
  for (const b of bounces) {
    console.log(`bounce: ${b.email} via ${b.mailbox}: ${b.reason}`);
    await suppressBounce(b);
    blocked.add(emailHash(b.email));
  }
  // Every one is on the suppression list now, so Gmail's "Address not found" notices can leave the inboxes.
  const archived = await archiveBounceNotices(bounces);
  if (archived) console.log(`otto-cloud: archived ${archived} bounce notice(s) out of the sending inboxes`);
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
    const handed = await handedOffOperators();
    const replies = await collectReplies(14, await mailedIndex());
    const fresh: string[] = [];
    const redirects: string[] = [];
    for (const r of replies) {
      if (r.auto) {
        console.log(`auto-reply (not counted): ${r.from}: ${r.subject.slice(0, 80)}` + (r.redirect ? ` -> points to ${r.redirect}` : ""));
        if (r.redirect && r.operatorIds.some((id) => !handed.has(id))) {
          await markRedirect(r);
          for (const id of r.operatorIds) handed.add(id);
          redirects.push(`${r.from} auto-replied and points to ${r.redirect}\n${r.snippet}\n`);
        }
        continue;
      }
      const isNew = r.operatorIds.some((id) => !known.has(id));
      await markReplied(r);
      for (const id of r.operatorIds) known.add(id);
      if (isNew) fresh.push(`${r.from} (to ${r.mailbox}, ${r.at.slice(0, 10)})\nSubject: ${r.subject}\n${r.snippet}\n`);
    }
    console.log(`otto-cloud: ${replies.filter((r) => !r.auto).length} human repl(ies) in 14 days, ${fresh.length} new`);
    if (fresh.length) await notify(`Otto: ${fresh.length} new repl${fresh.length === 1 ? "y" : "ies"} to the pitch`,
      "These businesses replied. Each one is now off every future send. Open the inbox named to answer.\n\n" + fresh.join("\n"));
    if (redirects.length) await notify(`Otto: ${redirects.length} auto-repl${redirects.length === 1 ? "y names" : "ies name"} a better contact`,
      "These are automatic replies, not people. Each names a better address to pitch; the business is off the automated sends and yours to email by hand.\n\n" + redirects.join("\n"));
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

// Every day of the week (Harshil, 2 October 2026, and again 5 October: a weekend skipped is unused reach-out).
// A 4 October change had skipped Saturday and Sunday; it is gone.

// The A/B/C test's report, by email: after a week of first emails (13 October) and again a week later (20 October),
// once every arm's follow-up has had time to go out and be answered.
const ABC_SINCE = "2026-10-06T04:00:00Z";
const ABC_REPORT_DAYS = ["2026-10-13", "2026-10-20"];
if (!dry && ABC_REPORT_DAYS.includes(today) && !(state.abcReported || []).includes(today)) {
  try {
    const rows = await armStats(ABC_SINCE);
    const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(1) + "%" : "-");
    const table = rows.map((r) => `${r.arm}: ${r.sent} first emails, ${r.bounced} bounced, ${r.followed} followed up, ${r.replied} replied (${pct(r.replied, r.sent - r.bounced)} of delivered)` +
      (r.names.length ? "\n   replied: " + r.names.join(", ") : "")).join("\n");
    await notify(`Otto A/B/C test, ${today === ABC_REPORT_DAYS[0] ? "one week in" : "final"}`,
      "Every business first emailed since 6 October, by the version it got:\n\n" + table +
      "\n\nA full: the full pitch with the recording link, then \"free test line\" three days later.\n" +
      "B ask: no link, \"Can I send you a 40-second recording?\", then the recording three days later.\n" +
      "C forgot: the pitch without the recording, then the next day \"Shoot, forgot to put this in my last email\" with the link.\n" +
      "Replies count any human answer, a no included: the names are there so you can see which were interested." +
      (today === ABC_REPORT_DAYS[0] ? "\n\nThe last week's follow-ups are still going out; the final numbers come on " + ABC_REPORT_DAYS[1] + "." : ""));
    state.abcReported = [...(state.abcReported || []), today];
    await saveRamp("otto", state);
  } catch (e) {
    console.error("otto-cloud: A/B/C report failed, sending anyway: " + (e as Error).message);
  }
}

const asCopy = (r: PoolRow, style: CopyStyle = "full") => draftOttoCopy(
  { id: r.operator_id, domain: r.domain, name: r.name, email: r.email, phone: r.phone, city: r.city, region: r.region, calendar_vendor: r.calendar_vendor, family: r.family },
  r.email, { greet: r.greet, style });

// Inbox placement, every sending day: every rung of the approved copy ladder (ottoDrafts.ts COPY_LADDER) and the
// follow-up go from each sending inbox to the next, and Gmail's tab for each is read back
// (src/outreach/placement.ts). The batch goes out with the first rung Gmail puts in Primary, so a copy that drifts
// into Promotions falls back on its own; the whole batch is held only when no rung lands, and follow-ups are
// skipped for the day when theirs does not. Until 5 October 2026 one copy was checked and a Promotions verdict
// held the batch until someone rewrote the copy by hand (Harshil: "this shouldn't keep happening").
let style: CopyStyle = "full";
// The A/B/C test (ottoDrafts.ts ARMS; Harshil, 6 October 2026: "A/B/C test this for a week"): the arms whose
// first email reaches Primary take turns, and outreach_sends.variant says which one each business got, so the
// reply rate decides which stays. Each arm's follow-up is placement-tested too, and an arm whose follow-up misses
// Primary skips its follow-ups for the day.
let abStyles: CopyStyle[] = [];
const bumpOk: Record<string, boolean> = { full: true, ask: true, forgot: true };
const armRung = (arm: CopyStyle): CopyStyle => (arm === "forgot" ? "nolink" : arm);
if (!dry) {
  const pool = await poolCandidates(ids.length);
  const bumpSamples = (arm: CopyStyle) => pool.map((r) => {
    const op = { id: r.operator_id, domain: r.domain, name: r.name, email: r.email, phone: r.phone, city: r.city, region: r.region, calendar_vendor: r.calendar_vendor, family: r.family };
    const first = asCopy(r, arm);
    const c = draftOttoBump(op, r.email, { greet: r.greet, subject: first.subject, firstVariant: first.variant });
    return { subject: c.subject, text: c.body, html: c.html };
  });
  const matrix = await placementMatrix([
    ...COPY_LADDER.map((rung) => ({ key: rung.style, samples: pool.map((r) => asCopy(r, rung.style)).map((c) => ({ subject: c.subject, text: c.body, html: c.html })) })),
    ...ARMS.map((arm) => ({ key: "bump-" + arm, samples: bumpSamples(arm) })),
  ], { replyTo: process.env.MAIL_REPLY_TO || undefined });
  const report = [...matrix].map(([k, rs]) => `${k}: ${rs.map((r) => `${r.from} -> ${r.to}: ${r.placement}`).join("; ")}`);
  for (const line of report) console.log("placement: " + line);
  const pick = pickRung(COPY_LADDER.map((rung) => ({ key: rung.style, results: matrix.get(rung.style) || [] })));
  for (const arm of ARMS) bumpOk[arm] = pickRung([{ key: "bump-" + arm, results: matrix.get("bump-" + arm) || [] }])?.strict === true;
  const bumpsMissed = ARMS.filter((a) => !bumpOk[a]);
  const version = pick ? COPY_LADDER.find((r) => r.style === pick.key)!.version : COPY_VERSION;
  /**
   * Gmail answering nothing is not a verdict. Every result reads "unknown" when nothing could be measured: an
   * inbox whose IMAP would not open, test sends that never left, or fewer than two sending mailboxes, in which
   * case `placementMatrix` sends no test at all. `pickRung` wants Primary in two inboxes and finds none of it
   * either way, so an unread test took the same branch as a measured Promotions verdict: the day's batch was
   * held and Harshil was told "Gmail put every approved copy in Promotions/Spam", which nobody had measured,
   * and on a host left with one working mailbox that is every day from then on. placement.ts's own rule is
   * that only an explicit Promotions or Spam verdict may hold a batch, so an unread test goes out with the
   * approved copy, as the campaign did before the test existed, and says in the alert that it could not read.
   */
  const measured = [...matrix.values()].some(placementRead);
  if (pick) {
    state.placement = { day: today, version, summary: pick.summary, hold: false };
    style = pick.key as CopyStyle;
    abStyles = ARMS.filter((k) => pickRung([{ key: k, results: matrix.get(armRung(k)) || [] }]));
    if (abStyles.length < 2) abStyles = [];
    const skipped = bumpsMissed.length ? `; follow-ups skipped today for ${bumpsMissed.join(", ")}, their copy did not reach Primary` : "";
    console.log(`otto-cloud: sending copy ${abStyles.length ? "arms " + abStyles.join(" + ") : version} (${pick.summary})${skipped}`);
    if (!["ask", "full"].includes(style) || bumpsMissed.length)
      await notify(`Otto outreach fell back to copy ${version}`,
        `${["ask", "full"].includes(style) ? "The first emails reached Primary." : `Neither the no-link ask nor the full pitch reached Primary today, so the batch went out with the "${style}" rung, which did.`}${bumpsMissed.length ? ` Follow-ups were skipped today for the ${bumpsMissed.join(", ")} arm(s): theirs did not reach Primary.` : ""}\n\n` +
        report.join("\n") + "\n\nNothing to do unless this repeats for several days.");
  } else if (measured) {
    state.placement = { day: today, version, summary: "no rung reached Primary", hold: true };
    await saveRamp("otto", state);
    await notify("Otto outreach held: Gmail put every approved copy in Promotions/Spam",
      "Today's batch was not sent. Every rung of the copy ladder was tested between the sending inboxes and none reached Primary:\n\n" +
      report.join("\n") + "\n\nThis usually means the sending accounts' reputation, not the wording: check bounces and complaints first. The next run re-checks before sending.");
    process.exit(0);
  } else {
    // Nothing was measured, so nothing is held: the approved copy goes out and the alert says what happened.
    // `style` is already COPY_VERSION's rung and the follow-up's copy is unchanged, so both carry on as before.
    state.placement = { day: today, version: COPY_VERSION, summary: "no placement could be read", hold: false };
    for (const arm of ARMS) bumpOk[arm] = true;
    await saveRamp("otto", state);
    console.log(`otto-cloud: sending copy ${COPY_VERSION} (no placement could be read)`);
    await notify("Otto: today's placement test could not be read, sending the approved copy",
      "Gmail did not answer for a single test message, so nothing about today's placement is known: an inbox that would not open over IMAP, test sends that never left, or fewer than two sending mailboxes configured. That is not a copy in Promotions.\n\n" +
      (report.length ? report.join("\n") : "(no test was sent at all: a placement test needs two sending mailboxes)") +
      `\n\nThe batch went out with copy ${COPY_VERSION}, which is what the campaign sent before this test existed. Check MAIL_SMTP_USER / MAIL_SMTP_PASS for each sending mailbox if this repeats.`);
  }
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

type Row = PoolRow & { kind: string; sent_to?: string; sent_from?: string | null; last_at?: string; first_variant?: string | null };

// Turns kept apart, so the first emails rotate through every arm evenly. A resend gets no follow-up, so it only
// rotates through the arms that work without one: never "forgot", whose link comes in the follow-up.
let firstTurn = 0;
let resendTurn = 0;
function styleFor(kind: string): CopyStyle {
  if (!abStyles.length) return style;
  if (kind === RESEND_KIND) {
    const arms = abStyles.filter((a) => a !== "forgot");
    return arms.length ? arms[resendTurn++ % arms.length] : style;
  }
  return abStyles[firstTurn++ % abStyles.length];
}
async function sendBatch(limit: number, quota: Record<string, number>): Promise<{ sent: number; resent: number; bumped: number; skipped: number; failed: number; retired: { mailbox: string; error: string }[] }> {
  const out = { sent: 0, skipped: 0, failed: 0, resent: 0, bumped: 0, retired: [] as { mailbox: string; error: string }[] };
  // Up to 40% of today's allowance to the follow-up (businesses that already saw a first email in Primary, so
  // the likeliest to answer), up to 20% to the resend (whose first email went to Promotions; mostly water, out of
  // season), and the rest to businesses never mailed; taking turns so a cut-short day still does some of each.
  const bumps: Row[] = (await bumpCandidates(Math.ceil(limit * 0.4) * 2)).filter((r) => bumpOk[armOf(r.first_variant)]).map((r) => ({ ...r, kind: BUMP_KIND }));
  const resends: Row[] = (await resendCandidates(Math.ceil(limit * 0.2) * 2)).map((r) => ({ ...r, kind: RESEND_KIND }));
  const fresh: Row[] = (await poolCandidates(limit * 2)).map((r) => ({ ...r, kind: "otto" }));
  const budget: Record<string, number> = {
    [BUMP_KIND]: Math.min(Math.ceil(limit * 0.4), bumps.length),
    [RESEND_KIND]: Math.min(Math.ceil(limit * 0.2), resends.length),
    otto: limit,
  };
  const rows: Row[] = [];
  for (let i = 0; i < Math.max(bumps.length, resends.length, fresh.length); i++) {
    if (i < bumps.length) rows.push(bumps[i]);
    if (i < resends.length) rows.push(resends[i]);
    if (i < fresh.length) rows.push(fresh[i]);
  }
  console.log(`otto-cloud: ${bumps.length} follow-up(s) due, ${resends.length} resend candidate(s), ${fresh.length} new; up to ${budget[BUMP_KIND]} follow-ups and ${budget[RESEND_KIND]} resends today`);
  const seen = new Set<string>();
  const done: Record<string, number> = { [BUMP_KIND]: 0, [RESEND_KIND]: 0, otto: 0 };
  const threads = new SentThreads();
  for (const r of rows) {
    if (done[r.kind] >= budget[r.kind]) continue;
    if (out.sent >= limit) break;
    const bump = r.kind === BUMP_KIND;
    // A follow-up answers the first email: same address, same mailbox, even if the pool has a better door now.
    const to = (bump ? r.sent_to || r.email : r.email).trim().toLowerCase();
    const from = bump ? r.sent_from || smtpIdentities()[0]?.user || "" : "";
    if (bump && !dry && !(quota[from] > 0)) continue;
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
    // A business whose own website's name is gone has closed or moved on; its inbox is a bounce or nobody's.
    if (!(await siteResolves(r.website))) {
      console.log("skipped " + to + ": website " + r.website + " no longer exists");
      if (!dry) await recordTouch({ operatorId: r.operator_id, email: to, status: "failed" }).catch(() => undefined);
      out.skipped++;
      continue;
    }
    const op = { id: r.operator_id, domain: r.domain, name: r.name, email: r.email, phone: r.phone, city: r.city, region: r.region, calendar_vendor: r.calendar_vendor, family: r.family };
    // The greeting belongs to the pool's address; a follow-up to an older address opens plainly.
    const greet = !bump || to === r.email.trim().toLowerCase() ? r.greet : null;
    const thread = bump && !dry ? await threads.find(from, to, new Date(r.last_at || Date.now())).catch(() => null) : null;
    const copy = bump
      ? draftOttoBump(op, to, { greet, subject: thread?.subject || draftOttoCopy(op, to).subject, firstVariant: r.first_variant })
      : draftOttoCopy(op, to, { greet, style: styleFor(r.kind) });
    if (dry) {
      console.log("would " + (bump ? "FOLLOW UP with " : r.kind === RESEND_KIND ? "RESEND to " : "send to ") + to + (greet ? " (Hi " + greet + ")" : "") + " [variant " + copy.variant + "]: " + copy.subject);
      out.sent++;
      done[r.kind]++;
      if (r.kind === RESEND_KIND) out.resent++;
      if (bump) out.bumped++;
      continue;
    }
    const via = bump ? from : pickIdentity(quota);
    if (!via) {
      console.log("every mailbox has used its allowance for today");
      break;
    }
    if (bump && !thread) console.log("follow-up to " + to + ": first email not found in " + via + "'s Sent, sending as a Re: without the thread");
    const msg = { to, subject: copy.subject, text: copy.body, html: copy.html, replyTo: process.env.MAIL_REPLY_TO || undefined, commercial: true, via, inReplyTo: thread?.messageId };
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
      done[r.kind]++;
      if (r.kind === RESEND_KIND) out.resent++;
      if (bump) out.bumped++;
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
  await threads.close();
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
  console.log(`otto-cloud: round ${round}: ${JSON.stringify({ sent: result.sent, resent: result.resent, followups: result.bumped, skipped: result.skipped, failed: result.failed, retired: result.retired.map((r) => r.mailbox) })}`);
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
