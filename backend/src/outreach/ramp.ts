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

/** Which rung this run is on, and how many that rung allows, before any ceiling is applied. */
export function rungFor(s: RampState, ramp: number[]): { day: number; limit: number } {
  const day = sendingDays(s).length + 1;
  return { day, limit: ramp[Math.min(day, ramp.length) - 1] };
}

/** The state to save after a run. `sent` is how many emails actually went out, which may be none. */
export function recordRun(s: RampState, today: string, sent: number): RampState {
  const sentDays = sendingDays(s).slice();
  if (sent > 0 && !sentDays.includes(today)) sentDays.push(today);
  return {
    firstDay: s.firstDay || today,
    ranDays: s.ranDays.includes(today) ? s.ranDays : [...s.ranDays, today],
    sentDays,
  };
}
