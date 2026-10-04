import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// This file drops and recreates the facts table, so it gets a scratch database of its own, like the other tests
// that write to SQLite. Until 3 October 2026 it imported db/client.ts directly, which with no OUTSET_DB set opens
// the laptop's real catalog (backend/data/outset.db), so every `npm test` there dropped the catalog's facts table.
process.env.OUTSET_DB = join(mkdtempSync(join(tmpdir(), "outset-owner-")), "catalog.db");
const { db, migrate, nowIso } = await import("../../db/client.ts");
const { bestAddress, greeting, ownerFacts } = await import("../owner.ts");

/**
 * A database with no facts table has no owner facts to give, and that is the front desk rather than an error.
 * The whole outreach copy suite (draftCopy, ottoCopy, ottoDrafts, 29 tests) went dark on 29 September because
 * every one of them builds a draft, a draft reads the greeting, and the greeting read a table that a test
 * database which never runs `migrate` does not have. Nothing here mails anybody: it only asks what the reader
 * does when the crawl's own record is missing.
 */

const op = { id: "op-no-facts", email: "info@theirshop.com", domain: "theirshop.com" };

test("a database with no facts table reads as a shop whose site named nobody", () => {
  db.exec("DROP TABLE IF EXISTS facts");
  assert.deepEqual(ownerFacts(op.id), { emails: [], names: [] });
  assert.equal(bestAddress(op), "info@theirshop.com");
  assert.equal(greeting(op, "info@theirshop.com"), "Hi,");
});

test("the missing table is not remembered, so facts written later are still read", () => {
  db.exec("DROP TABLE IF EXISTS facts");
  assert.deepEqual(ownerFacts(op.id), { emails: [], names: [] });
  migrate();
  db.prepare(
    "INSERT INTO operators (id, domain, name, icon_key, origin, created_at, updated_at) VALUES (?,?,?,'jetski','test',?,?)",
  ).run(op.id, "owner-test-theirshop.com", "Their Shop", nowIso(), nowIso());
  db.prepare("INSERT INTO facts (id, operator_id, fact_key, fact_value, confidence) VALUES (?,?,?,?,?)").run(
    "f-owner-name", op.id, "owner_name", "Ron Weber (owner)", "listed",
  );
  db.prepare("INSERT INTO facts (id, operator_id, fact_key, fact_value, confidence) VALUES (?,?,?,?,?)").run(
    "f-owner-email", op.id, "owner_email", "ron@theirshop.com", "listed",
  );
  assert.deepEqual(ownerFacts(op.id), { emails: ["ron@theirshop.com"], names: ["Ron Weber (owner)"] });
  assert.equal(bestAddress(op), "ron@theirshop.com");
  assert.equal(greeting(op, "ron@theirshop.com"), "Hi Ron,");
  db.exec("DELETE FROM facts WHERE operator_id = 'op-no-facts'");
  db.exec("DELETE FROM operators WHERE id = 'op-no-facts'");
});
