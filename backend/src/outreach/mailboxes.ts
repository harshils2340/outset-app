import { instantOf, todayIn } from "../lib/zone.ts";

/**
 * What every sender shares about sending mailboxes, with no database behind it: which mailbox sends next,
 * which errors are the mailbox's own, which are the network's, and when the campaign's day begins. The laptop
 * sender (sendOtto.ts) and the cloud run (scripts/otto-cloud.mts) both read these.
 */

/** The mailbox with the most of its day's allowance left, so the load spreads evenly; null when every one is spent. */
export function pickIdentity(quota: Record<string, number>): string | null {
  let best: string | null = null;
  for (const [user, left] of Object.entries(quota)) if (left > 0 && (best === null || left > quota[best])) best = user;
  return best;
}

/**
 * An error that is the sending mailbox's, not the recipient's: a wrong app password, Gmail's daily limit, a
 * locked account, or a mail server this network cannot reach at all (a university relay that only answers
 * from campus, a network that blocks 587 and 465). None of these say anything about the address, so the
 * draft is left alone and the mailbox is retired for the run.
 */
export const MAILBOX_ERROR = /535|EAUTH|invalid login|username and password|daily user sending|sending limit|too many login|locked|suspended|no such sending mailbox|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|connection timeout|greeting never received/i;

/**
 * The network's fault, not the mailbox's: the Mac woke for the 9:30 launch before Wi-Fi was back (28 September
 * 2026: every mailbox retired inside a minute, 2 of 85 sent), a route dropped, DNS blinked. Worth a wait and
 * another go before the mailbox is retired, and worth another round later (otto-ramp.mts) once it is.
 */
export const NETWORK_ERROR = /ENETUNREACH|EHOSTUNREACH|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|connection timeout|greeting never received/i;


/**
 * The instant the campaign's day began, as the UTC ISO string `created_at` is stored in. The day is the
 * campaign's own (PIPELINE_TZ, Toronto by default), not UTC: counted by UTC the day rolled over at 8 PM
 * Toronto time, so an evening run saw a fresh ceiling and could add a whole second batch to a day that had
 * already had one.
 *
 * Read through `zone.ts`, which the shop clocks already use, rather than by subtracting the offset this
 * instant happens to have: on the two days a year the offset changes, midnight is not that many hours back.
 * Measured against every day of 2026, the offset arithmetic put the boundary an hour out on 8 March and on
 * 1 November, and the November hour is the one that costs something: sends made in Toronto's first hour fell
 * outside the count, so `sentToday` read low and the ramp could add that many over the ceiling.
 */
export function dayStartIso(tz = process.env.PIPELINE_TZ || "America/Toronto", now = new Date()): string {
  return new Date(instantOf(todayIn(tz, now), "00:00", tz)).toISOString();
}
