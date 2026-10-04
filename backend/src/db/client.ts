import { DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const dataDir = join(root, "data");
// OUTSET_DB points a read-mostly job (sync) at a snapshot so crawlers writing to the live file never stall it.
// OUTSET_DB_PATH is the durable location in the cloud (Render disk at /var/data/outset.db). Default: backend/data/outset.db.
const real = join(dataDir, "outset.db");
const asked = process.env.OUTSET_DB || process.env.OUTSET_DB_PATH || real;
// Under the test runner (node --test sets NODE_TEST_CONTEXT in every test process) the laptop's real catalog is
// never opened: a test gets a scratch file instead. Until 3 October 2026 owner.test.ts dropped the catalog's facts
// table, 797,399 rows, on every `npm test` here, because it named no database and this default was the real one.
const dbPath = process.env.NODE_TEST_CONTEXT && resolve(asked) === resolve(real) ? join(mkdtempSync(join(tmpdir(), "outset-test-")), "outset.db") : asked;

mkdirSync(dataDir, { recursive: true });
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);
// Several commands run at once against this file. Wait for a writer instead of failing with "database is locked".
db.exec("PRAGMA busy_timeout = 120000");

export function migrate(): void {
  const sql = readFileSync(join(here, "schema.sql"), "utf8");
  db.exec(sql);
  // Columns added after the first schema. SQLite has no ADD COLUMN IF NOT EXISTS.
  const cols = new Set(
    (db.prepare("PRAGMA table_info(operators)").all() as { name: string }[]).map((c) => c.name),
  );
  for (const [col, type] of [["street","TEXT"],["postal","TEXT"],["hours","TEXT"],["lat","REAL"],["lon","REAL"],["osm_ref","TEXT"]]) {
    if (!cols.has(col)) db.exec(`ALTER TABLE operators ADD COLUMN ${col} ${type}`);
  }
  const draftCols = new Set(
    (db.prepare("PRAGMA table_info(outreach_drafts)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!draftCols.has("kind")) db.exec("ALTER TABLE outreach_drafts ADD COLUMN kind TEXT NOT NULL DEFAULT 'listing'");
  if (!draftCols.has("sent_via")) db.exec("ALTER TABLE outreach_drafts ADD COLUMN sent_via TEXT");
}

export function nowIso(): string {
  return new Date().toISOString();
}
