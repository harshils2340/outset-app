import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * `scripts/pipeline.mts` must refuse an argument it does not know instead of starting the scheduler.
 *
 * Every flag but `--dry` and `--once=` used to fall through to "run forever", which queues every crawl on the
 * box: reviews, discover, structure, photos, the screenshots, the sync. The only door in front of that was
 * `isLaptop()`, which says nothing about a Linux machine that is not the Render worker. A plausible guess at
 * the read-only flag, `--list`, started the whole overnight pipeline on 30 September 2026 instead of printing
 * the schedule. Both paths are driven here rather than read, because what is being asserted is what the
 * process does with an argument, and the whole point is that the wrong answer has side effects.
 */

const BACKEND = resolve(import.meta.dirname, "..", "..");

/** Somewhere harmless for the database path, so nothing here can create or touch the worker's own disk. */
function run(args: string[]): { status: number | null; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "outset-pipeline-args-"));
  const r = spawnSync("npx", ["tsx", "scripts/pipeline.mts", ...args], {
    cwd: BACKEND,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, OUTSET_DB_PATH: join(dir, "scratch.db"), PIPELINE_STATUS_PATH: join(dir, "status.json") },
  });
  return { status: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

test("the pipeline refuses an argument it does not know rather than starting every job", () => {
  const r = run(["--list"]);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /unknown argument --list/);
  // It has to say what to use instead, or the next guess is another crawl.
  assert.match(r.out, /--dry/);
  assert.doesNotMatch(r.out, /queued/);
});

test("the pipeline still prints its schedule for --dry and starts nothing", () => {
  const r = run(["--dry"]);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /Pipeline schedule/);
  assert.match(r.out, /outreach/);
  assert.doesNotMatch(r.out, /queued/);
});
