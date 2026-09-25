import { strict as assert } from "node:assert";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CROSS_CAMPAIGN_DAYS, cooloffStart, maySend, noRecentSendSql } from "../spacing.ts";

const here = dirname(fileURLToPath(import.meta.url));

test("a campaign never mails an address it has already mailed, however long ago", () => {
  const old = [{ kind: "listing", createdAt: "2020-01-01T00:00:00.000Z" }];
  assert.equal(maySend(old, "listing", new Date("2026-09-25T12:00:00Z")), false);
});

test("the other campaign's send bars the address for a week and then stops", () => {
  const now = new Date("2026-09-25T12:00:00Z");
  const threeDaysAgo = [{ kind: "otto", createdAt: "2026-09-22T12:00:00.000Z" }];
  const tenDaysAgo = [{ kind: "otto", createdAt: "2026-09-15T12:00:00.000Z" }];
  assert.equal(maySend(threeDaysAgo, "listing", now), false, "two pitches from one mailbox inside a week");
  assert.equal(maySend(tenDaysAgo, "listing", now), true);
  // And the same rule seen from the other side.
  assert.equal(maySend([{ kind: "listing", createdAt: "2026-09-22T12:00:00.000Z" }], "otto", now), false);
  assert.equal(maySend([{ kind: "listing", createdAt: "2026-09-15T12:00:00.000Z" }], "otto", now), true);
});

test("an address nobody has mailed is free, and the window is a week", () => {
  assert.equal(maySend([], "otto"), true);
  assert.equal(CROSS_CAMPAIGN_DAYS, 7);
  assert.equal(cooloffStart(new Date("2026-09-25T12:00:00Z")), "2026-09-18T12:00:00.000Z");
});

/**
 * The rule as SQL, run against a database rather than read: the clause both send queries carry, over a
 * drafts table seeded by hand. `maySend` above and this are the same rule written twice, so they are checked
 * against each other rather than each on its own.
 */
test("the clause the send queries carry drops exactly the rows the rule drops", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE outreach_drafts (
    id TEXT PRIMARY KEY, to_email TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, kind TEXT NOT NULL)`);
  const ins = db.prepare("INSERT INTO outreach_drafts (id, to_email, status, created_at, kind) VALUES (?, ?, ?, ?, ?)");
  // Five owners, each with a draft of both kinds waiting, and a different history behind them.
  const history: [string, string, string, string][] = [
    // email, kind already sent, when, status
    ["fresh@shop.com", "listing", "2026-09-22T12:00:00.000Z", "draft"],
    ["otto-3d@shop.com", "otto", "2026-09-22T12:00:00.000Z", "sent"],
    ["otto-10d@shop.com", "otto", "2026-09-15T12:00:00.000Z", "sent"],
    ["listing-3d@shop.com", "listing", "2026-09-22T12:00:00.000Z", "sent"],
    ["listing-2y@shop.com", "listing", "2024-09-22T12:00:00.000Z", "sent"],
  ];
  let n = 0;
  for (const [email, kind, at, status] of history) {
    if (status === "sent") ins.run("s" + n++, email, "sent", at, kind);
    for (const k of ["listing", "otto"]) ins.run("d" + n++, email, "draft", "2026-09-25T09:00:00.000Z", k);
  }
  const now = new Date("2026-09-25T12:00:00Z");
  for (const own of ["listing", "otto"] as const) {
    const rows = db
      .prepare(
        `SELECT d.to_email FROM outreach_drafts d WHERE d.status = 'draft' AND d.kind = '${own}' AND ${noRecentSendSql(own)} ORDER BY d.to_email`,
      )
      .all(cooloffStart(now)) as { to_email: string }[];
    const offered = rows.map((r) => r.to_email);
    const expected = history
      .filter(([email, kind, at, status]) => {
        void email;
        return maySend(status === "sent" ? [{ kind, createdAt: at }] : [], own, now);
      })
      .map(([email]) => email)
      .sort();
    assert.deepEqual(offered, expected, own + ": the SQL and the rule disagree");
  }
  // Spelled out, so a change to either side has to face the actual addresses.
  const listingOffered = (
    db
      .prepare(`SELECT d.to_email FROM outreach_drafts d WHERE d.status = 'draft' AND d.kind = 'listing' AND ${noRecentSendSql("listing")}`)
      .all(cooloffStart(now)) as { to_email: string }[]
  ).map((r) => r.to_email);
  assert.deepEqual(listingOffered.sort(), ["fresh@shop.com", "otto-10d@shop.com"]);
});

/**
 * Both campaigns have to read the shared rule, not a copy of their own. The bug this replaced was a per-kind
 * `NOT EXISTS` in each file that could not see the other campaign at all, and it would come back the moment
 * somebody wrote the obvious clause again.
 */
test("both send queries read the shared rule rather than their own per-kind clause", () => {
  for (const file of ["send.ts", "sendOtto.ts"]) {
    const src = readFileSync(join(here, "..", file), "utf8");
    assert.match(src, /noRecentSendSql\("(listing|otto)"\)/, file + " must build its dedup clause from spacing.ts");
    assert.match(src, /cooloffStart\(\)/, file + " must bind the cool-off start");
    assert.doesNotMatch(
      src,
      /status = 'sent' AND s\.kind = '(listing|otto)'\)/,
      file + " still carries a dedup clause blind to the other campaign",
    );
  }
});
