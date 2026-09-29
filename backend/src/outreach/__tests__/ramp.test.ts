import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { recordRun, rungFor, sendingDays, type RampState } from "../ramp.ts";

/**
 * Which rung of the warm-up ramp a run is on.
 *
 * Both campaigns write the day they ran at the end of the run, and both used to count those days as the
 * rung. A run that sent nothing is one of those days: no headroom left under the combined ceiling because
 * the other campaign used it, or nothing left in the queue. So the ramp stepped up for mail that never went
 * out, and a first ever run that came to nothing put the next weekday on the second rung having sent not one
 * email, which is the climb the ramp exists to prevent.
 */

const RAMP = [10, 25, 35, 50];
const fresh = (): RampState => ({ firstDay: "", ranDays: [] });

test("the first run is the first rung", () => {
  assert.deepEqual(rungFor(fresh(), RAMP), { day: 1, limit: 10 });
});

test("a day that sent climbs a rung", () => {
  const s = recordRun(fresh(), "2026-09-21", 10);
  assert.deepEqual(rungFor(s, RAMP), { day: 2, limit: 25 });
  assert.deepEqual(rungFor(recordRun(s, "2026-09-22", 25), RAMP), { day: 3, limit: 35 });
});

test("a day that sent nothing does not", () => {
  const s = recordRun(fresh(), "2026-09-21", 0);
  assert.deepEqual(s.ranDays, ["2026-09-21"], "the day still counts as run, so a second launch does nothing");
  assert.deepEqual(s.sentDays, [], "and not as a rung");
  assert.deepEqual(rungFor(s, RAMP), { day: 1, limit: 10 }, "the next weekday is still the first rung");
});

test("the ramp holds at its last rung", () => {
  let s = fresh();
  for (const d of ["21", "22", "23", "24", "25", "26"]) s = recordRun(s, "2026-09-" + d, 5);
  assert.equal(rungFor(s, RAMP).limit, 50);
  assert.equal(rungFor(s, RAMP).day, 7);
});

test("a run recorded twice on one day counts once", () => {
  const s = recordRun(recordRun(fresh(), "2026-09-21", 10), "2026-09-21", 10);
  assert.deepEqual(s.ranDays, ["2026-09-21"]);
  assert.deepEqual(s.sentDays, ["2026-09-21"]);
});

test("the first day is remembered from the first run", () => {
  assert.equal(recordRun(fresh(), "2026-09-21", 0).firstDay, "2026-09-21");
  assert.equal(recordRun({ firstDay: "2026-09-01", ranDays: [] }, "2026-09-21", 5).firstDay, "2026-09-01");
});

test("a state file written before sends were counted keeps its place on the ramp", () => {
  // Every day in an old file was a day the ramp sent on, so they stand in for sentDays rather than
  // dropping a running campaign back to the first rung.
  const old: RampState = { firstDay: "2026-09-24", ranDays: ["2026-09-24", "2026-09-25"] };
  assert.deepEqual(sendingDays(old), ["2026-09-24", "2026-09-25"]);
  assert.deepEqual(rungFor(old, RAMP), { day: 3, limit: 35 });
  assert.deepEqual(recordRun(old, "2026-09-26", 35).sentDays, ["2026-09-24", "2026-09-25", "2026-09-26"]);
});

/**
 * A second run on one day. Both Otto senders can make one: `--resume` after a launch that died with the
 * network, and the round loop that follows a mailbox retiring mid-batch. Both read the rung fresh, and the
 * morning's own mail was in the state file by then, so the afternoon was offered the rung above the one the
 * day is on: ten sent on the first rung, resumed, and twenty-five more offered. Today is not a rung climbed
 * until it is over.
 */
test("a day already sent on stays on its own rung", () => {
  const s = recordRun(fresh(), "2026-09-21", 10);
  assert.deepEqual(rungFor(s, RAMP, "2026-09-21"), { day: 1, limit: 10 }, "the same day is still the first rung");
  assert.deepEqual(rungFor(s, RAMP, "2026-09-22"), { day: 2, limit: 25 }, "the next day climbs it");
  // A day that sent nothing was never on the list, so naming it changes nothing.
  assert.deepEqual(rungFor(recordRun(s, "2026-09-22", 0), RAMP, "2026-09-22"), { day: 2, limit: 25 });
});

/**
 * What a round or a resume may still send is what the day's allowance has room for, never the allowance
 * again. Both senders compute it the same way, so a mailbox that has used its rung is offered nothing more
 * until the day turns over.
 */
test("today's allowance counts what already went out today", () => {
  const room = (rung: number, perMailbox: number, already: number) => Math.max(0, Math.min(rung, perMailbox) - already);
  assert.equal(room(10, 50, 0), 10);
  assert.equal(room(10, 50, 10), 0, "a mailbox that has sent its rung gets nothing more today");
  assert.equal(room(25, 50, 10), 15);
  assert.equal(room(50, 30, 30), 0, "the per-mailbox ceiling counts the same way");
  const dir = join(dirname(fileURLToPath(import.meta.url)), "../../../scripts");
  for (const f of ["otto-ramp.mts", "otto-cloud.mts"]) {
    const src = readFileSync(join(dir, f), "utf8");
    assert.match(src, /Math\.min\(rung, PER_MAILBOX\) - already/, f + " must take the allowance minus what is already sent");
  }
});

test("both ramp scripts count the rung the same way", () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "../../../scripts");
  for (const f of ["otto-ramp.mts", "outreach-ramp.mts"]) {
    const src = readFileSync(join(dir, f), "utf8");
    assert.match(src, /rungFor\(state, RAMP(, today)?\)/, f);
    assert.match(src, /saveState\(recordRun\(state, today,/, f);
    assert.ok(!/state\.ranDays\.push/.test(src), f + " must not count a launch as a rung");
  }
});
