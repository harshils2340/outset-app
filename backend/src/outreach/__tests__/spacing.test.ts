import { strict as assert } from "node:assert";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CROSS_CAMPAIGN_DAYS, cooloffStart, maySend, noRecentSendSql } from "../spacing.ts";
import { OTHER_CAMPAIGN_SQL, splitCampaignHolds } from "../touches.ts";

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
    id TEXT PRIMARY KEY, operator_id TEXT NOT NULL, to_email TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, kind TEXT NOT NULL)`);
  const ins = db.prepare("INSERT INTO outreach_drafts (id, operator_id, to_email, status, created_at, kind) VALUES (?, ?, ?, ?, ?, ?)");
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
    if (status === "sent") ins.run("s" + n++, "op-" + email, email, "sent", at, kind);
    for (const k of ["listing", "otto"]) ins.run("d" + n++, "op-" + email, email, "draft", "2026-09-25T09:00:00.000Z", k);
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
 * The address on a draft can change between runs (the front desk was mailed, then the owners crawl found the
 * owner's own mailbox, owner.ts). The business is what must not be mailed twice, so a send to any address of
 * the same operator counts.
 */
test("a business already mailed at one address is not mailed again at another", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE outreach_drafts (
    id TEXT PRIMARY KEY, operator_id TEXT NOT NULL, to_email TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, kind TEXT NOT NULL)`);
  const ins = db.prepare("INSERT INTO outreach_drafts (id, operator_id, to_email, status, created_at, kind) VALUES (?, ?, ?, ?, ?, ?)");
  ins.run("s1", "op-1", "info@shop.com", "sent", "2026-09-24T12:00:00.000Z", "otto");
  ins.run("d1", "op-1", "ron@shop.com", "draft", "2026-09-25T09:00:00.000Z", "otto");
  ins.run("d2", "op-2", "ron@shop.com", "draft", "2026-09-25T09:00:00.000Z", "otto");
  const rows = db
    .prepare(`SELECT d.id FROM outreach_drafts d WHERE d.status = 'draft' AND ${noRecentSendSql("otto")} ORDER BY d.id`)
    .all(cooloffStart(new Date("2026-09-25T12:00:00Z"))) as { id: string }[];
  assert.deepEqual(rows.map((r) => r.id), ["d2"], "op-1 was mailed at info@ yesterday; ron@ is the same business");
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

/**
 * The rule across the two databases it now lives in.
 *
 * `noRecentSendSql` above is the laptop's SQLite, which is where both campaigns' drafts and sends were when
 * the rule was written. The Otto campaign moved to the cloud on 28 September 2026 and records itself in
 * Postgres (`outreach_sends`), so from the listing send's side those sends were invisible: a business pitched
 * Otto that morning sat at the top of the listing queue, clear of every clause, and one that replied "stop"
 * to the Otto note had nothing on this disk saying so. Both are a second cold pitch from the one personal
 * Gmail the whole channel runs on, which is what an owner marks as spam.
 */
test("the shared record's rows split into the week and the for-good halves", () => {
  const rows = [
    { operator_id: "op-sent", email: "Info@Sent.com", status: "sent" },
    { operator_id: "op-replied", email: "ron@replied.com", status: "replied" },
    { operator_id: "op-handoff", email: "ron@handoff.com", status: "handoff" },
    // A bounce is already on the suppression list by address; here it is simply not a send.
    { operator_id: "op-bounce", email: "gone@bounce.com", status: "bounce" },
    { operator_id: "op-failed", email: "dead@failed.com", status: "failed" },
  ];
  const { holds, done } = splitCampaignHolds(rows);
  assert.deepEqual([...holds.operators], ["op-sent"], "only a send is the cool-off");
  // The address is matched the way every sender lowercases it before asking.
  assert.deepEqual([...holds.emails], ["info@sent.com"]);
  assert.deepEqual([...done.operators].sort(), ["op-bounce", "op-failed", "op-handoff", "op-replied"]);
  assert.equal(done.emails.has("ron@replied.com"), true);
  // Nothing lands in both halves, or a business would be marked handed off on a cool-off.
  for (const o of holds.operators) assert.equal(done.operators.has(o), false, o);
});

test("nothing is held when the shared record has nothing", () => {
  const { holds, done } = splitCampaignHolds([]);
  assert.equal(holds.operators.size + holds.emails.size + done.operators.size + done.emails.size, 0);
});

/** The query behind it reads exactly those rows, and reads the other campaign rather than its own. */
test("the shared record is asked for the other campaign's week and for every reply", () => {
  assert.match(OTHER_CAMPAIGN_SQL, /status in \('replied', 'handoff'\)/);
  assert.match(OTHER_CAMPAIGN_SQL, /status = 'sent' and kind <> \$1 and at >= \$2::timestamptz/);
});

/** And the listing send actually asks, since a rule nothing reads is the bug this replaced. */
test("the listing send reads the shared record as well as its own disk", () => {
  const src = readFileSync(join(here, "..", "send.ts"), "utf8");
  assert.match(src, /otherCampaignHolds\("listing", cooloffStart\(\)\)/, "send.ts must ask the shared record for the cool-off");
  assert.match(src, /elsewhere\?\.done\.(operators|emails)/, "a business that answered Otto has to leave the listing queue");
  assert.match(src, /elsewhere\?\.holds\.(operators|emails)/, "a business pitched Otto this week has to be passed over");
  // A record it could not read must not silently become "nobody has been mailed".
  assert.match(src, /shared outreach record unavailable/, "an unreadable shared record has to say so");
});
