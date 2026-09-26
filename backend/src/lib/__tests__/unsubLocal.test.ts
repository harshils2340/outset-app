import { strict as assert } from "node:assert";
import test from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Reading the suppression list from SQLite.
 *
 * The list stores a hash of an address and never the address itself, so nothing may join to it by email.
 * scripts/outreach-list.mts did, with `lower(trim(o.email)) not in (select email from mail_unsub)`.
 * `mail_unsub` has no `email` column, and SQLite resolves an unqualified name in a subquery against the
 * outer query rather than failing: the subquery became `select o.email` once per suppressed row, so the
 * clause read "keep this operator only if its stored address is not already lower-cased and trimmed".
 * Empty, it suppressed nobody. With a single row in it, it dropped every operator whose address was stored
 * tidily, which is nearly all of them, and the outreach list quietly emptied.
 *
 * The first test pins that trap so nobody writes the clause again; the rest pin the reader that replaced it.
 */

process.env.OUTSET_DB = join(mkdtempSync(join(tmpdir(), "outset-unsub-")), "unsub.db");
const { db, migrate } = await import("../../db/client.ts");
const { emailHash, recordedLocally } = await import("../unsub.ts");

migrate();

test("an email column compared against mail_unsub is the outer query's own column", () => {
  db.exec("CREATE TEMP TABLE ops (email TEXT)");
  db.exec("INSERT INTO ops VALUES ('info@shop.com'), ('Info@Other.com')");
  const q = "SELECT o.email FROM ops o WHERE lower(trim(o.email)) NOT IN (SELECT email FROM mail_unsub)";
  const emails = () => (db.prepare(q).all() as { email: string }[]).map((r) => r.email);
  assert.deepEqual(emails(), ["info@shop.com", "Info@Other.com"], "empty, it suppresses nobody");
  db.prepare("INSERT INTO mail_unsub (email_hash, at) VALUES (?, ?)").run(emailHash("someone@else.com"), "2026-09-26T00:00:00.000Z");
  assert.deepEqual(emails(), ["Info@Other.com"], "one unrelated row drops every tidily stored address");
});

test("recordedLocally reads the hashes and suppresses the address behind one", () => {
  const gone = "owner@leftus.com";
  db.prepare("INSERT INTO mail_unsub (email_hash, at) VALUES (?, ?)").run(emailHash(gone), "2026-09-26T00:00:00.000Z");
  const hashes = recordedLocally();
  assert.ok(hashes.has(emailHash(gone)));
  assert.ok(hashes.has(emailHash("someone@else.com")));
  assert.ok(!hashes.has(emailHash("info@shop.com")), "an address nobody suppressed is not on the list");
  // The address is never stored, so casing and padding have to be settled by the hash, not by the query.
  assert.ok(hashes.has(emailHash("  Owner@LeftUs.com  ")));
});

test("the outreach list filters by hash and links a listing where one actually opens", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../scripts/outreach-list.mts"), "utf8");
  // A where-clause line, not the comment above the file that explains why there is no longer one.
  assert.ok(!/^\s*and .*mail_unsub/im.test(src), "no SQL clause may join the list by address");
  assert.match(src, /suppressed\.has\(emailHash\(/);
  // /listing/<slug> is not a page this site serves; the app opens a listing at /#o=<catalog id>.
  assert.ok(!src.includes("onoutset.com/listing/"));
  assert.match(src, /onoutset\.com\/#o=" \+ catalogId\(/);
});
