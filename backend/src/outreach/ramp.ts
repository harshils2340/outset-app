/**
 * The warm-up ramp both outreach campaigns climb, and the small piece of state behind it.
 *
 * The rung is how many weekdays the job has actually put mail out on, never the calendar date: a weekend, a
 * worker outage or a launch that fired late must not skip a rung, which is the whole reason the count is
 * kept in a file rather than read off the clock.
 *
 * A day the job ran and sent nothing is not a rung either, and it used to be one. Both ramps recorded the
 * day unconditionally at the end, so a day with no headroom left under the combined ceiling (the other
 * campaign had already used it) or an empty queue stepped the ramp up for mail that never went out. On a
 * first ever run that came to nothing, the next weekday started at the second rung having sent not one
 * email, which is exactly the climb the ramp exists to prevent.
 *
 * `ranDays` still answers "has this already run today", because that question is about the launch and not
 * about the mail. `sentDays` answers the rung.
 */
export type RampState = { firstDay: string; ranDays: string[]; sentDays?: string[] };

/**
 * The days that count towards the rung. A state file written before sends were counted separately carries
 * only `ranDays`; every day in it was a day the ramp sent on, so it stands in and a running campaign keeps
 * its place on the ramp instead of dropping back to the first rung.
 */
export function sendingDays(s: RampState): string[] {
  return s.sentDays ?? s.ranDays;
}

/**
 * Which rung this run is on, and how many that rung allows, before any ceiling is applied.
 *
 * `today` is the campaign day this run is part of, and a day the campaign has already sent on is the rung it
 * is already on rather than the next one up. Without it a second run on one day (a `--resume` after a network
 * outage, a cron that fired twice) read its own morning's mail as a rung climbed and handed the afternoon the
 * rung above: a mailbox on the first rung of ten sent ten, resumed, and was offered twenty-five more.
 */
export function rungFor(s: RampState, ramp: number[], today?: string): { day: number; limit: number } {
  const day = sendingDays(s).filter((d) => d !== today).length + 1;
  return { day, limit: ramp[Math.min(day, ramp.length) - 1] };
}

/**
 * The state to save after a run. `sent` is how many emails actually went out, which may be none. Anything
 * else the state carries (the Otto ramp keeps one of these per sending mailbox under `mailboxes`) is kept.
 */
export function recordRun<S extends RampState>(s: S, today: string, sent: number): S {
  const sentDays = sendingDays(s).slice();
  if (sent > 0 && !sentDays.includes(today)) sentDays.push(today);
  return {
    ...s,
    firstDay: s.firstDay || today,
    ranDays: s.ranDays.includes(today) ? s.ranDays : [...s.ranDays, today],
    sentDays,
  };
}
