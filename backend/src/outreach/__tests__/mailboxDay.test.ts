import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// touches.ts reaches db/client.ts through unsub.ts; keep that off the laptop's real catalog.
process.env.OUTSET_DB = join(mkdtempSync(join(tmpdir(), "outset-mailboxday-")), "catalog.db");
const { BUMP_KIND, RESEND_KIND, SENT_TODAY_BY_MAILBOX } = await import("../touches.ts");
const { recordRun, rungFor } = await import("../ramp.ts");

/**
 * What a mailbox has already sent today, which is the only thing standing between the warm-up ramp and a
 * Gmail sending twice its rung. Run here as the real clause over a send history, with Postgres' casts
 * dropped for SQLite the way resend.test.ts drops them.
 */
const sqlite = SENT_TODAY_BY_MAILBOX.replace(/::int|::timestamptz/g, "").replace("$1", "?");
const DAY_START = "2026-10-05T04:00:00.000Z";
const MORNING = "2026-10-05T13:20:00.000Z";

function counted(history: [string, string, string, string][]): Record<string, number> {
  const db = new DatabaseSync(":memory:");
  db.exec("create table outreach_sends (mailbox text, kind text, status text, at text)");
  const ins = db.prepare("insert into outreach_sends values (?, ?, ?, ?)");
  for (const row of history) ins.run(...row);
  const out: Record<string, number> = {};
  for (const r of db.prepare(sqlite).all(DAY_START) as { mailbox: string; n: number }[]) out[r.mailbox] = r.n;
  return out;
}

test("every kind of mail a mailbox sends counts against its day", () => {
  const got = counted([
    ["m1@x.com", "otto", "sent", MORNING],
    ["m1@x.com", "otto", "sent", MORNING],
    ["m1@x.com", "otto", "sent", MORNING],
    ["m1@x.com", "otto", "sent", MORNING],
    ["m1@x.com", RESEND_KIND, "sent", MORNING],
    ["m1@x.com", RESEND_KIND, "sent", MORNING],
    ["m1@x.com", BUMP_KIND, "sent", MORNING],
    ["m1@x.com", BUMP_KIND, "sent", MORNING],
    ["m1@x.com", BUMP_KIND, "sent", MORNING],
    ["m1@x.com", BUMP_KIND, "sent", MORNING],
  ]);
  assert.deepEqual(got, { "m1@x.com": 10 }, "ten emails out of one Gmail are ten, not the six that are not follow-ups");
  // The cost of reading it low: the first rung is 10, so a resume saw headroom for four more.
  const rung = rungFor({ firstDay: "2026-10-05", ranDays: ["2026-10-05"], sentDays: [] }, [10, 25, 35, 50], "2026-10-05").limit;
  assert.equal(Math.max(0, rung - got["m1@x.com"]), 0, "a mailbox that has sent its rung is offered nothing more");
});

test("the clause names no kind at all, so a kind added later cannot slip outside the cap", () => {
  assert.ok(!/\bkind\b/.test(SENT_TODAY_BY_MAILBOX), "a list of kinds here goes stale the next time the campaign learns to send something: " + SENT_TODAY_BY_MAILBOX);
});

test("a day spent entirely on follow-ups is a day the ramp sent on", () => {
  const got = counted([
    ["m1@x.com", BUMP_KIND, "sent", MORNING],
    ["m1@x.com", BUMP_KIND, "sent", MORNING],
  ]);
  assert.equal(got["m1@x.com"], 2);
  const state = recordRun({ firstDay: "2026-10-05", ranDays: [], sentDays: [] }, "2026-10-05", got["m1@x.com"]);
  assert.deepEqual(state.sentDays, ["2026-10-05"], "the rung moves, since mail did go out");
});

test("only today's own sends count, and only sends", () => {
  const got = counted([
    ["m1@x.com", "otto", "sent", MORNING],
    ["m1@x.com", BUMP_KIND, "sent", "2026-10-04T13:20:00.000Z"],
    ["m1@x.com", "otto", "failed", MORNING],
    ["m1@x.com", "otto", "bounce", MORNING],
    ["m1@x.com", "otto", "replied", MORNING],
    ["m2@x.com", BUMP_KIND, "sent", MORNING],
  ]);
  assert.deepEqual(got, { "m1@x.com": 1, "m2@x.com": 1 }, "yesterday's mail, a refusal and a reply are not today's volume");
});
