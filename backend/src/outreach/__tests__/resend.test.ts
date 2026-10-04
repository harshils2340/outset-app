import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// touches.ts reaches db/client.ts through unsub.ts; keep that off the laptop's real catalog.
process.env.OUTSET_DB = join(mkdtempSync(join(tmpdir(), "outset-resend-")), "catalog.db");
const { RESEND_BEFORE, RESEND_SEEN } = await import("../touches.ts");

/**
 * The resend is the one second email for businesses whose first one went to Promotions. Run here as the real
 * clause over a send history, with bool_or (Postgres) given to SQLite as an aggregate.
 */
test("the resend goes only to businesses that never got a copy that lands in Primary", () => {
  const db = new DatabaseSync(":memory:");
  db.aggregate("bool_or", { start: 0, step: (acc: number, v: unknown) => (acc || v ? 1 : 0) });
  db.exec("create table outreach_sends (operator_id text, variant text)");
  const history: [string, string | null][] = [
    ["a-first-copy", null],
    ["b-1-october", "2026-10-01"],
    ["c-2-october", "2026-10-02"],
    ["d-3-october", "2026-10-03"],
    ["e-hand-followup", "followup-2026-10-01"],
    ["f-promotions-then-primary", "2026-10-01"],
    ["f-promotions-then-primary", "2026-10-02"],
  ];
  const ins = db.prepare("insert into outreach_sends values (?, ?)");
  for (const [op, v] of history) ins.run(op, v);
  const seen = db.prepare(`select operator_id, ${RESEND_SEEN.replace("$2", "?")} as had from outreach_sends group by operator_id order by operator_id`).all(RESEND_BEFORE) as { operator_id: string; had: number }[];
  assert.deepEqual(
    seen.filter((r) => !r.had).map((r) => r.operator_id),
    ["a-first-copy", "b-1-october"],
    "a later copy, the 2 October one included, is never resent, whatever today's COPY_VERSION is",
  );
});
