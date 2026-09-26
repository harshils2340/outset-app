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

test("both ramp scripts count the rung the same way", () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "../../../scripts");
  for (const f of ["otto-ramp.mts", "outreach-ramp.mts"]) {
    const src = readFileSync(join(dir, f), "utf8");
    assert.match(src, /rungFor\(state, RAMP\)/, f);
    assert.match(src, /saveState\(recordRun\(state, today,/, f);
    assert.ok(!/state\.ranDays\.push/.test(src), f + " must not count a launch as a rung");
  }
});
