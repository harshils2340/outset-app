import "../src/env.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { NETWORK_ERROR, sendOttoOutreach, sentToday } from "../src/outreach/sendOtto.ts";
import { generateOttoDrafts } from "../src/outreach/ottoDrafts.ts";
import { recordRun, rungFor, type RampState } from "../src/outreach/ramp.ts";
import { smtpIdentities } from "../src/lib/mail.ts";

/**
 * The Otto (AI phone line) campaign's own daily ramp. It ran alongside outreach-ramp.mts until 25 September
 * 2026, when Harshil paused the listing campaign to put the whole daily budget into Otto (outreach-daily.sh).
 *
 * Otto is a bigger ask than the listing pitch (a trial of something that answers real customer calls, not
 * just a free page), it has no track record yet, and both campaigns send through the same Gmail identity
 * (see mail.ts, outreach-ramp.mts for why a personal account tops out well under Google's raw daily figure).
 * So this ramp is smaller on its own AND checks `sentToday()`, which counts sends from EITHER campaign, so
 * the combined volume from that one mailbox stays under COMBINED_CEILING regardless of which ramp happens to
 * run first on a given day.
 */

const TZ = process.env.PIPELINE_TZ || "America/Toronto";
const DATA_DIR = dirname(process.env.OUTSET_DB_PATH || "/var/data/outset.db");
const STATE_PATH = join(DATA_DIR, "outreach-otto-ramp.json");
// Otto is the only campaign for now (Harshil, 25 September 2026: "just do all otto emails for now"), so it
// takes the whole 50 a day that a personal Gmail account sending cold mail can sustain, instead of a 20 share
// beside the listing ramp's 30 (see outreach-ramp.mts for that reasoning). The mailbox had already sent 84
// listing mails over two days plus Otto's first 10 before this, so the climb from 25 to 50 over three runs
// is well inside what it has done; COMBINED_CEILING still counts any listing sends, so resuming that ramp
// later cannot push the mailbox past 50 in a day.
// Per mailbox. With several mailboxes configured (MAIL_SMTP_USER_2 and up, see mail.ts) each climbs this ramp
// on its own count and stops at PER_MAILBOX a day, so four warmed mailboxes are 200 a day and a mailbox added
// later starts at the bottom rung while the first is already at the top (Harshil, 26 September 2026).
const RAMP = [10, 25, 35, 50];
const COMBINED_CEILING = 50;
// OUTREACH_PER_MAILBOX lowers the top of every mailbox's ramp (Harshil wants 30 per Gmail account, 26 September
// 2026: "30 x # of emails"); it never raises it above 50, the most a personal Gmail should send cold in a day.
const PER_MAILBOX = Math.min(50, Math.max(1, Number(process.env.OUTREACH_PER_MAILBOX || 50)));
/** The campaign's state plus one ramp per sending mailbox, keyed by its address. */
type OttoState = RampState & { mailboxes?: Record<string, RampState> };
// --dry: print today's plan per mailbox, send nothing, record nothing.
const dry = process.argv.includes("--dry");
// --resume: run again on a day that already ran, sending only what each mailbox's allowance still has room
// for (a launch that died with the network, a laptop that slept mid-batch).
const resume = process.argv.includes("--resume");


function todayIn(tz: string): { key: string; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { key: `${get("year")}-${get("month")}-${get("day")}`, weekday };
}

function loadState(): RampState {
  try {
    return existsSync(STATE_PATH) ? (JSON.parse(readFileSync(STATE_PATH, "utf8")) as RampState) : { firstDay: "", ranDays: [] };
  } catch {
    return { firstDay: "", ranDays: [] };
  }
}

function saveState(s: RampState): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

const { key: today, weekday } = todayIn(TZ);
// Every day, weekends included (Harshil, 27 September 2026: "maximize the days we have"): each sending day is
// a rung of the warm-up, so a skipped weekend is two days of volume lost for nothing. OUTREACH_WEEKDAYS_ONLY=1
// restores the old behaviour.
if ((weekday === 0 || weekday === 6) && process.env.OUTREACH_WEEKDAYS_ONLY === "1" && !dry) {
  console.log(`otto-ramp: weekend in ${TZ}, nothing sent`);
  process.exit(0);
}

const state = loadState() as OttoState;
if (state.ranDays.includes(today) && !dry && !resume) {
  console.log(`otto-ramp: already ran today (${today})`);
  process.exit(0);
}

const ids = smtpIdentities();
const mailboxes = (state.mailboxes ||= {});
const before: Record<string, number> = {};
for (const id of ids) before[id.user] = sentToday(id.user, ids[0].user);

/** Today's allowance, per mailbox, from what each has already sent today: fresh each round, so a second round after a network outage only sends what is still owed. */
function planToday(): { limit: number; quota?: Record<string, number> } {
  if (ids.length <= 1) {
    const { day, limit: rampLimit } = rungFor(state, RAMP);
    const already = sentToday();
    const limit = Math.max(0, Math.min(rampLimit, PER_MAILBOX, COMBINED_CEILING - already));
    console.log(`otto-ramp: day ${day} of the ramp (first run ${state.firstDay || today}), ramp says ${rampLimit}, ${already} already sent today across both campaigns, sending up to ${limit}`);
    return { limit };
  }
  const quota: Record<string, number> = {};
  const lines: string[] = [];
  for (const id of ids) {
    // The first mailbox is the one the campaign has run from so far, so it starts where the campaign is;
    // every other one starts at the bottom rung on the day it first appears.
    const mb = (mailboxes[id.user] ||=
      id.user === ids[0].user
        ? { firstDay: state.firstDay, ranDays: [...state.ranDays], sentDays: state.sentDays ? [...state.sentDays] : undefined }
        : { firstDay: today, ranDays: [], sentDays: [] });
    const { day: d, limit: rung } = rungFor(mb, RAMP.map((r) => Math.min(r, PER_MAILBOX)));
    const already = sentToday(id.user, ids[0].user);
    quota[id.user] = Math.max(0, Math.min(rung, PER_MAILBOX - already));
    lines.push(`${id.user}: day ${d}, rung ${rung}, ${already} sent today, up to ${quota[id.user]}`);
  }
  const limit = Object.values(quota).reduce((a, b) => a + b, 0);
  console.log(`otto-ramp: ${ids.length} mailboxes, sending up to ${limit} today\n  ` + lines.join("\n  "));
  return { limit, quota };
}

let sent = 0;
for (let round = 1; round <= 4; round++) {
  const { limit, quota } = planToday();
  if (limit <= 0) {
    if (round === 1) console.log("otto-ramp: no headroom left today under the ceiling, sending nothing");
    break;
  }
  if (!dry && round === 1) {
    const n = generateOttoDrafts();
    console.log(`otto-ramp: ${n} draft(s) refreshed`);
  }
  const result = await sendOttoOutreach({ limit, dry, quota });
  sent += result.sent;
  console.log(`otto-ramp: round ${round}: ${JSON.stringify({ sent: result.sent, skipped: result.skipped, failed: result.failed, retired: result.retired.map((r) => r.mailbox) })}`);
  // A mailbox retired over the network (the Mac woke for the launch before Wi-Fi was back, 28 September 2026)
  // gets its turn again after ten minutes, up to three more rounds; one retired for its own reasons does not.
  if (dry || result.sent >= limit || !result.retired.some((r) => NETWORK_ERROR.test(r.error))) break;
  console.log("otto-ramp: network trouble, waiting 10 minutes before the next round");
  await new Promise((x) => setTimeout(x, 10 * 60_000));
}
if (dry) {
  console.log("otto-ramp: dry run, nothing sent, nothing recorded");
  process.exit(0);
}

// The day is recorded either way, so a second launch today does nothing; the rung only moves on mail sent,
// for the campaign as a whole and, in place, for each mailbox on its own count.
if (quota) for (const id of ids) mailboxes[id.user] = recordRun(mailboxes[id.user], today, sentToday(id.user, ids[0].user) - before[id.user]);
saveState(recordRun(state, today, sent));
